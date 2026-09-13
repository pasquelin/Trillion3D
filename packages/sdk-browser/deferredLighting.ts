import {STANDARD_LIGHTING_WGSL} from './standardLighting.ts';
import {SCENE_LIGHTING_WGSL} from './sceneLighting.ts';
import type {SurfaceBuffer} from './surfaceBuffer.ts';

export const FULLSCREEN_VERTEX=`@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);}`;
export const OUTPUT_COLOR_WGSL=`
fn aces(color:vec3f)->vec3f{
 var c=color/0.6;
 c=mat3x3f(vec3f(0.59719,0.07600,0.02840),vec3f(0.35458,0.90834,0.13383),vec3f(0.04823,0.01566,0.83777))*c;
 let a=c*(c+0.0245786)-0.000090537;let b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
 c=mat3x3f(vec3f(1.60475,-0.10208,-0.00327),vec3f(-0.53108,1.10813,-0.07276),vec3f(-0.07367,-0.00605,1.07602))*c;
 return clamp(c,vec3f(0.0),vec3f(1.0));
}
fn linearToSrgb(c:vec3f)->vec3f{return select(1.055*pow(max(c,vec3f(0.0)),vec3f(0.41666))-0.055,c*12.92,c<vec3f(0.0031308));}`;
export const DEFERRED_LIGHTING_SHADER=`
struct View{inverseViewProjection:mat4x4f,camera:vec4f,viewport:vec4f,background:vec4f,}
@group(0) @binding(0) var baseMetal:texture_2d<f32>;
@group(0) @binding(1) var normalRough:texture_2d<f32>;
@group(0) @binding(2) var emissiveAo:texture_2d<f32>;
@group(0) @binding(3) var flags:texture_2d<u32>;
@group(0) @binding(4) var depth:texture_depth_2d;
@group(0) @binding(5) var<uniform> view:View;
@group(0) @binding(6) var<storage,read> sceneLights:SceneLights;
${STANDARD_LIGHTING_WGSL}
${SCENE_LIGHTING_WGSL}
${FULLSCREEN_VERTEX}
@fragment fn lightSurface(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);let flag=textureLoad(flags,coord,0).r;
 if(flag==0u){return vec4f(0.0);}
 let base=textureLoad(baseMetal,coord,0);
 if(flag==1u||flag==3u){return vec4f(base.rgb,1.0);}
 let normal=textureLoad(normalRough,coord,0);let emissive=textureLoad(emissiveAo,coord,0);
 let z=textureLoad(depth,coord,0);
 let ndc=vec4f(pixel.x/view.viewport.x*2.0-1.0,1.0-pixel.y/view.viewport.y*2.0,z,1.0);
 let world=view.inverseViewProjection*ndc;let P=world.xyz/world.w;
 let V=normalize(view.camera.xyz-P);
 return vec4f(sceneLighting(base.rgb,base.a,normal.a,normalize(normal.xyz),V,P,emissive.a)+emissive.rgb,1.0);
}`;
const COMPOSE_SHADER=`
struct View{inverseViewProjection:mat4x4f,camera:vec4f,viewport:vec4f,background:vec4f,}
@group(0) @binding(0) var hdr:texture_2d<f32>;
@group(0) @binding(1) var<uniform> view:View;
${FULLSCREEN_VERTEX}
${OUTPUT_COLOR_WGSL}
fn composeColor(pixel:vec4f)->vec4f{
 let value=textureLoad(hdr,vec2i(pixel.xy),0);
 if(value.a==0.0){return view.background;}
 if(view.viewport.z!=0.0){return vec4f(value.rgb,1.0);}
 let color=linearToSrgb(aces(value.rgb/max(value.a,1e-6)));
 return vec4f(color*value.a+view.background.rgb*(1.0-value.a),1.0);
}
@fragment fn compose(@builtin(position) pixel:vec4f)->@location(0) vec4f{return composeColor(pixel);}
struct DisplayOutput{@location(0) capture:vec4f,@location(1) canvas:vec4f,}
@fragment fn composePresent(@builtin(position) pixel:vec4f)->DisplayOutput{
 let color=composeColor(pixel);
 return DisplayOutput(color,color);
}`;

