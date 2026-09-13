/** Compute raster for sub-eight-pixel opaque triangles. Hardware renders the complementary set. */
const PAGE_INFO=`struct PageInfo{world:mat4x4f,baseColor:vec4f,metalness:f32,roughness:f32,mapIndex:u32,flags:u32,pageOffset:u32,indexCount:u32,vertexBase:u32,packedBase:u32,uvScale:vec2f,clusterHash:u32,hizSlot:u32,roughnessIndex:u32,metalnessIndex:u32,normalIndex:u32,normalScale:f32,roughUvScale:vec2f,metalUvScale:vec2f,normalUvScale:vec2f,aoIndex:u32,aoIntensity:f32,aoUvScale:vec2f,emissiveIndex:u32,pad0:u32,emissive:vec4f,emissiveUvScale:vec2f,normalScaleY:f32,pad1:f32,pad4:vec4f,pad5:vec4f,}
struct Uniforms{viewProj:mat4x4f,viewport:vec2f,smallThreshold:f32,pad:f32,}`;
const RASTER=`${PAGE_INFO}
@group(0) @binding(0) var<storage,read> indices:array<u32>;
@group(0) @binding(1) var<storage,read> positions:array<f32>;
@group(0) @binding(2) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(3) var<storage,read> hizFlags:array<u32>;
@group(0) @binding(4) var<uniform> uni:Uniforms;
@group(0) @binding(5) var<storage,read> uvs:array<f32>;
@group(0) @binding(6) var maps:texture_2d_array<f32>;
@group(0) @binding(7) var mapsSampler:sampler;
@group(0) @binding(8) var<storage,read_write> depths:array<atomic<u32>>;
@group(0) @binding(9) var<storage,read_write> ids:array<atomic<u32>>;
fn vertex(page:PageInfo,index:u32)->vec4f{
 let base=(page.vertexBase+index)*3u;
 return uni.viewProj*page.world*vec4f(positions[base],positions[base+1u],positions[base+2u],1.0);
}
fn uv(page:PageInfo,index:u32)->vec2f{let base=(page.vertexBase+index)*2u;return vec2f(uvs[base],uvs[base+1u]);}
fn edge(a:vec2f,b:vec2f,p:vec2f)->f32{return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);}
fn screen(p:vec4f)->vec2f{return vec2f((p.x/p.w*0.5+0.5)*uni.viewport.x,(1.0-(p.y/p.w*0.5+0.5))*uni.viewport.y);}
fn keepMask(page:PageInfo,tc:vec2f)->bool{
 if((page.flags&128u)==0u||(page.flags&8u)==0u){return true;}
 let wrapped=vec2f(select(clamp(tc.x,0.0,1.0),fract(tc.x),(page.flags&32u)!=0u),select(clamp(tc.y,0.0,1.0),fract(tc.y),(page.flags&64u)!=0u))*page.uvScale;
 return textureSampleLevel(maps,mapsSampler,wrapped,i32(page.mapIndex),0.0).w>=page.baseColor.w;
}
@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) gid:vec3u){
 let offset=gid.x;if(offset>=u32(uni.viewport.x)*u32(uni.viewport.y)){return;}
 atomicStore(&depths[offset],bitcast<u32>(1.0));atomicStore(&ids[offset],0xffffffffu);
}
fn rasterPixel(triangle:u32,pageIndex:u32,lane:vec2u,writeId:bool){
 let page=pages[pageIndex];
 if(triangle*3u+2u>=page.indexCount){return;}
 if(page.hizSlot!=0xffffffffu&&hizFlags[page.hizSlot]!=0u){return;}
 let ia=indices[page.pageOffset+triangle*3u];let ib=indices[page.pageOffset+triangle*3u+1u];let ic=indices[page.pageOffset+triangle*3u+2u];
 let ca=vertex(page,ia);let cb=vertex(page,ib);let cc=vertex(page,ic);
 if(ca.w<=0.0||cb.w<=0.0||cc.w<=0.0||ca.z<0.0||cb.z<0.0||cc.z<0.0||ca.z>ca.w||cb.z>cb.w||cc.z>cc.w){return;}
 let a=screen(ca);let b=screen(cb);let c=screen(cc);
 let lo=min(a,min(b,c));let hi=max(a,max(b,c));
 if(lo.x<0.0||lo.y<0.0||hi.x>=uni.viewport.x||hi.y>=uni.viewport.y||hi.x-lo.x>uni.smallThreshold||hi.y-lo.y>uni.smallThreshold){return;}
 let area=edge(a,b,c);if(abs(area)<1e-8){return;}
 let determinant=determinant(mat3x3f(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz));
 let front=select((area > 0.0),(area < 0.0),(determinant >= 0.0));
 if((page.flags&2u)==0u){if((page.flags&256u)!=0u){if(front){return;}}else if(!front){return;}}
 let pixel=vec2i(floor(lo))+vec2i(lane);
 if(pixel.x<0||pixel.y<0||pixel.x>=i32(uni.viewport.x)||pixel.y>=i32(uni.viewport.y)){return;}
 let sample=vec2f(pixel)+vec2f(0.5);
 let wa=edge(b,c,sample)/area;let wb=edge(c,a,sample)/area;let wc=1.0-wa-wb;
 if(wa<0.0||wb<0.0||wc<0.0){return;}
 let depth=wa*ca.z/ca.w+wb*cb.z/cb.w+wc*cc.z/cc.w;
 if(depth<0.0||depth>=1.0){return;}
 if((page.flags&128u)!=0u){let inv=wa/ca.w+wb/cb.w+wc/cc.w;let tc=(uv(page,ia)*(wa/ca.w)+uv(page,ib)*(wb/cb.w)+uv(page,ic)*(wc/cc.w))/inv;if(!keepMask(page,tc)){return;}}
 let offset=u32(pixel.y)*u32(uni.viewport.x)+u32(pixel.x);let bits=bitcast<u32>(depth);
 if(writeId){if(atomicLoad(&depths[offset])==bits){atomicMin(&ids[offset],page.packedBase|(triangle&0xffffu));}}
 else{atomicMin(&depths[offset],bits);}
}
@compute @workgroup_size(8,8) fn depthPass(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){rasterPixel(group.x,group.y,lane.xy,false);}
@compute @workgroup_size(8,8) fn idPass(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){rasterPixel(group.x,group.y,lane.xy,true);}`;
const RESOLVE=`${PAGE_INFO}
@group(0) @binding(0) var<storage,read> depths:array<u32>;
@group(0) @binding(1) var<storage,read> ids:array<u32>;
@group(0) @binding(2) var<uniform> uni:Uniforms;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);}
struct One{@location(0) id:u32,@builtin(frag_depth) depth:f32,}
struct Two{@location(0) id:u32,@location(1) hiz:f32,@builtin(frag_depth) depth:f32,}
fn offset(pos:vec4f)->u32{return u32(pos.y)*u32(uni.viewport.x)+u32(pos.x);}
@fragment fn one(@builtin(position) pos:vec4f)->One{let i=offset(pos);let id=ids[i];if(id==0xffffffffu){discard;}return One(id,bitcast<f32>(depths[i]));}
@fragment fn two(@builtin(position) pos:vec4f)->Two{let i=offset(pos);let id=ids[i];if(id==0xffffffffu){discard;}let depth=bitcast<f32>(depths[i]);return Two(id,depth,depth);}`;
export function createGpuSmallTriangles(device:GPUDevice,width:number,height:number){
 const size=Math.max(4,width*height*4);
 const depth=device.createBuffer({size,usage:GPUBufferUsage.STORAGE});
 const ids=device.createBuffer({size,usage:GPUBufferUsage.STORAGE});
 const computeLayout=device.createBindGroupLayout({entries:[
  {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
  {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
  {binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
  {binding:6,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'float',viewDimension:'2d-array'}},{binding:7,visibility:GPUShaderStage.COMPUTE,sampler:{}},
  {binding:8,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:9,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
 ]});
 const resolveLayout=device.createBindGroupLayout({entries:[
  {binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
  {binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
 ]});
 const computeModule=device.createShaderModule({code:RASTER});
 const computePipelineLayout=device.createPipelineLayout({bindGroupLayouts:[computeLayout]});
 const clear=device.createComputePipeline({layout:computePipelineLayout,compute:{module:computeModule,entryPoint:'clear'}});
 const rasterDepth=device.createComputePipeline({layout:computePipelineLayout,compute:{module:computeModule,entryPoint:'depthPass'}});
 const rasterId=device.createComputePipeline({layout:computePipelineLayout,compute:{module:computeModule,entryPoint:'idPass'}});
 const resolveModule=device.createShaderModule({code:RESOLVE});
 const resolvePipelineLayout=device.createPipelineLayout({bindGroupLayouts:[resolveLayout]});
 const makeResolve=(two:boolean)=>device.createRenderPipeline({layout:resolvePipelineLayout,vertex:{module:resolveModule,entryPoint:'vs'},fragment:{module:resolveModule,entryPoint:two?'two':'one',targets:two?[{format:'r32uint'},{format:'r32float'}]:[{format:'r32uint'}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
 const one=makeResolve(false),two=makeResolve(true);
 return {
  width,height,
  encode(encoder:GPUCommandEncoder,input:{indices:GPUBuffer;positions:GPUBuffer;pages:GPUBuffer;hizFlags:GPUBuffer;uniform:GPUBuffer;uvs:GPUBuffer;maps:GPUTextureView;sampler:GPUSampler;pageRows:number;maxTriangles:number;idsView:GPUTextureView;depthView:GPUTextureView;hizView?:GPUTextureView}){
   const compute=device.createBindGroup({layout:computeLayout,entries:[{binding:0,resource:{buffer:input.indices}},{binding:1,resource:{buffer:input.positions}},{binding:2,resource:{buffer:input.pages}},{binding:3,resource:{buffer:input.hizFlags}},{binding:4,resource:{buffer:input.uniform}},{binding:5,resource:{buffer:input.uvs}},{binding:6,resource:input.maps},{binding:7,resource:input.sampler},{binding:8,resource:{buffer:depth}},{binding:9,resource:{buffer:ids}}]});
   const pass=encoder.beginComputePass({label:'WG small triangle clear'});pass.setPipeline(clear);pass.setBindGroup(0,compute);pass.dispatchWorkgroups(Math.ceil(width*height/64));pass.end();
   for(const pipeline of [rasterDepth,rasterId]){const raster=encoder.beginComputePass({label:pipeline===rasterDepth?'WG small triangle depth':'WG small triangle ids'});raster.setPipeline(pipeline);raster.setBindGroup(0,compute);raster.dispatchWorkgroups(input.maxTriangles,input.pageRows);raster.end();}
   const resolved=device.createBindGroup({layout:resolveLayout,entries:[{binding:0,resource:{buffer:depth}},{binding:1,resource:{buffer:ids}},{binding:2,resource:{buffer:input.uniform}}]});
   const view=input.hizView;const output=encoder.beginRenderPass({label:'WG hybrid visibility resolve',colorAttachments:[{view:input.idsView,loadOp:'load',storeOp:'store'},...(view?[{view,loadOp:'load' as const,storeOp:'store' as const}]:[])],depthStencilAttachment:{view:input.depthView,depthLoadOp:'load',depthStoreOp:'store'}});
   output.setViewport(0,0,width,height,0,1);output.setPipeline(view?two:one);output.setBindGroup(0,resolved);output.draw(3);output.end();
  },
  dispose(){depth.destroy();ids.destroy();},
 };
}
export type GpuSmallTriangles=ReturnType<typeof createGpuSmallTriangles>;
