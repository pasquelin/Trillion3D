import {hizBuildPyramid,hizReduceCeil} from '../sdk-core/index.ts';
import {hizRejects,type HizBounds,type HizPyramid} from './hiz.ts';

const WORKGROUP=8,TEST_WORKGROUP=64,UNIFORM_BYTES=256,MAX_LEVELS=16;

export type PackedHiz={data:Float32Array;sizes:Array<[number,number]>;offsets:number[]};

export function hizLevelSizes(width:number,height:number):Array<[number,number]>{
 if(width<1||height<1)throw new Error('HIZ_DEPTH_SIZE');
 const sizes:Array<[number,number]>=[[width,height]];
 while(sizes[sizes.length-1][0]>1||sizes[sizes.length-1][1]>1){
  const [w,h]=sizes[sizes.length-1];
  sizes.push([Math.ceil(w/2),Math.ceil(h/2)]);
 }
 return sizes;
}

function rowsOf(data:Float32Array,width:number,height:number,offset=0){
 const rows:number[][]=[];
 for(let y=0;y<height;y++){
  const row=new Array<number>(width);
  for(let x=0;x<width;x++)row[x]=data[offset+y*width+x];
  rows.push(row);
 }
 return rows;
}

/** Pack level-0 rows into the full ceil-max pyramid used by the GPU kernel. */
export function packHizPyramid(level0:readonly(readonly number[])[]):PackedHiz{
 const levels=hizBuildPyramid(level0);
 const sizes=levels.map(level=>[level[0].length,level.length] as [number,number]);
 const offsets:number[]=[];
 let total=0;
 for(const [w,h] of sizes){offsets.push(total);total+=w*h;}
 const data=new Float32Array(Math.max(1,total));
 for(let i=0;i<levels.length;i++){
  const level=levels[i],[w]=sizes[i],base=offsets[i];
  for(let y=0;y<level.length;y++)data.set(level[y],base+y*w);
 }
 return {data,sizes,offsets};
}

/** One ceil-2×2 max reduction of a packed level (background 1). */
export function evaluateHizReduce(src:Float32Array,srcWidth:number,srcHeight:number){
 const reduced=hizReduceCeil(rowsOf(src,srcWidth,srcHeight));
 const height=reduced.length,width=height?reduced[0].length:0;
 const data=new Float32Array(Math.max(1,width*height));
 for(let y=0;y<height;y++)data.set(reduced[y],y*width);
 return {data,width,height};
}

function pyramidFromPacked(packed:PackedHiz):HizPyramid{
 const levels=packed.sizes.map(([w,h],i)=>rowsOf(packed.data,w,h,packed.offsets[i]));
 return {levels,width:packed.sizes[0][0],height:packed.sizes[0][1]};
}

/** Same rejection as `hizRejects` (level-0 inclusive footprint, near clips never hide). */
export function evaluateHizTest(packed:PackedHiz,bounds:HizBounds[],bias=0){
 const pyramid=pyramidFromPacked(packed);
 const flags=new Uint32Array(bounds.length);
 for(let i=0;i<bounds.length;i++)flags[i]=hizRejects(pyramid,bounds[i],bias)?1:0;
 return flags;
}

export const HIZ_SHADER=`struct Uni{a:u32,b:u32,c:u32,d:u32,e:u32,f:u32,g:u32,h:u32,}
struct Bounds{minX:i32,minY:i32,maxX:i32,maxY:i32,nearest:f32,clipsNear:u32,pad0:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read_write> pyramid:array<f32>;
@group(0) @binding(1) var level0:texture_2d<f32>;
@group(0) @binding(2) var<uniform> uni:Uni;
@group(0) @binding(3) var<storage, read> bounds:array<Bounds>;
@group(0) @binding(4) var<storage, read_write> flags:array<u32>;
@compute @workgroup_size(8, 8)
fn copyDepth(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=uni.a||id.y>=uni.b){return;}
 let z=textureLoad(level0,vec2i(i32(id.x),i32(id.y)),0).r;
 pyramid[uni.c+id.y*uni.a+id.x]=z;
}
@compute @workgroup_size(8, 8)
fn reduceHiz(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=uni.e||id.y>=uni.f){return;}
 let x0=id.x*2u;let y0=id.y*2u;
 var far=pyramid[uni.a+y0*uni.b+x0];
 if(x0+1u<uni.b){far=max(far,pyramid[uni.a+y0*uni.b+x0+1u]);}
 if(y0+1u<uni.c){
  far=max(far,pyramid[uni.a+(y0+1u)*uni.b+x0]);
  if(x0+1u<uni.b){far=max(far,pyramid[uni.a+(y0+1u)*uni.b+x0+1u]);}
 }
 pyramid[uni.d+id.y*uni.e+id.x]=far;
}
fn footprintFar(x0:i32,y0:i32,x1:i32,y1:i32)->f32{
 if(x1<=x0||y1<=y0){return 1.0;}
 if(x1-x0>16||y1-y0>16){return 1.0;}
 var far=-1.0e30;var hit=false;
 let w=i32(uni.a);let h=i32(uni.b);
 for(var y=y0;y<y1;y++){
  if(y<0||y>=h){continue;}
  for(var x=x0;x<x1;x++){
   if(x<0||x>=w){continue;}
   far=max(far,pyramid[u32(y)*uni.a+u32(x)]);
   hit=true;
  }
 }
 if(!hit){return 1.0;}
 return far;
}
@compute @workgroup_size(64)
fn testHiz(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.c){return;}
 let b=bounds[i];
 if(b.clipsNear!=0u||b.maxX<b.minX||b.maxY<b.minY){flags[i]=0u;return;}
 let far=footprintFar(b.minX,b.minY,b.maxX+1,b.maxY+1);
 let bias=bitcast<f32>(uni.d);
 flags[i]=select(0u,1u,b.nearest>far+bias);
}
`;