export async function createDeferredLighting(device:GPUDevice,lights:GPUBuffer){
 const uniform=device.createBuffer({label:'WG deferred view v1',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const modules=[DEFERRED_LIGHTING_SHADER,COMPOSE_SHADER].map(code=>device.createShaderModule({code}));
 try{
  for(const module of modules){const info=await module.getCompilationInfo?.();const errors=info?.messages.filter(message=>message.type==='error');if(errors?.length)throw new Error(errors.map(error=>error.message).join('\n'));}
  const entries:GPUBindGroupLayoutEntry[]=[0,1,2,3,4].map(binding=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:binding===3?'uint':binding===4?'depth':'unfilterable-float'}}));
  entries.push({binding:5,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:6,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}});
  const lightingLayout=device.createBindGroupLayout({entries});
  const compositionLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
  const make=(module:GPUShaderModule,bind:GPUBindGroupLayout,entryPoint:string,formats:GPUTextureFormat[])=>{const descriptor:GPURenderPipelineDescriptor={layout:device.createPipelineLayout({bindGroupLayouts:[bind]}),vertex:{module,entryPoint:'fullscreen'},fragment:{module,entryPoint,targets:formats.map(format=>({format}))},primitive:{topology:'triangle-list'}};return device.createRenderPipelineAsync?device.createRenderPipelineAsync(descriptor):Promise.resolve(device.createRenderPipeline(descriptor));};
  const light=await make(modules[0],lightingLayout,'lightSurface',['rgba16float']),compose=await make(modules[1],compositionLayout,'compose',['rgba8unorm']);
  const composePresent=await make(modules[1],compositionLayout,'composePresent',['rgba8unorm','bgra8unorm']);
  let boundSurface:SurfaceBuffer|undefined,lightGroup:GPUBindGroup|undefined,composeGroup:GPUBindGroup|undefined;
  const packed=new Float32Array(28);
  return {
   uniform,
   update(inverseViewProjection:readonly number[],camera:readonly number[],width:number,height:number,clearColor:number,diagnostic:boolean){packed.set(inverseViewProjection,0);packed.set(camera,16);packed.set([width,height,diagnostic?1:0,0],20);packed.set([(clearColor>>16)/255,((clearColor>>8)&255)/255,(clearColor&255)/255,1],24);device.queue.writeBuffer(uniform,0,packed);},
   bind(surface:SurfaceBuffer,depth:GPUTextureView,hdr:GPUTextureView){if(boundSurface===surface)return;boundSurface=surface;lightGroup=device.createBindGroup({layout:lightingLayout,entries:[...surface.views().map((resource,binding)=>({binding,resource})),{binding:4,resource:depth},{binding:5,resource:{buffer:uniform}},{binding:6,resource:{buffer:lights}}]});composeGroup=device.createBindGroup({layout:compositionLayout,entries:[{binding:0,resource:hdr},{binding:1,resource:{buffer:uniform}}]});},
   light(encoder:GPUCommandEncoder,target:GPUTextureView){if(!lightGroup)throw new Error('SURFACE_NOT_BOUND');const pass=encoder.beginRenderPass({label:'WG deferred lighting',colorAttachments:[{view:target,loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]});pass.setPipeline(light);pass.setBindGroup(0,lightGroup);pass.draw(3);pass.end();},
   compose(encoder:GPUCommandEncoder,target:GPUTextureView,clear:GPUColor,presentation?:GPUTextureView){
    if(!composeGroup)throw new Error('SURFACE_NOT_BOUND');
    // Both UNORM targets receive the same display value. Keep the persistent
    // capture image while avoiding a separate fullscreen read and presentation.
    const colorAttachments:GPURenderPassColorAttachment[]=[{view:target,loadOp:'clear',storeOp:'store',clearValue:clear}];
    if(presentation)colorAttachments.push({view:presentation,loadOp:'clear',storeOp:'store',clearValue:clear});
    const pass=encoder.beginRenderPass({label:presentation?'WG HDR composition + present':'WG HDR composition',colorAttachments});
    pass.setPipeline(presentation?composePresent:compose);pass.setBindGroup(0,composeGroup);pass.draw(3);pass.end();
   },
   dispose(){uniform.destroy();boundSurface=undefined;lightGroup=composeGroup=undefined;},
  };
 }catch(error){uniform.destroy();throw error;}
}