export type GpuHiz={
 width:number;
 height:number;
 level0:GPUTexture;
 level0View:GPUTextureView;
 flags:GPUBuffer;
 encodePyramid(encoder:GPUCommandEncoder):void;
 encodeTest(device:GPUDevice,encoder:GPUCommandEncoder,bounds:HizBounds[]):number;
 encodeCopyHistory(encoder:GPUCommandEncoder):void;
 hasHistory():boolean;
 resize(device:GPUDevice,width:number,height:number):boolean;
 dispose():void;
};

function pyramidBytes(width:number,height:number){
 const sizes=hizLevelSizes(width,height);
 let texels=0;
 for(const [w,h] of sizes)texels+=w*h;
 return {sizes,bytes:Math.max(4,texels*4)};
}

function writeUni(device:GPUDevice,buffer:GPUBuffer,packed:Float32Array,ints:number[],byteOffset=0){
 packed.fill(0);
 const u32=new Uint32Array(packed.buffer,packed.byteOffset,packed.length);
 for(let i=0;i<ints.length;i++)u32[i]=ints[i];
 device.queue.writeBuffer(buffer,byteOffset,packed.buffer as ArrayBuffer,packed.byteOffset,packed.byteLength);
}

/** This-frame Hi-Z from the visbuffer r32float depth (background 1, max reduction). Missing compute returns undefined. */
export async function createGpuHiz(device:GPUDevice,width:number,height:number,maxBounds:number):Promise<GpuHiz|undefined>{
 if(typeof device.createComputePipeline!=='function'||width<1||height<1)return undefined;
 const cap=Math.max(1,maxBounds);
 const uniData=new Float32Array(UNIFORM_BYTES/4);
 const buffers:GPUBuffer[]=[];
  let disposed=false,level0:GPUTexture|undefined,level0View:GPUTextureView|undefined,pyramid:GPUBuffer|undefined,historyPyramid:GPUBuffer|undefined,bindGroup:GPUBindGroup|undefined;
  let hasHistory=false,currentPyramidBytes=0;
  let sizes:Array<[number,number]>=[];
  try{
   if(typeof device.pushErrorScope==='function')device.pushErrorScope('validation');
   const layout=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
    {binding:1,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'unfilterable-float'}},
    {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:UNIFORM_BYTES}},
    {binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
    {binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},
   ]});
   const module=device.createShaderModule({code:HIZ_SHADER});
   if(typeof module.getCompilationInfo==='function'){
    const info=await module.getCompilationInfo();
    if(info.messages.some(message=>message.type==='error')){
     if(typeof device.popErrorScope==='function')await device.popErrorScope().catch(()=>{});
     return undefined;
    }
   }
   const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
   const copyPipeline=device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'copyDepth'}});
   const reducePipeline=device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'reduceHiz'}});
   const testPipeline=device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint:'testHiz'}});
   if(typeof device.popErrorScope==='function'){
    const error=await device.popErrorScope();
    if(error)return undefined;
   }
   const uniformSlots=MAX_LEVELS+2;
   const uniforms=device.createBuffer({size:UNIFORM_BYTES*uniformSlots,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   const bounds=device.createBuffer({size:Math.max(32,cap*32),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
   const flags=device.createBuffer({size:Math.max(4,cap*4),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
   buffers.push(uniforms,bounds,flags);
   const bind=(nextPyramid:GPUBuffer,nextView:GPUTextureView)=>{
    bindGroup=device.createBindGroup({layout,entries:[
     {binding:0,resource:{buffer:nextPyramid}},
     {binding:1,resource:nextView},
     {binding:2,resource:{buffer:uniforms,size:UNIFORM_BYTES}},
     {binding:3,resource:{buffer:bounds}},
     {binding:4,resource:{buffer:flags}},
    ]});
   };
   const alloc=(w:number,h:number)=>{
    const packed=pyramidBytes(w,h);
    sizes=packed.sizes;
    currentPyramidBytes=packed.bytes;
    hasHistory=false;
    level0?.destroy();pyramid?.destroy();historyPyramid?.destroy();
    level0=device.createTexture({size:{width:w,height:h},format:'r32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    level0View=level0.createView();
    pyramid=device.createBuffer({size:packed.bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
    historyPyramid=device.createBuffer({size:packed.bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
    bind(pyramid,level0View);
    return true;
   };
   if(!alloc(width,height)||!level0||!level0View||!pyramid||!bindGroup){
    for(const buffer of buffers)buffer.destroy();
    level0?.destroy();pyramid?.destroy();historyPyramid?.destroy();
    return undefined;
   }
   const gpu:GpuHiz={
    width,height,level0,level0View,flags,
    encodePyramid(encoder){
     if(disposed||!bindGroup||!pyramid)return;
     writeUni(device,uniforms,uniData,[gpu.width,gpu.height,0],0);
     const copy=encoder.beginComputePass({label:'WG HiZ depth copy'});
     copy.setPipeline(copyPipeline);copy.setBindGroup(0,bindGroup,[0]);
     copy.dispatchWorkgroups(Math.max(1,Math.ceil(gpu.width/WORKGROUP)),Math.max(1,Math.ceil(gpu.height/WORKGROUP)));
     copy.end();
     for(let i=0;i<sizes.length-1;i++){
      const [srcW,srcH]=sizes[i],[dstW,dstH]=sizes[i+1];
      let srcOffset=0;for(let k=0;k<i;k++)srcOffset+=sizes[k][0]*sizes[k][1];
      const dstOffset=srcOffset+srcW*srcH;
      writeUni(device,uniforms,uniData,[srcOffset,srcW,srcH,dstOffset,dstW,dstH],(i+1)*UNIFORM_BYTES);
      const reduce=encoder.beginComputePass({label:'WG HiZ reduction'});
      reduce.setPipeline(reducePipeline);reduce.setBindGroup(0,bindGroup,[(i+1)*UNIFORM_BYTES]);
      reduce.dispatchWorkgroups(Math.max(1,Math.ceil(dstW/WORKGROUP)),Math.max(1,Math.ceil(dstH/WORKGROUP)));
      reduce.end();
     }
    },
    encodeTest(queueDevice,encoder,next){
     if(disposed||!bindGroup)return 0;
     const count=Math.min(next.length,cap);
     const bytes=new ArrayBuffer(Math.max(32,count*32));
     const f32=new Float32Array(bytes),i32=new Int32Array(bytes),u32=new Uint32Array(bytes);
     for(let i=0;i<count;i++){
      const b=next[i],base=i*8;
      i32[base]=b.minX;i32[base+1]=b.minY;i32[base+2]=b.maxX;i32[base+3]=b.maxY;
      f32[base+4]=b.nearestDepth;u32[base+5]=b.clipsNear?1:0;
     }
     if(count)queueDevice.queue.writeBuffer(bounds,0,bytes,0,count*32);
     const biasBits=new Uint32Array(new Float32Array([0]).buffer)[0];
     const testSlot=MAX_LEVELS+1;
     writeUni(queueDevice,uniforms,uniData,[gpu.width,gpu.height,count,biasBits],testSlot*UNIFORM_BYTES);
     const pass=encoder.beginComputePass({label:'WG HiZ test'});
     pass.setPipeline(testPipeline);pass.setBindGroup(0,bindGroup,[testSlot*UNIFORM_BYTES]);
     pass.dispatchWorkgroups(Math.max(1,Math.ceil(count/TEST_WORKGROUP)));
     pass.end();
     return count;
    },
    encodeCopyHistory(encoder){
     if(disposed||!pyramid||!historyPyramid||currentPyramidBytes<=0)return;
     encoder.copyBufferToBuffer(pyramid,0,historyPyramid,0,currentPyramidBytes);
     hasHistory=true;
    },
    hasHistory(){
     return hasHistory&&!disposed;
    },
    resize(nextDevice,nextWidth,nextHeight){
     if(disposed||!nextDevice||nextWidth<1||nextHeight<1)return false;
     if(nextWidth===gpu.width&&nextHeight===gpu.height&&level0)return true;
     try{
      if(!alloc(nextWidth,nextHeight)||!level0||!level0View)return false;
      gpu.width=nextWidth;gpu.height=nextHeight;gpu.level0=level0;gpu.level0View=level0View;
      return true;
     }catch{return false;}
    },
    dispose(){
     disposed=true;
     hasHistory=false;
     for(const buffer of buffers)buffer.destroy();
     level0?.destroy();pyramid?.destroy();historyPyramid?.destroy();
     level0=undefined;level0View=undefined;pyramid=undefined;historyPyramid=undefined;bindGroup=undefined;
    },
   };
   return gpu;
  }catch{
   if(typeof device.popErrorScope==='function')await device.popErrorScope().catch(()=>{});
   for(const buffer of buffers)try{buffer.destroy();}catch{/* Partial Hi-Z setup must not leak. */}
   try{level0?.destroy();}catch{/* */}
   try{pyramid?.destroy();}catch{/* */}
   try{historyPyramid?.destroy();}catch{/* */}
   return undefined;
  }
}
