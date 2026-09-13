import {createSurfaceBuffer,checkSurfaceSize,frameTargetBytes,SURFACE_FORMATS,type SurfaceBuffer,type SurfaceCapture} from './surfaceBuffer.ts';
import {createSceneLightBuffer,SCENE_LIGHTING_WGSL} from './sceneLighting.ts';
import {createDeferredLighting} from './deferredLighting.ts';
import {createGpuPresenter,readGpuImage,createSynchronousCanvasCapture} from './gpuPresentation.ts';
import {STANDARD_LIGHTING_WGSL,NORMAL_TRANSFORM_WGSL} from './standardLighting.ts';
import {generateMaterialMips} from './textureMips.ts';
import {createGpuTiming} from './gpuTiming.ts';
import type {BackendCapabilities,BackendFactory,RenderBackend} from './backendTypes.ts';
import {createGpuPageCache,type ResidentPage} from './gpuPages.ts';
import {collectClusterPages,collectPendingUrls,indexPagesByUrl,resolvePixelError,selectVisiblePages,rootCoverage,type PageRec} from './pageSelection.ts';
import {cameraSelectionUniforms,createGpuSelection,packSelectionForest,sameSelectionUniforms,type GpuSelection,type SelectionResult,type SelectionUniforms} from './gpuSelection.ts';
import {OPEN_CONE,triangleCone} from './pageCone.ts';
import {RASTER_BACKGROUND} from './pageRaster.ts';
import {applyTemporalHiz,projectBoxToScreen,splitOccluders,type HizBounds,type TemporalHizState} from './hiz.ts';
import {createGpuHiz,type GpuHiz} from './gpuHiz.ts';
import {BIN_BACK,BIN_FRONT,BIN_NONE,compactSlotLayout,createGpuDraw,evaluateDrawCompact,type DrawItem,type GpuDraw,type SlotLayout} from './gpuDraw.ts';
import {FLAG_BACK,FLAG_DOUBLE,FLAG_HAS_MAP,FLAG_HAS_NORMAL,FLAG_HAS_TANGENT,FLAG_HAS_NORMAL_MAP,FLAG_HAS_ORM,FLAG_HAS_UV,FLAG_LIT,FLAG_MASK,FLAG_WRAP_S_REPEAT,FLAG_WRAP_T_REPEAT,PAGE_INFO_STRIDE,SHADE_SHADER,VIS_SHADER,clusterHash,isTransmissive,rasterVisibilityIds,shadeVisibility,textureRgba,visMaterial} from './visibilityBuffer.ts';
import type {DiagnosticMode} from '../sdk-core/index.ts';
import * as THREE from 'three';

const SHADER=`struct Uniforms{viewProj:mat4x4f,world:mat4x4f,color:vec4f,pageOffset:u32,indexCount:u32,mode:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read> indices:array<u32>;
@group(0) @binding(1) var<storage, read> positions:array<f32>;
@group(0) @binding(2) var<uniform> uni:Uniforms;
struct VSOut{@builtin(position) position:vec4f,@location(0) color:vec4f,@location(1) bary:vec3f,@location(2) view:vec3f,@location(3) @interpolate(flat) tri:u32,}
@vertex fn vs(@builtin(vertex_index) vertexIndex:u32)->VSOut{
 var out:VSOut;
 if(vertexIndex>=uni.indexCount){out.position=vec4f(0.0,0.0,0.0,1.0);out.color=vec4f(0.0);out.bary=vec3f(0.0);out.view=vec3f(0.0);out.tri=0u;return out;}
 let id=indices[uni.pageOffset+vertexIndex];
 let world=uni.world*vec4f(positions[id*3u],positions[id*3u+1u],positions[id*3u+2u],1.0);
 out.position=uni.viewProj*world;out.view=world.xyz;out.color=uni.color;out.tri=vertexIndex/3u+uni.pageOffset;
 let corner=vertexIndex%3u;
 out.bary=select(select(vec3f(0.0,0.0,1.0),vec3f(0.0,1.0,0.0),corner==1u),vec3f(1.0,0.0,0.0),corner==0u);
 return out;
}
fn aces(color:vec3f)->vec3f{
 var c=color/0.6;
 c=mat3x3f(vec3f(0.59719,0.07600,0.02840),vec3f(0.35458,0.90834,0.13383),vec3f(0.04823,0.01566,0.83777))*c;
 let a=c*(c+0.0245786)-0.000090537;let b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
 c=mat3x3f(vec3f(1.60475,-0.10208,-0.00327),vec3f(-0.53108,1.10813,-0.07276),vec3f(-0.07367,-0.00605,1.07602))*c;
 return clamp(c,vec3f(0.0),vec3f(1.0));
}
fn linearToSrgb(c:vec3f)->vec3f{return select(1.055*pow(c,vec3f(0.41666))-0.055,c*12.92,c<vec3f(0.0031308));}
fn hashColor(id:u32)->vec3f{let x=f32(id);return fract(sin(vec3f(x,x*1.37,x*2.17)*vec3f(12.9898,78.233,45.164))*43758.5453);}
@fragment fn fs(in:VSOut)->@location(0) vec4f{
 if(uni.mode==1u){
  let n=normalize(cross(dpdx(in.view),dpdy(in.view)));
  let wrap=0.28+0.72*max(0.0,abs(n.z));
  let width=fwidth(in.bary);
  let edge=1.0-min(min(smoothstep(0.0,width.x*1.2,in.bary.x),smoothstep(0.0,width.y*1.2,in.bary.y)),smoothstep(0.0,width.z*1.2,in.bary.z));
  return vec4f(mix(hashColor(in.tri)*wrap,vec3f(0.04,0.05,0.07),edge),1.0);
 }
 return vec4f(linearToSrgb(aces(in.color.xyz)),1.0);
}
`;

const BLEND_SHADER=`struct Uniforms{viewProj:mat4x4f,world:mat4x4f,color:vec4f,pageOffset:u32,indexCount:u32,mapIndex:u32,flags:u32,uvScale:vec2f,emissiveIndex:u32,alphaTest:f32,camPos:vec4f,lightDir:vec4f,roughness:f32,metalness:f32,normalScale:vec2f,roughIndex:u32,metalIndex:u32,normalIndex:u32,aoIndex:u32,aoIntensity:f32,emissiveR:f32,emissiveG:f32,emissiveB:f32,}
@group(0) @binding(0) var<storage, read> indices:array<u32>;
@group(0) @binding(1) var<storage, read> positions:array<f32>;
@group(0) @binding(2) var<storage, read> uvs:array<f32>;
@group(0) @binding(3) var<uniform> uni:Uniforms;
@group(0) @binding(4) var maps:texture_2d_array<f32>;
@group(0) @binding(5) var mapsSampler:sampler;
@group(0) @binding(6) var dataMaps:texture_2d_array<f32>;
@group(0) @binding(7) var<storage,read> normals:array<f32>;
@group(0) @binding(8) var<storage,read> scales:array<vec4f>;
${STANDARD_LIGHTING_WGSL}
${SCENE_LIGHTING_WGSL}
@group(0) @binding(9) var<storage,read> sceneLights:SceneLights;
${NORMAL_TRANSFORM_WGSL}
struct VSOut{@builtin(position) position:vec4f,@location(0) color:vec4f,@location(1) uv:vec2f,@location(2) view:vec3f,@location(3) normal:vec3f,@location(4) tangent:vec3f,@location(5) bitangent:vec3f,}
fn wrapCoord(t:f32,repeat:bool)->f32{return select(clamp(t,0.0,1.0),fract(t),repeat);}
fn aces(color:vec3f)->vec3f{
 var c=color/0.6;
 c=mat3x3f(vec3f(0.59719,0.07600,0.02840),vec3f(0.35458,0.90834,0.13383),vec3f(0.04823,0.01566,0.83777))*c;
 let a=c*(c+0.0245786)-0.000090537;let b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
 c=mat3x3f(vec3f(1.60475,-0.10208,-0.00327),vec3f(-0.53108,1.10813,-0.07276),vec3f(-0.07367,-0.00605,1.07602))*c;
 return clamp(c,vec3f(0.0),vec3f(1.0));
}
fn linearToSrgb(c:vec3f)->vec3f{return select(1.055*pow(c,vec3f(0.41666))-0.055,c*12.92,c<vec3f(0.0031308));}
@vertex fn vs(@builtin(vertex_index) vertexIndex:u32)->VSOut{
 var out:VSOut;
 if(vertexIndex>=uni.indexCount){out.position=vec4f(0.0,0.0,2.0,1.0);out.color=vec4f(0.0);out.uv=vec2f(0.0);out.view=vec3f(0.0);out.normal=vec3f(0.0,0.0,1.0);out.tangent=vec3f(0.0);out.bitangent=vec3f(0.0);return out;}
 let id=indices[uni.pageOffset+vertexIndex];
 let world=uni.world*vec4f(positions[id*3u],positions[id*3u+1u],positions[id*3u+2u],1.0);
 out.position=uni.viewProj*world;out.view=world.xyz;out.color=uni.color;
 out.normal=vec3f(0.0);
 if((uni.flags&16u)!=0u){out.normal=xformNormal(uni.world,vec3f(normals[id*7u],normals[id*7u+1u],normals[id*7u+2u]));}
 out.tangent=vec3f(0.0);out.bitangent=vec3f(0.0);
 if((uni.flags&256u)!=0u){out.normal=-out.normal;}
 if((uni.flags&2048u)!=0u){
  out.tangent=normalize((uni.world*vec4f(normals[id*7u+3u],normals[id*7u+4u],normals[id*7u+5u],0.0)).xyz);
  if((uni.flags&256u)!=0u){out.tangent=-out.tangent;}
  out.bitangent=normalize(cross(out.normal,out.tangent)*normals[id*7u+6u]);
 }
 let i=id*2u;out.uv=vec2f(uvs[i],uvs[i+1u]);
 return out;
}
@fragment fn fs(in:VSOut,@builtin(front_facing) front:bool)->@location(0) vec4f{
 let gradX=dpdx(in.uv);let gradY=dpdy(in.uv);
 let q0=dpdx(in.view);let q1=dpdy(in.view);
 var N=normalize(-cross(q0,q1));
 if((uni.flags&16u)!=0u){N=normalize(in.normal);}
 let face=select(-1.0,1.0,front);
 if((uni.flags&2u)!=0u){N*=face;}
 let wrapped=vec2f(wrapCoord(in.uv.x,(uni.flags&32u)!=0u),wrapCoord(in.uv.y,(uni.flags&64u)!=0u));
 let sample=textureSampleGrad(maps,mapsSampler,wrapped*uni.uvScale,i32(uni.mapIndex),gradX*uni.uvScale,gradY*uni.uvScale);
 let alpha=sample.w*in.color.w;
 var rgb=in.color.xyz*sample.xyz;
 var rough=uni.roughness;var metal=uni.metalness;var ao=1.0;
 if(uni.roughIndex!=0u){let scale=scales[uni.roughIndex].xy;rough*=textureSampleGrad(dataMaps,mapsSampler,wrapped*scale,i32(uni.roughIndex),gradX*scale,gradY*scale).g;}
 if(uni.metalIndex!=0u){let scale=scales[uni.metalIndex].xy;metal*=textureSampleGrad(dataMaps,mapsSampler,wrapped*scale,i32(uni.metalIndex),gradX*scale,gradY*scale).b;}
 if(uni.aoIndex!=0u){let scale=scales[uni.aoIndex].xy;ao+=uni.aoIntensity*(textureSampleGrad(dataMaps,mapsSampler,wrapped*scale,i32(uni.aoIndex),gradX*scale,gradY*scale).r-1.0);}
 if(uni.normalIndex!=0u){
  let scale=scales[uni.normalIndex].xy;
  let mapN=textureSampleGrad(dataMaps,mapsSampler,wrapped*scale,i32(uni.normalIndex),gradX*scale,gradY*scale).xyz*2.0-vec3f(1.0);
  var T=-(cross(q1,N)*gradX.x+cross(N,q0)*gradY.x);
  var B=-(cross(q1,N)*gradX.y+cross(N,q0)*gradY.y);
  if((uni.flags&2048u)!=0u){T=normalize(in.tangent);B=normalize(in.bitangent);}
  if((uni.flags&2u)!=0u){T*=face;B*=face;}
  let tbnScale=inverseSqrt(max(max(dot(T,T),dot(B,B)),1e-20));
  N=normalize(T*tbnScale*mapN.x*uni.normalScale.x+B*tbnScale*mapN.y*uni.normalScale.y+N*mapN.z);
 }
 var emissive=vec3f(uni.emissiveR,uni.emissiveG,uni.emissiveB);
 if(uni.emissiveIndex!=0u){let scale=scales[uni.emissiveIndex].zw;emissive*=textureSampleGrad(maps,mapsSampler,wrapped*scale,i32(uni.emissiveIndex),gradX*scale,gradY*scale).rgb;}
 if(alpha<uni.alphaTest){discard;}
 if((uni.flags&1u)!=0u){rgb=sceneLighting(rgb,clamp(metal,0.0,1.0),clamp(rough,0.0525,1.0),N,normalize(uni.camPos.xyz-in.view),in.view,ao)+emissive;}
 return vec4f(rgb,alpha);
}
`;

const viewProj=new THREE.Matrix4(),remap=new THREE.Matrix4().set(1,0,0,0,0,1,0,0,0,0,0.5,0.5,0,0,0,1),colorScratch=new THREE.Color();
const PAGES_GREEN:[number,number,number]=[0.204,0.827,0.6];

const rgbHex=(red:number,green:number,blue:number)=>`#${[red,green,blue].map(channel=>channel.toString(16).padStart(2,'0')).join('')}`;

/** First GPU readback evidence: requested clear versus two actual pixels from the color target. */
export function outputColorDiagnostic(pixels:Uint8Array,width:number,height:number,clearColor:number,origin:'top-left'|'bottom-left'='top-left'){
 const pixel=(x:number,y:number)=>{const offset=((origin==='bottom-left'?height-1-y:y)*width+x)*4;return rgbHex(pixels[offset]??0,pixels[offset+1]??0,pixels[offset+2]??0);};
 const clearHex=`#${clearColor.toString(16).padStart(6,'0')}`;
 const topLeft=pixel(0,0),center=pixel(Math.floor(width/2),Math.floor(height/2));
 return {clearColor:clearHex,topLeft,center,matchesClearAtTopLeft:topLeft===clearHex};
}

function lighting(scene:THREE.Scene,clearColor:number){
 scene.background=new THREE.Color(clearColor);
 scene.add(new THREE.HemisphereLight(0xffffff,0x495061,2));
 const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(1,3,2);scene.add(light);
}
function linearColor(material:THREE.Material|THREE.Material[]):[number,number,number]{
 const first=Array.isArray(material)?material[0]:material;
 const color=(first as THREE.MeshBasicMaterial).color;
 if(!color)return [1,1,1];
 colorScratch.copy(color);if(THREE.ColorManagement.enabled)colorScratch.convertSRGBToLinear();
 return [colorScratch.r,colorScratch.g,colorScratch.b];
}
function clusterRgb(id:string):[number,number,number]{
 let hash=0;for(let i=0;i<id.length;i++)hash=(Math.imul(hash,31)+id.charCodeAt(i))>>>0;
 colorScratch.setHSL((hash*.61803398875)%1,.75,.55);
 if(THREE.ColorManagement.enabled)colorScratch.convertSRGBToLinear();
 return [colorScratch.r,colorScratch.g,colorScratch.b];
}
function materialSide(material:THREE.Material|THREE.Material[]){return Array.isArray(material)?material[0].side:material.side;}

export type WebgpuPagesBackend=RenderBackend&{flush():Promise<void>;rasterRgba():Uint8Array;selectedPageIds():string[];visibilityIds():Uint32Array};

function shownFromGpu(pages:PageRec[],result:SelectionResult,frame:number){
 const shown:PageRec[]=[];let selectedTriangles=0;
 for(const id of result.pageIds){const rec=pages[id];if(!rec)continue;rec.seen=frame;shown.push(rec);selectedTriangles+=rec.triangles;}
 return {shown,visible:shown.length,selectedTriangles,frustumRejected:result.frustumRejected,lodLevel:result.lodLevel};
}

/** WebGPU raster of Format 1 pages. GPU frustum + lodScore when compute is available; CPU selectVisiblePages remains the oracle and the silent fallback. */
export const webgpuPagesBackend:BackendFactory=(context)=>{
 const {source,metadata,indices,associations,maxResidentPages,gpuDevice}=context;
 const viewport=context.viewport??[1,1];
 const clearColor=context.clearColor??RASTER_BACKGROUND;
 const diagnosticDetail=(context as typeof context&{diagnosticDetail?:'summary'|'trace'}).diagnosticDetail;
 const traceEnabled=!!context.onDiagnostic&&diagnosticDetail!=='summary';
 type TraceDiagnostic={phase:string;message:string;context:Record<string,unknown>};
 const traceQueue:TraceDiagnostic[]=[];
 const maxTraceQueue=65536;
 let droppedTraceDiagnostics=0,traceLossPending=0;
 let traceScheduled=false;
 const drainTraceNow=()=>{
  const batch=traceQueue.splice(0);
  for(const event of batch){try{context.onDiagnostic?.(event);}catch{/* Host collectors do not control rendering. */}}
  if(traceLossPending){const dropped=traceLossPending;traceLossPending=0;try{context.onDiagnostic?.({phase:'diagnostic-loss',message:'Diagnostics trace supprimés pour respecter la borne mémoire',context:{pipelineVersion:1,backend:'webgpu-page-raster',dropped,queueLimit:maxTraceQueue}});}catch{/* Host collectors do not control rendering. */}}
 };
 const flushTraceQueue=()=>{
  if(traceScheduled||!traceQueue.length)return;
  traceScheduled=true;
  queueMicrotask(()=>{
   traceScheduled=false;
   drainTraceNow();
   if(traceQueue.length)flushTraceQueue();
  });
 };
 const traceDiagnostic=(phase:string,message:string,details:Record<string,unknown>|(()=>Record<string,unknown>))=>{
  if(!traceEnabled)return;
  if(traceQueue.length>=maxTraceQueue){droppedTraceDiagnostics++;traceLossPending++;return;}
  const payload=typeof details==='function'?details():details;
  traceQueue.push({phase,message,context:{pipelineVersion:1,createdAt:Date.now(),...payload,droppedDiagnostics:droppedTraceDiagnostics||undefined}});flushTraceQueue();
 };
 const engineDiagnostic=(phase:string,message:string,details:Record<string,unknown>)=>{try{context.onDiagnostic?.({phase,message,context:{pipelineVersion:1,...details}});}catch{/* Observers do not control rendering. */}};
 const loggedFailures=new Set<string>(),failureOccurrences=new Map<string,number>();
 const diagnosticFailure=(phase:string,error:unknown)=>{
  const objectError=error&&typeof error==='object'?error as {message?:unknown;name?:unknown;stack?:unknown;cause?:unknown}:undefined;
  const details={error:objectError?.message!==undefined?String(objectError.message):String(error),backend:'webgpu-page-raster'};
  const occurrence=(failureOccurrences.get(phase)??0)+1;failureOccurrences.set(phase,occurrence);
  if(traceEnabled){traceDiagnostic(phase,'Échec du chemin WebGPU',()=>({...details,name:objectError?.name?String(objectError.name):undefined,stack:objectError?.stack?String(objectError.stack).slice(0,8192):undefined,cause:objectError?.cause===undefined?undefined:String(objectError.cause).slice(0,2048),occurrence}));return;}
  if(loggedFailures.has(phase))return;loggedFailures.add(phase);engineDiagnostic(phase,'Échec du chemin WebGPU',details);
 };
 const onGpuError=(event:GPUUncapturedErrorEvent)=>{diagnosticFailure('gpu-uncaptured-error',event.error);lost=true;};
 const inputColor={clearColor:`#${clearColor.toString(16).padStart(6,'0')}`,value:clearColor,source:context.clearColor===undefined?'fallback moteur':'hôte'};
 engineDiagnostic('clear-color-input','Couleur de fond reçue par WebGeometry WebGPU',inputColor);
 if(typeof window!=='undefined')console.info('[web-geometry] couleur de fond reçue par WebGeometry WebGPU',inputColor);
 const {roots,allPages,blendCopies,prepared}=collectClusterPages(source,metadata,indices,associations,{allowMissing:true});
 // Transparent pages share selection/residency with opaque pages, but retain
 // one forward draw per source mesh (all back faces, then all front faces).
 const pagedBlendCopies=new Map<THREE.Mesh,THREE.Mesh>();
 for(const rec of allPages)if(rec.transparent&&rec.sourceMesh&&!pagedBlendCopies.has(rec.sourceMesh)){
  const mesh=rec.sourceMesh,copy=new THREE.Mesh(mesh.geometry,mesh.material);
  copy.matrixAutoUpdate=false;copy.matrix.copy(mesh.matrixWorld);copy.renderOrder=rec.renderOrder;
  copy.userData.sourceMesh=mesh;copy.userData.pagedBlend=true;
  pagedBlendCopies.set(mesh,copy);blendCopies.push(copy);
 }
 blendCopies.sort((a,b)=>a.renderOrder-b.renderOrder);
 const pageCatalog=[...new Set(allPages.map(page=>page.url))],pageCatalogIds=new Map(pageCatalog.map((url,index)=>[url,index]));
 const pageRefs=(urls:string[])=>urls.map(url=>pageCatalogIds.get(url)??url);
 const traceSets=new Map<string,{revision:number;urls:string[]}>();
 const traceSet=(name:string,urls:string[])=>{
  const previous=traceSets.get(name);
  if(previous&&previous.urls.length===urls.length&&previous.urls.every((url,index)=>url===urls[index]))return {revision:previous.revision,changed:false};
  const next={revision:(previous?.revision??0)+1,urls:[...urls]};traceSets.set(name,next);
  return {revision:next.revision,changed:true,pageIds:pageRefs(urls)};
 };
 traceDiagnostic('page-catalog','Catalogue stable des pages WebGPU',{backend:'webgpu-page-raster',count:pageCatalog.length,urls:pageCatalog});
 const bootstrap=rootCoverage(roots),bootstrapUrls=new Set(bootstrap.map(page=>page.url));
 let bootstrapReady=false,bootstrapLoading:Promise<void>|undefined,coverageBudgetLimited=false;
 const deferredDrops=new Set<string>();
 let coverageBudgetEvent:Record<string,unknown>|undefined;
 let residencyWanted=new Set<string>(),queuedResidency:PageRec[]|undefined,residencyRunning=false;
 const byUrl=indexPagesByUrl(allPages),pendingScratch:string[]=[],urlScratch:string[]=[],readyScratch:PageRec[]=[];
 const cap=maxResidentPages??Math.max(1024,prepared);
 const uniquePages=Math.max(1,new Set(allPages.map(page=>page.url)).size);
 const slots=Math.max(1,Math.min(cap,uniquePages));
 const scene=new THREE.Scene();lighting(scene,clearColor);for(const copy of blendCopies)scene.add(copy);
 const pageBytes=Math.max(4,...allPages.map(page=>{const n=page.array?.byteLength??page.indexBytes;return n+(n%4?4-n%4:0);}));
 const sourceBytes=new Map(allPages.flatMap(page=>page.array?[[page.url,new Uint8Array(page.array.buffer,page.array.byteOffset,page.array.byteLength)] as const]:[]));
 let cache:ReturnType<typeof createGpuPageCache>|undefined,bindGroupLayout:GPUBindGroupLayout|undefined;
 let pipelineBack:GPURenderPipeline|undefined,pipelineBackCw:GPURenderPipeline|undefined,pipelineNone:GPURenderPipeline|undefined,pipelineBlend:GPURenderPipeline|undefined,pipelineBlendTextured:GPURenderPipeline|undefined,pipelineBlendFront:GPURenderPipeline|undefined,pipelineBlendBack:GPURenderPipeline|undefined;
 let colorTexture:GPUTexture|undefined,depthTexture:GPUTexture|undefined,colorView:GPUTextureView|undefined,depthView:GPUTextureView|undefined;
 const positionBuffers=new Map<THREE.BufferGeometry['attributes'],GPUBuffer>(),positionIds=new WeakMap<GPUBuffer,number>();
 let nextPositionId=1;
 const UNIFORM_STRIDE=256;
 let uniformBuffer:GPUBuffer|undefined,uniformPacked=new Float32Array(UNIFORM_STRIDE/4);
 const bindGroups=new Map<number,GPUBindGroup>(),pins=new Set<string>(),clusterRgbCache=new Map<string,[number,number,number]>();
 let synchronousCapture:ReturnType<typeof createSynchronousCanvasCapture>|undefined;
 let presenter:ReturnType<typeof createGpuPresenter>|undefined;
 let canvasTexture:THREE.CanvasTexture|undefined,blitMaterial:THREE.ShaderMaterial|undefined,blit:THREE.Mesh|undefined;
 let surfaces:SurfaceBuffer|undefined,hdrTexture:GPUTexture|undefined,hdrView:GPUTextureView|undefined;
 let deferred:Awaited<ReturnType<typeof createDeferredLighting>>|undefined,lights:ReturnType<typeof createSceneLightBuffer>|undefined;
 const frameBudget=context.maxFrameAllocationBytes??256*1024*1024;
 const reserveHiz=typeof gpuDevice?.createComputePipeline==='function';
 const checkFrameBudget=(width:number,height:number,additional=0)=>{
  if(!gpuDevice)throw new Error('WEBGPU_UNAVAILABLE');
  checkSurfaceSize(gpuDevice,width,height,frameBudget,1);
  const bytes=frameTargetBytes(width,height,reserveHiz)+additional;
  if(bytes>frameBudget)throw new Error(`SURFACE_BUDGET: ${bytes} > ${frameBudget}`);
  return bytes;
 };
 let captureAllocationBytes=0,surfaceCapture:SurfaceCapture|undefined,secondaryCamera:THREE.PerspectiveCamera|undefined;
 let surfaceRenderAllowed=false,imageRevision=0,capturedRevision=-1,capturedPixels:Uint8Array|undefined,capturePending:Promise<void>|undefined;
 let captureStreamingDeferrals=0,captureDeferralLogged=false;
 let lightState:{count:number;types:string[]}|undefined;
 let blendSubmittedTriangles=0,blendDrawCalls=0,blendFrustumRejected=0,gpuDrawCalls=0,lastProgressMs=0;
 let lost=false,overBudget=false,visible=0,selectedTriangles=0,submittedTriangles=0,frustumRejected=0,lodLevel=0,hizRejected=0,frame=0;
 let diagnostic:DiagnosticMode='beauty';
 const motion:{last?:THREE.Vector3;lastMs?:number}={};
 let pending:Promise<unknown>=Promise.resolve(),shown:PageRec[]=[],desired:PageRec[]=[],drawn:PageRec[]=[],targetSize:[number,number]=[viewport?.[0]??1,viewport?.[1]??1];
 let gpuSelection:GpuSelection|undefined;
 const packedPages:PageRec[]=roots.flatMap(root=>root.pages);
 const worldUpdates=new Float32Array(roots.length*16);
 const selectionUniforms:SelectionUniforms={planes:new Float32Array(24),view:new Float32Array(16),pixelScale:[1,1],pixelError:0,near:0.1,cameraWorld:[0,0,0]};
 const untexturedMaterials='Untextured source color; double-sided when the material is';
 const visFeatures=['visibility buffer','textured PBR maps','occlusion culling','temporal occlusion culling'];
 const capabilities:BackendCapabilities={renderer:'WebGPU page raster',materials:untexturedMaterials,hierarchy:true,gpuDriven:false,simplification:false,eviction:true,unsupported:['material extensions, skinning and morph targets in WebGPU','per-texture transforms, UV channels and sampler modes','environment maps, light shadows, area lights and light probes','indirect draw','occlusion culling','temporal occlusion culling','physical VRAM instrumentation','global illumination, surface cache and motion vectors','textured PBR maps','visibility buffer','direct WebGPU present']};
 const dropGpuSelection=()=>{gpuSelection?.dispose();gpuSelection=undefined;capabilities.gpuDriven=false;};
 let visEnabled=false,visTexture:GPUTexture|undefined,visView:GPUTextureView|undefined;
 let visPipelineBack:GPURenderPipeline|undefined,visPipelineBackCw:GPURenderPipeline|undefined,visPipelineNone:GPURenderPipeline|undefined,visPipelineFront:GPURenderPipeline|undefined,visPipelineFrontCw:GPURenderPipeline|undefined,shadePipeline:GPURenderPipeline|undefined;
 let gpuHiz:GpuHiz|undefined;
 let visHizRestBack:GPURenderPipeline|undefined,visHizRestBackCw:GPURenderPipeline|undefined,visHizRestNone:GPURenderPipeline|undefined,visHizRestFront:GPURenderPipeline|undefined,visHizRestFrontCw:GPURenderPipeline|undefined;
 let visBindGroupLayout:GPUBindGroupLayout|undefined,visBindGroup:GPUBindGroup|undefined,visHizBindGroup:GPUBindGroup|undefined,visUniform:GPUBuffer|undefined,zeroFlags:GPUBuffer|undefined,zeroUv:GPUBuffer|undefined,blendBindGroupLayout:GPUBindGroupLayout|undefined;
 let gpuDraw:GpuDraw|undefined;
 let shadeBindGroupLayout:GPUBindGroupLayout|undefined,shadeBindGroup:GPUBindGroup|undefined;
 const visSlotGroups=new Map<string,GPUBindGroup>();
 let concatPos:GPUBuffer|undefined,concatUv:GPUBuffer|undefined,concatNrm:GPUBuffer|undefined,pageTable:GPUBuffer|undefined,shadeUniform:GPUBuffer|undefined,mapsTexture:GPUTexture|undefined,dataMapsTexture:GPUTexture|undefined,mapsSampler:GPUSampler|undefined,materialScales:GPUBuffer|undefined;
 const shadeUniPacked=new Float32Array(64),visUniPacked=new Float32Array(16),geometryBlocks=new Map<THREE.BufferGeometry['attributes'],{vertexBase:number;count:number;hasUv:boolean;hasNormal:boolean;hasTangent:boolean}>(),mapLayer=new Map<THREE.Texture,number>(),dataLayer=new Map<THREE.Texture,number>();
 const uvScales:Array<[number,number]>=[[1,1]],dataUvScales:Array<[number,number]>=[[1,1]];
 const previouslyDrawnUrls=new Set<string>();
 const temporalHizState:TemporalHizState={};
 let lastSubmitMs:number|null=null;
 let gpuTiming:ReturnType<typeof createGpuTiming>|undefined;
 let cpuSample:Record<string,unknown>|undefined,transparentEncodeMs=0,lastCpuLogFrame=-1;
 let residencyJob=0;
 const cameraPose=(camera:THREE.PerspectiveCamera)=>({position:camera.getWorldPosition(new THREE.Vector3()).toArray(),quaternion:camera.getWorldQuaternion(new THREE.Quaternion()).toArray()});
 const createRenderEncoder=(device:GPUDevice)=>gpuTiming&&!secondaryCamera?gpuTiming.createEncoder(frame):device.createCommandEncoder();
 const dropGpuHiz=()=>{
  gpuHiz?.dispose();gpuHiz=undefined;visHizBindGroup=undefined;
  visHizRestBack=undefined;visHizRestBackCw=undefined;visHizRestNone=undefined;visHizRestFront=undefined;visHizRestFrontCw=undefined;
  previouslyDrawnUrls.clear();
  temporalHizState.pyramid=undefined;temporalHizState.camera=undefined;temporalHizState.viewport=undefined;
 };
 const dropGpuDraw=()=>{
  gpuDraw?.dispose();gpuDraw=undefined;
  if(!capabilities.unsupported.includes('indirect draw'))capabilities.unsupported.push('indirect draw');
 };
 const dropVis=()=>{
  visEnabled=false;visPipelineBack=undefined;visPipelineBackCw=undefined;visPipelineNone=undefined;visPipelineFront=undefined;visPipelineFrontCw=undefined;shadePipeline=undefined;shadeBindGroup=undefined;shadeBindGroupLayout=undefined;visBindGroupLayout=undefined;visBindGroup=undefined;visHizBindGroup=undefined;mapsSampler=undefined;blendBindGroupLayout=undefined;pipelineBlendTextured=undefined;
  for(const item of blendGpu)item.group=undefined;
  visSlotGroups.clear();
  dropGpuDraw();dropGpuHiz();
  concatPos?.destroy();concatUv?.destroy();concatNrm?.destroy();pageTable?.destroy();shadeUniform?.destroy();visUniform?.destroy();zeroFlags?.destroy();mapsTexture?.destroy();dataMapsTexture?.destroy();materialScales?.destroy();materialScales=undefined;
  concatPos=concatUv=concatNrm=pageTable=shadeUniform=visUniform=zeroFlags=mapsTexture=dataMapsTexture=undefined;
  capabilities.materials=untexturedMaterials;
  for(const item of visFeatures)if(!capabilities.unsupported.includes(item))capabilities.unsupported.push(item);
 };
 const pageSource={read:async(key:string)=>{const bytes=sourceBytes.get(key);if(!bytes)throw new Error('Missing page');return bytes;}};
 let lastCamera:THREE.PerspectiveCamera|undefined;
 const pageRgb=(rec:PageRec):[number,number,number]=>{
  if(diagnostic==='beauty')return linearColor(rec.material);
  if(diagnostic==='pages')return PAGES_GREEN;
  let rgb=clusterRgbCache.get(rec.clusterId);if(!rgb){rgb=clusterRgb(rec.clusterId);clusterRgbCache.set(rec.clusterId,rgb);}return rgb;
 };
 const ensureTargets=(device:GPUDevice,width:number,height:number)=>{
  if(colorTexture&&targetSize[0]===width&&targetSize[1]===height&&surfaces&&(!visEnabled||visTexture)&&(!gpuHiz||gpuHiz.width===width&&gpuHiz.height===height))return;
  traceDiagnostic('targets-request','Demande de cibles GPU pour la frame',()=>({frame,width,height,previousSize:targetSize.slice(),additionalBytes:captureAllocationBytes,budgetBytes:frameBudget,hiZReserved:reserveHiz}));
  const allocationBytes=checkFrameBudget(width,height,captureAllocationBytes);
  colorTexture?.destroy();depthTexture?.destroy();visTexture?.destroy();hdrTexture?.destroy();surfaces?.dispose();
  visTexture=undefined;visView=undefined;shadeBindGroup=undefined;visBindGroup=undefined;visHizBindGroup=undefined;
  capturedPixels=undefined;capturedRevision=-1;
  const usage=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC;
  colorTexture=device.createTexture({label:'WG display color',size:{width,height},format:'rgba8unorm',usage});
  depthTexture=device.createTexture({label:'WG opaque depth',size:{width,height},format:'depth32float',usage:usage|GPUTextureUsage.COPY_DST});
  hdrTexture=device.createTexture({label:'WG HDR lighting',size:{width,height},format:'rgba16float',usage});
  surfaces=createSurfaceBuffer(device,width,height,frameBudget-captureAllocationBytes);
  colorView=colorTexture.createView();depthView=depthTexture.createView();hdrView=hdrTexture.createView();targetSize=[width,height];
  try{visTexture=device.createTexture({label:'WG visibility',size:{width,height},format:'r32uint',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});visView=visTexture.createView();}
  catch(error){diagnosticFailure('visibility-target-failed',error);}
  if(gpuHiz&&!gpuHiz.resize(device,width,height))dropGpuHiz();
  const allocation={frame,width,height,allocationBytes,captureAllocationBytes,budgetBytes:frameBudget,physicalVramBytes:null,surfaceVersion:1};
  traceDiagnostic('targets-transition','Cibles GPU allouées après transition',()=>allocation);
  engineDiagnostic('frame-allocation','Cibles GPU allouées',allocation);
 };
 const windingCw=(rec:PageRec)=>{
  const e=rec.matrix.elements;
  return e[0]*(e[5]*e[10]-e[6]*e[9])-e[1]*(e[4]*e[10]-e[6]*e[8])+e[2]*(e[4]*e[9]-e[5]*e[8])<0;
 };
 const pipelineFor=(rec:PageRec)=>{
  const side=materialSide(rec.material);
  if(side===THREE.DoubleSide)return pipelineNone;
  return windingCw(rec)?pipelineBackCw:pipelineBack;
 };
 const visPipelineFor=(rec:PageRec,rest:boolean)=>{
  const side=materialSide(rec.material),cw=windingCw(rec);
  if(side===THREE.DoubleSide)return rest?visHizRestNone:visPipelineNone;
  if(side===THREE.BackSide)return rest?(cw?visHizRestFrontCw:visHizRestFront):(cw?visPipelineFrontCw:visPipelineFront);
  return rest?(cw?visHizRestBackCw:visHizRestBack):(cw?visPipelineBackCw:visPipelineBack);
 };
 const bindGroupFor=(device:GPUDevice,position:GPUBuffer)=>{
  let id=positionIds.get(position);if(!id){id=nextPositionId++;positionIds.set(position,id);}
  let group=bindGroups.get(id);
  if(!group&&bindGroupLayout&&cache&&uniformBuffer){
   group=device.createBindGroup({layout:bindGroupLayout,entries:[{binding:0,resource:{buffer:cache.buffer}},{binding:1,resource:{buffer:position}},{binding:2,resource:{buffer:uniformBuffer,size:UNIFORM_STRIDE}}]});
   bindGroups.set(id,group);
  }
  return group;
 };
 const ensureUniform=(device:GPUDevice,draws:number)=>{
  const bytes=Math.max(1,draws,cap)*UNIFORM_STRIDE;
  if(!uniformBuffer||uniformBuffer.size<bytes){
   uniformBuffer?.destroy();bindGroups.clear();
   for(const item of blendGpu)item.group=undefined;
   uniformBuffer=device.createBuffer({size:bytes,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  }
  if(uniformPacked.byteLength<bytes)uniformPacked=new Float32Array(bytes/4);
 };
 let outputDiagnosticLogged=false,renderPathLogged=false;
 const blendGpu:Array<{position:GPUBuffer;index:GPUBuffer;uv?:GPUBuffer;normal?:GPUBuffer;material:THREE.Material|THREE.Material[];count:number;matrix:THREE.Matrix4;sourceMesh?:THREE.Mesh;sourceGeometry:THREE.BufferGeometry;bounds?:THREE.Box3;rgba:[number,number,number,number];map?:THREE.Texture;flags:number;group?:GPUBindGroup;paged?:boolean;cut?:PageRec[];packed?:Uint32Array<ArrayBuffer>}>=[];
 const pagedBlendGpu=new Map<THREE.Mesh,(typeof blendGpu)[number]>();
 const blendCuts=new Map<(typeof blendGpu)[number],PageRec[]>(),blendDrawnPages:PageRec[]=[];
 const visibleBlend:typeof blendGpu=[],blendFrustum=new THREE.Frustum();
 const selectBlend=(device:GPUDevice)=>{
  if(pagedBlendGpu.size){
   const previousLength=blendDrawnPages.length;let count=0,changed=false;
   for(const rec of drawn){
    if(!rec.transparent)continue;
    if(blendDrawnPages[count]!==rec)changed=true;
    blendDrawnPages[count++]=rec;
   }
   blendDrawnPages.length=count;
   if(changed||count!==previousLength){
    blendCuts.clear();
    for(const rec of blendDrawnPages){
     const item=rec.sourceMesh&&pagedBlendGpu.get(rec.sourceMesh);if(!item)continue;
     let cut=blendCuts.get(item);if(!cut)blendCuts.set(item,cut=[]);cut.push(rec);
    }
   }
  }
  for(const item of blendGpu){
   if(!item.paged){if(item.bounds&&!blendFrustum.intersectsBox(item.bounds))blendFrustumRejected++;else visibleBlend.push(item);continue;}
   const cut=blendCuts.get(item);
   if(!cut?.length){blendFrustumRejected++;continue;}
   if(cut!==item.cut){
    cut.sort((a,b)=>(a.sourceOrder??a.id)-(b.sourceOrder??b.id));
    if(item.cut&&cut.length===item.cut.length&&cut.every((rec,i)=>rec===item.cut![i]))blendCuts.set(item,item.cut);
    else{
     let count=0;for(const rec of cut){if(!rec.array||!cache?.get(rec.url))throw new Error('GPU_TRANSPARENT_COVERAGE_INCOMPLETE');count+=rec.array.length;}
     const bytes=count*4;
     if(bytes>Math.min(device.limits.maxBufferSize,device.limits.maxStorageBufferBindingSize))throw new Error('GPU_TRANSPARENT_INDEX_BUDGET');
     if(!item.packed||item.packed.length<count)item.packed=new Uint32Array(count);
     let offset=0;for(const rec of cut){item.packed.set(rec.array!,offset);offset+=rec.array!.length;}
     if(item.index.size<bytes){item.index.destroy();item.index=device.createBuffer({label:'WG transparent selected indices',size:Math.max(4,bytes),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});item.group=undefined;}
     device.queue.writeBuffer(item.index,0,item.packed.subarray(0,count));item.count=count;item.cut=cut;
    }
   }
   visibleBlend.push(item);
  }
 };
 const encodeBlend=(device:GPUDevice,encoder:GPUCommandEncoder,uniformBase:number)=>{
  if(!pipelineBlend||!visibleBlend.length||!colorView||!depthView||!uniformBuffer)return;
  const textured=!!(blendBindGroupLayout&&pipelineBlendTextured&&mapsTexture&&mapsSampler&&dataMapsTexture&&materialScales&&zeroUv);
  if(!textured&&!bindGroupLayout)return;
  const cpuStart=performance.now();
  ensureUniform(device,uniformBase+visibleBlend.length);
  const packedInts=new Uint32Array(uniformPacked.buffer,uniformPacked.byteOffset,uniformPacked.length);
  const cam=lastCamera?.position;
  const lLen=Math.hypot(1,3,2);
  for(let i=0;i<visibleBlend.length;i++){
   const item=visibleBlend[i],base=(uniformBase+i)*(UNIFORM_STRIDE/4),mat=visMaterial(item.material);
   const layer=item.map&&mapLayer.has(item.map)?mapLayer.get(item.map)!:0,scale=uvScales[layer]??[1,1];
   uniformPacked.set(viewProj.elements,base);uniformPacked.set(item.matrix.elements,base+16);
   uniformPacked[base+32]=item.rgba[0];uniformPacked[base+33]=item.rgba[1];uniformPacked[base+34]=item.rgba[2];uniformPacked[base+35]=item.rgba[3];
   packedInts[base+36]=0;packedInts[base+37]=item.count;packedInts[base+38]=layer;packedInts[base+39]=item.flags;
   uniformPacked[base+40]=scale[0];uniformPacked[base+41]=scale[1];
   packedInts[base+42]=mat.emissiveMap?mapLayer.get(mat.emissiveMap)??0:0;uniformPacked[base+43]=mat.alphaTest;
   uniformPacked[base+52]=mat.roughness;uniformPacked[base+53]=mat.metalness;uniformPacked[base+54]=mat.normalScale;uniformPacked[base+55]=mat.normalScaleY;
   packedInts[base+56]=mat.roughnessMap?dataLayer.get(mat.roughnessMap)??0:0;packedInts[base+57]=mat.metalnessMap?dataLayer.get(mat.metalnessMap)??0:0;
   packedInts[base+58]=mat.normalMap?dataLayer.get(mat.normalMap)??0:0;packedInts[base+59]=mat.aoMap?dataLayer.get(mat.aoMap)??0:0;
   uniformPacked[base+60]=mat.aoIntensity;uniformPacked.set(mat.emissive,base+61);
   uniformPacked[base+44]=cam?.x??0;uniformPacked[base+45]=cam?.y??0;uniformPacked[base+46]=cam?.z??0;uniformPacked[base+47]=1;
   uniformPacked[base+48]=1/lLen;uniformPacked[base+49]=3/lLen;uniformPacked[base+50]=2/lLen;uniformPacked[base+51]=2.5;
  }
  device.queue.writeBuffer(uniformBuffer,(uniformBase*UNIFORM_STRIDE),uniformPacked.subarray(uniformBase*(UNIFORM_STRIDE/4),(uniformBase+visibleBlend.length)*(UNIFORM_STRIDE/4)));
  const pass=encoder.beginRenderPass({
   label:'WG transparents',
   colorAttachments:[{view:visEnabled&&hdrView?hdrView:colorView,loadOp:'load',storeOp:'store'}],
   depthStencilAttachment:{view:depthView,depthLoadOp:'load',depthStoreOp:'store'},
  });
  pass.setViewport(0,0,targetSize[0],targetSize[1],0,1);
  for(let i=0;i<visibleBlend.length;i++){
   const item=visibleBlend[i];
   if(!item.group){
    if(textured)item.group=device.createBindGroup({layout:blendBindGroupLayout!,entries:[{binding:0,resource:{buffer:item.index}},{binding:1,resource:{buffer:item.position}},{binding:2,resource:{buffer:item.uv??zeroUv!}},{binding:3,resource:{buffer:uniformBuffer,size:UNIFORM_STRIDE}},{binding:4,resource:mapsTexture!.createView({dimension:'2d-array'})},{binding:5,resource:mapsSampler!},{binding:6,resource:dataMapsTexture!.createView({dimension:'2d-array'})},{binding:7,resource:{buffer:item.normal??zeroUv!}},{binding:8,resource:{buffer:materialScales!}},{binding:9,resource:{buffer:lights!.buffer}}]});
    else item.group=device.createBindGroup({layout:bindGroupLayout!,entries:[{binding:0,resource:{buffer:item.index}},{binding:1,resource:{buffer:item.position}},{binding:2,resource:{buffer:uniformBuffer,size:UNIFORM_STRIDE}}]});
   }
   pass.setBindGroup(0,item.group,[(uniformBase+i)*UNIFORM_STRIDE]);
   const material=Array.isArray(item.material)?item.material[0]:item.material;
   const front=item.matrix.determinant()<0?pipelineBlendFront:pipelineBlendBack,back=item.matrix.determinant()<0?pipelineBlendBack:pipelineBlendFront;
   if(textured&&material.side===THREE.DoubleSide&&!material.forceSinglePass&&front&&back){pass.setPipeline(back);pass.draw(item.count);pass.setPipeline(front);pass.draw(item.count);gpuDrawCalls+=2;blendDrawCalls+=2;blendSubmittedTriangles+=2*item.count/3;}
   else{pass.setPipeline(textured?(material.side===THREE.FrontSide?front!:material.side===THREE.BackSide?back!:pipelineBlendTextured!):pipelineBlend);pass.draw(item.count);gpuDrawCalls++;blendDrawCalls++;blendSubmittedTriangles+=item.count/3;}
  }
  pass.end();
  transparentEncodeMs+=performance.now()-cpuStart;
  traceDiagnostic('transparent-encoding','Transparents sélectionnés et encodés',()=>({frame,submission:imageRevision,candidates:blendGpu.length,visibleMeshes:visibleBlend.length,frustumRejected:blendFrustumRejected,drawCalls:blendDrawCalls,submittedTriangles:blendSubmittedTriangles,encodeMs:transparentEncodeMs,passes:visibleBlend.length?2:0}));
 };
 const packedDraws=()=>{
   const packed:Array<{rec:PageRec;resident:ResidentPage;index:Uint32Array;position:GPUBuffer}>=[];
   if(!cache)return packed;
   for(let i=0;i<drawn.length;i++){
    const rec=drawn[i];if(rec.transparent)continue;
    const resident=cache.get(rec.url),index=rec.array;if(!resident||!index)continue;
    const position=positionBuffers.get(rec.attributes);if(!position)continue;
    packed.push({rec,resident,index,position});
   }
   return packed;
  };
 const submitColorCopy=(device:GPUDevice,encoder:GPUCommandEncoder,height:number,width:number)=>{
   if(presenter&&colorTexture&&!secondaryCamera){presenter.present(encoder,colorTexture,width,height);gpuDrawCalls++;}
   const command=encoder.finish();device.queue.submit([command]);imageRevision++;
   traceDiagnostic('encoding-submit','Commandes WebGPU soumises',()=>({frame,submission:imageRevision,pose:lastCamera?cameraPose(lastCamera):null,width,height,drawCalls:gpuDrawCalls,drawnTriangles:drawn.reduce((sum,page)=>sum+page.triangles,0),transparent:{drawCalls:blendDrawCalls,submittedTriangles:blendSubmittedTriangles},presentation:secondaryCamera?'surface-capture':context.gpuCanvas?'direct':'composed'}));
   if(gpuTiming?.isSampled(encoder))gpuTiming.submitted(encoder,{submission:imageRevision,viewport:[width,height],cameraWorld:lastCamera?.getWorldPosition(new THREE.Vector3()).toArray(),viewProjection:[...viewProj.elements],scope:'render-passes-only',excludes:['GPU selection dispatch','uploads and copies','CPU work','presentation latency'],drawCalls:gpuDrawCalls,transparentDrawCalls:blendDrawCalls,transparentSubmittedTriangles:blendSubmittedTriangles});
   if(canvasTexture&&!secondaryCamera)canvasTexture.needsUpdate=true;
  };
 const encodeClear=(device:GPUDevice,encoder:GPUCommandEncoder)=>{
  const pass=encoder.beginRenderPass({
   label:'WG clear',
   colorAttachments:[{view:colorView!,loadOp:'clear',storeOp:'store',clearValue:{r:(clearColor>>16)/255,g:((clearColor>>8)&255)/255,b:(clearColor&255)/255,a:1}}],
   depthStencilAttachment:{view:depthView!,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'},
  });
  pass.end();
 };
 const encodeSurfaceLighting=(device:GPUDevice,encoder:GPUCommandEncoder,camera:THREE.PerspectiveCamera,uniformBase:number)=>{
  if(!surfaces||!deferred||!hdrView||!depthView||!colorView)throw new Error('DEFERRED_UNAVAILABLE');
  const [width,height]=targetSize;
  deferred.bind(surfaces,depthView,hdrView);
  deferred.update(viewProj.clone().invert().elements,camera.getWorldPosition(new THREE.Vector3()).toArray(),width,height,clearColor,diagnostic!=='beauty');
  deferred.light(encoder,hdrView);gpuDrawCalls++;
  encodeBlend(device,encoder,uniformBase);
  gpuDrawCalls++;deferred.compose(encoder,colorView,{r:(clearColor>>16)/255,g:((clearColor>>8)&255)/255,b:(clearColor&255)/255,a:1});
 };
 const encodeVis=(device:GPUDevice,camera:THREE.PerspectiveCamera,packed:Array<{rec:PageRec;resident:ResidentPage;index:Uint32Array;position:GPUBuffer}>)=>{
  if(!visBindGroupLayout||!cache||!concatPos||!colorView||!depthView||!visView||!visPipelineBack||!shadePipeline)return 0;
  const idsView=visView,depthTarget=depthView;
  const [width,height]=targetSize;
  if(!packed.length){
   if(!surfaces)throw new Error('SURFACE_UNAVAILABLE');
   const encoder=createRenderEncoder(device);
   const pass=encoder.beginRenderPass({label:'WG empty surfaces',colorAttachments:surfaces.views().map(view=>({view,loadOp:'clear' as const,storeOp:'store' as const,clearValue:[0,0,0,0]})),depthStencilAttachment:{view:depthTarget,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});pass.end();
   encodeSurfaceLighting(device,encoder,camera,0);
   submitColorCopy(device,encoder,height,width);
   return blendSubmittedTriangles;
  }
  ensureUniform(device,Math.max(1,packed.length+blendGpu.length));
  let occluderPacked=packed,restPacked=packed.slice(0,0),twoPass=false;
  const boundsCache=new Map<PageRec,HizBounds>();
  if(gpuHiz&&packed.length>=2){
   if(previouslyDrawnUrls.size>0){
    occluderPacked=packed.filter(item=>previouslyDrawnUrls.has(item.rec.url));
    restPacked=packed.filter(item=>!previouslyDrawnUrls.has(item.rec.url));
    if(!occluderPacked.length||!restPacked.length){
     const split=splitOccluders(packed.map(item=>item.rec),camera,[width,height],boundsCache);
     const occluderSet=new Set(split.occluders),restSet=new Set(split.rest);
     occluderPacked=packed.filter(item=>occluderSet.has(item.rec));
     restPacked=packed.filter(item=>restSet.has(item.rec));
    }
    twoPass=!!(occluderPacked.length&&restPacked.length&&visHizRestBack);
   }else{
    const split=splitOccluders(packed.map(item=>item.rec),camera,[width,height],boundsCache);
    if(split.occluders.length&&split.rest.length){
     const occluderSet=new Set(split.occluders),restSet=new Set(split.rest);
     occluderPacked=packed.filter(item=>occluderSet.has(item.rec));
     restPacked=packed.filter(item=>restSet.has(item.rec));
     twoPass=!!(occluderPacked.length&&restPacked.length&&visHizRestBack);
    }
   }
  }
  const restSlot=new Map<PageRec,number>();
  for(let i=0;i<restPacked.length;i++)restSlot.set(restPacked[i].rec,i);
  const visBin=(rec:PageRec):0|1|2=>{
   const side=materialSide(rec.material);
   if(side===THREE.DoubleSide)return BIN_NONE;
   if(side===THREE.BackSide)return BIN_FRONT;
   return BIN_BACK;
  };
  const items:DrawItem[]=[];
  const addItems=(list:typeof packed,rest:0|1)=>{
   const members=list===packed?undefined:new Set(list);
   for(let i=0;i<packed.length;i++){if(members&&!members.has(packed[i]))continue;items.push({pageIndex:i,bin:visBin(packed[i].rec),rest});}
  };
  if(twoPass){addItems(occluderPacked,0);addItems(restPacked,1);}else addItems(packed,0);
  const maxVertexCount=Math.max(1,...allPages.map(page=>page.array?.length??page.triangles*3),...packed.map(item=>item.index.length));
  const compact=evaluateDrawCompact(items,maxVertexCount,slots);
  const useIndirect=!!gpuDraw&&!compact.overflow;
  if(compact.overflow)dropGpuDraw();
  const layout:SlotLayout|undefined=useIndirect?compactSlotLayout(compact.counts,PAGE_INFO_STRIDE):undefined;
  const tableRows=layout?.tableRows??packed.length;
  const tableBytes=Math.max(PAGE_INFO_STRIDE,tableRows*PAGE_INFO_STRIDE);
  if(!pageTable||pageTable.size<tableBytes){pageTable?.destroy();shadeBindGroup=undefined;visBindGroup=undefined;visHizBindGroup=undefined;visSlotGroups.clear();pageTable=device.createBuffer({size:tableBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});}
  const pageFloats=new Float32Array(tableBytes/4),pageInts=new Uint32Array(pageFloats.buffer);
  const writePage=(item:(typeof packed)[number],row:number)=>{
   const base=row*(PAGE_INFO_STRIDE/4),mat=visMaterial(item.rec.material),geo=geometryBlocks.get(item.rec.attributes);
   const layer=mat.map&&mapLayer.has(mat.map)?mapLayer.get(mat.map)!:0,scale=uvScales[layer]??[1,1];
   const roughLayer=mat.roughnessMap&&dataLayer.has(mat.roughnessMap)?dataLayer.get(mat.roughnessMap)!:0;
   const metalLayer=mat.metalnessMap&&dataLayer.has(mat.metalnessMap)?dataLayer.get(mat.metalnessMap)!:0;
   const nrmLayer=mat.normalMap&&dataLayer.has(mat.normalMap)?dataLayer.get(mat.normalMap)!:0;
   pageFloats.set(item.rec.matrix.elements,base);
   pageFloats[base+16]=mat.baseColor[0];pageFloats[base+17]=mat.baseColor[1];pageFloats[base+18]=mat.baseColor[2];pageFloats[base+19]=mat.alphaTest>0?mat.alphaTest:1;
   pageFloats[base+20]=mat.metalness;pageFloats[base+21]=mat.roughness;
   let flags=0;if(mat.lit)flags|=FLAG_LIT;if(mat.doubleSided)flags|=FLAG_DOUBLE;if(geo?.hasUv)flags|=FLAG_HAS_UV;if(layer)flags|=FLAG_HAS_MAP;if(geo?.hasNormal)flags|=FLAG_HAS_NORMAL;if(geo?.hasTangent)flags|=FLAG_HAS_TANGENT;if(mat.alphaTest>0)flags|=FLAG_MASK;if(mat.backSide)flags|=FLAG_BACK;
   if(roughLayer||metalLayer)flags|=FLAG_HAS_ORM;if(nrmLayer)flags|=FLAG_HAS_NORMAL_MAP;
   if(mat.map&&mat.map.wrapS!==THREE.ClampToEdgeWrapping)flags|=FLAG_WRAP_S_REPEAT;
   if(mat.map&&mat.map.wrapT!==THREE.ClampToEdgeWrapping)flags|=FLAG_WRAP_T_REPEAT;
   pageInts[base+22]=layer;pageInts[base+23]=flags;pageInts[base+24]=item.resident.offset/4;pageInts[base+25]=item.index.length;pageInts[base+26]=geo?.vertexBase??0;pageInts[base+27]=((row+1)<<16)>>>0;
   pageFloats[base+28]=scale[0];pageFloats[base+29]=scale[1];pageInts[base+30]=clusterHash(item.rec.clusterId);
   pageInts[base+31]=restSlot.has(item.rec)?restSlot.get(item.rec)!:0xffffffff;
   pageInts[base+32]=roughLayer;pageInts[base+33]=metalLayer;pageInts[base+34]=nrmLayer;pageFloats[base+35]=mat.normalScale;
   const roughScale=dataUvScales[roughLayer]??[1,1],metalScale=dataUvScales[metalLayer]??[1,1],nrmScale=dataUvScales[nrmLayer]??[1,1];
   pageFloats[base+36]=roughScale[0];pageFloats[base+37]=roughScale[1];pageFloats[base+38]=metalScale[0];pageFloats[base+39]=metalScale[1];
   pageFloats[base+40]=nrmScale[0];pageFloats[base+41]=nrmScale[1];
   const aoLayer=mat.aoMap?dataLayer.get(mat.aoMap)??0:0,emissiveLayer=mat.emissiveMap?mapLayer.get(mat.emissiveMap)??0:0;
   const aoScale=dataUvScales[aoLayer]??[1,1],emissiveScale=uvScales[emissiveLayer]??[1,1];
   pageInts[base+42]=aoLayer;pageFloats[base+43]=mat.aoIntensity;
   pageFloats[base+44]=aoScale[0];pageFloats[base+45]=aoScale[1];pageInts[base+46]=emissiveLayer;
   pageFloats.set(mat.emissive,base+48);pageFloats[base+52]=emissiveScale[0];pageFloats[base+53]=emissiveScale[1];pageFloats[base+54]=mat.normalScaleY;
  };
  if(useIndirect&&layout){
   let inst=0;
   for(let slot=0;slot<6;slot++){
    for(let i=0;i<compact.counts[slot];i++){
     const item=packed[compact.instances[inst++]];if(item)writePage(item,layout.rows[slot]+i);
    }
   }
  }else{
   for(let s=0;s<packed.length;s++)writePage(packed[s],s);
  }
  device.queue.writeBuffer(pageTable,0,pageFloats);
  if(!visUniform)visUniform=device.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  visUniPacked.set(viewProj.elements);
  device.queue.writeBuffer(visUniform,0,visUniPacked);
  if(!shadeUniform)shadeUniform=device.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  shadeUniPacked.set(viewProj.elements,0);shadeUniPacked[16]=width;shadeUniPacked[17]=height;
  const shadeInts=new Uint32Array(shadeUniPacked.buffer);shadeInts[20]=tableRows;shadeInts[21]=diagnostic==='wireframe'?1:diagnostic==='pages'?3:diagnostic==='beauty'?0:2;
  device.queue.writeBuffer(shadeUniform,0,shadeUniPacked);
  if(!shadeBindGroup&&shadeBindGroupLayout&&visView&&pageTable&&concatPos&&concatUv&&concatNrm&&mapsTexture&&dataMapsTexture&&mapsSampler&&shadeUniform&&cache){
   shadeBindGroup=device.createBindGroup({layout:shadeBindGroupLayout,entries:[
    {binding:0,resource:visView},{binding:1,resource:{buffer:cache.buffer}},{binding:2,resource:{buffer:concatPos}},
    {binding:3,resource:{buffer:concatUv}},{binding:4,resource:{buffer:concatNrm}},{binding:5,resource:{buffer:pageTable}},
    {binding:6,resource:mapsTexture.createView({dimension:'2d-array'})},{binding:7,resource:mapsSampler},{binding:8,resource:{buffer:shadeUniform}},
    {binding:9,resource:dataMapsTexture.createView({dimension:'2d-array'})},
   ]});
  }
  if(visBindGroupLayout&&cache&&concatPos&&concatUv&&pageTable&&visUniform&&zeroFlags&&mapsTexture&&mapsSampler){
   const visMaps=mapsTexture.createView({dimension:'2d-array'});
   if(!visBindGroup)visBindGroup=device.createBindGroup({layout:visBindGroupLayout,entries:[
    {binding:0,resource:{buffer:cache.buffer}},{binding:1,resource:{buffer:concatPos}},
    {binding:2,resource:{buffer:pageTable}},{binding:3,resource:{buffer:zeroFlags}},
    {binding:4,resource:{buffer:visUniform}},{binding:5,resource:{buffer:concatUv}},
    {binding:6,resource:visMaps},{binding:7,resource:mapsSampler},
   ]});
   if(!visHizBindGroup&&gpuHiz)visHizBindGroup=device.createBindGroup({layout:visBindGroupLayout,entries:[
    {binding:0,resource:{buffer:cache.buffer}},{binding:1,resource:{buffer:concatPos}},
    {binding:2,resource:{buffer:pageTable}},{binding:3,resource:{buffer:gpuHiz.flags}},
    {binding:4,resource:{buffer:visUniform}},{binding:5,resource:{buffer:concatUv}},
    {binding:6,resource:visMaps},{binding:7,resource:mapsSampler},
   ]});
  }
  const encoder=createRenderEncoder(device);
  if(useIndirect)gpuDraw!.encode(encoder,items,maxVertexCount);
  const visColors=(loadOp:'clear'|'load')=>{
   const ids:{view:GPUTextureView;loadOp:'clear'|'load';storeOp:'store';clearValue?:GPUColor}={view:idsView,loadOp,storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}};
   if(!gpuHiz)return [ids];
   return [ids,{view:gpuHiz.level0View,loadOp,storeOp:'store' as const,clearValue:{r:1,g:0,b:0,a:1}}];
  };
  let visMaps:GPUTextureView|undefined;
  const visSlots=[visPipelineBack,visPipelineNone,visPipelineFront,visHizRestBack,visHizRestNone,visHizRestFront];
  const visGroupFor=(slot:number,rest:boolean)=>{
   if(!visBindGroupLayout||!cache||!concatPos||!concatUv||!pageTable||!visUniform||!mapsTexture||!mapsSampler||!layout)return;
   const flags=rest?gpuHiz?.flags:zeroFlags;if(!flags)return;
   const offset=layout.offsets[slot],size=Math.max(PAGE_INFO_STRIDE,compact.counts[slot]*PAGE_INFO_STRIDE);
   if(offset+size>pageTable.size)return;
   const key=`${slot}:${offset}:${size}:${rest}`;
   let group=visSlotGroups.get(key);
   if(!group){
    if(!visMaps)visMaps=mapsTexture.createView({dimension:'2d-array'});
    group=device.createBindGroup({layout:visBindGroupLayout,entries:[
     {binding:0,resource:{buffer:cache.buffer}},{binding:1,resource:{buffer:concatPos}},
     {binding:2,resource:{buffer:pageTable,offset,size}},{binding:3,resource:{buffer:flags}},
     {binding:4,resource:{buffer:visUniform}},{binding:5,resource:{buffer:concatUv}},
     {binding:6,resource:visMaps},{binding:7,resource:mapsSampler},
    ]});
    visSlotGroups.set(key,group);
   }
   return group;
  };
  const drawVis=(pass:GPURenderPassEncoder,list:typeof packed,rest:boolean)=>{
   if(useIndirect){
    if(!gpuDraw||!layout)return 0;
    const start=rest?3:0;
    for(let s=start;s<start+3;s++){
     if(compact.counts[s]<=0)continue;
     const pipeline=visSlots[s],group=visGroupFor(s,rest);if(!pipeline||!group)continue;
     pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.drawIndirect(gpuDraw.indirectBuffer,s*16);gpuDrawCalls++;
    }
    return list.reduce((n,item)=>n+item.index.length,0);
   }
   const group=rest?(visHizBindGroup??visBindGroup):visBindGroup;
   if(!group)return 0;
   let vertices=0;
   for(let i=0;i<packed.length;i++){
    const item=packed[i];if(!list.includes(item))continue;
    const pipeline=visPipelineFor(item.rec,rest);
    if(!pipeline)continue;
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(item.index.length,1,0,i);gpuDrawCalls++;vertices+=item.index.length;
   }
   return vertices;
  };
  const visPass=encoder.beginRenderPass({
   label:'WG visibility primary',
   colorAttachments:visColors('clear'),
   depthStencilAttachment:{view:depthTarget,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'},
  });
  visPass.setViewport(0,0,width,height,0,1);
  let vertices=drawVis(visPass,twoPass?occluderPacked:packed,false);
  visPass.end();
  if(twoPass&&gpuHiz){
   gpuHiz.encodePyramid(encoder);
   gpuHiz.encodeTest(device,encoder,restPacked.map(item=>boundsCache.get(item.rec)??projectBoxToScreen(item.rec.min,item.rec.max,item.rec.matrix,camera,[width,height])));
   const restPass=encoder.beginRenderPass({
    label:'WG visibility secondary',
    colorAttachments:visColors('load'),
    depthStencilAttachment:{view:depthTarget,depthLoadOp:'load',depthStoreOp:'store'},
   });
   restPass.setViewport(0,0,width,height,0,1);
   vertices+=drawVis(restPass,restPacked,true);
   restPass.end();
  }
  if(gpuHiz){
   previouslyDrawnUrls.clear();
   for(let i=0;i<occluderPacked.length;i++)previouslyDrawnUrls.add(occluderPacked[i].rec.url);
  }
  if(!surfaces||!deferred||!hdrView)throw new Error('DEFERRED_UNAVAILABLE');
  const shadePass=encoder.beginRenderPass({label:'WG material surfaces v1',colorAttachments:surfaces.views().map(view=>({view,loadOp:'clear' as const,storeOp:'store' as const,clearValue:[0,0,0,0]}))});
  shadePass.setViewport(0,0,width,height,0,1);
  if(shadeBindGroup){shadePass.setPipeline(shadePipeline);shadePass.setBindGroup(0,shadeBindGroup);shadePass.draw(3);gpuDrawCalls++;}
  shadePass.end();
  encodeSurfaceLighting(device,encoder,camera,packed.length);
  submitColorCopy(device,encoder,height,width);
  return vertices/3+blendSubmittedTriangles;
 };
 const encodeDraws=(device:GPUDevice,camera:THREE.PerspectiveCamera)=>{
  gpuDrawCalls=0;blendSubmittedTriangles=0;blendDrawCalls=0;blendFrustumRejected=0;visibleBlend.length=0;transparentEncodeMs=0;
  if(!bindGroupLayout||!cache||!colorView||!depthView)return 0;
  const [width,height]=targetSize;
  viewProj.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  blendFrustum.setFromProjectionMatrix(viewProj,camera.coordinateSystem);
  selectBlend(device);
  viewProj.premultiply(remap);
  const packed=packedDraws();
  if(visEnabled&&visPipelineBack&&shadePipeline&&visView){
   try{return encodeVis(device,camera,packed);}catch(error){gpuTiming?.cancelUnsubmitted();diagnosticFailure('visibility-render-failed',error);dropVis();gpuDrawCalls=0;if(context.gpuCanvas||secondaryCamera)throw error;}
  }
  if(!pipelineBack)return 0;
  if(!packed.length){
   const encoder=createRenderEncoder(device);
   encodeClear(device,encoder);
   encodeBlend(device,encoder,0);
   submitColorCopy(device,encoder,height,width);
   return blendSubmittedTriangles;
  }
  ensureUniform(device,Math.max(1,packed.length+blendGpu.length));
  const packedInts=new Uint32Array(uniformPacked.buffer,uniformPacked.byteOffset,uniformPacked.length);
  for(let i=0;i<packed.length;i++){
   const item=packed[i],base=i*(UNIFORM_STRIDE/4),color=pageRgb(item.rec);
   uniformPacked.set(viewProj.elements,base);uniformPacked.set(item.rec.matrix.elements,base+16);
   uniformPacked[base+32]=color[0];uniformPacked[base+33]=color[1];uniformPacked[base+34]=color[2];uniformPacked[base+35]=1;
   packedInts[base+36]=item.resident.offset/4;packedInts[base+37]=item.index.length;packedInts[base+38]=diagnostic==='wireframe'?1:0;
  }
  if(packed.length&&uniformBuffer)device.queue.writeBuffer(uniformBuffer,0,uniformPacked.subarray(0,packed.length*(UNIFORM_STRIDE/4)));
  const encoder=createRenderEncoder(device);
  const pass=encoder.beginRenderPass({
   label:'WG opaque fallback',
   colorAttachments:[{view:colorView,loadOp:'clear',storeOp:'store',clearValue:{r:(clearColor>>16)/255,g:((clearColor>>8)&255)/255,b:(clearColor&255)/255,a:1}}],
   depthStencilAttachment:{view:depthView,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'},
  });
  pass.setViewport(0,0,width,height,0,1);
  let vertices=0;
  for(let i=0;i<packed.length;i++){
   const item=packed[i],group=bindGroupFor(device,item.position),pipeline=pipelineFor(item.rec);if(!group||!pipeline)continue;
   pass.setPipeline(pipeline);pass.setBindGroup(0,group,[i*UNIFORM_STRIDE]);pass.draw(item.index.length);gpuDrawCalls++;vertices+=item.index.length;
  }
  pass.end();
  encodeBlend(device,encoder,packed.length);
  submitColorCopy(device,encoder,height,width);
  return vertices/3+blendSubmittedTriangles;
 };
 const hasBytes=(rec:PageRec)=>!!(rec.array||sourceBytes.has(rec.url));
 const updatePins=()=>{
  if(!cache)return;
  const before=new Set(pins);
  const keep=new Set([...bootstrapUrls,...shown.map(page=>page.url),...residencyWanted]);
  for(const key of pins)if(!keep.has(key)){cache.unpin(key);pins.delete(key);}
  for(const key of keep)if(cache.get(key)&&!pins.has(key)){cache.pin(key);pins.add(key);}
  for(const key of deferredDrops)if(!keep.has(key))backend.dropPage!(key);
  const added=[...pins].filter(key=>!before.has(key)),removed=[...before].filter(key=>!pins.has(key));
  if(added.length||removed.length)traceDiagnostic('residency-pins','Pins GPU mis à jour',()=>({frame,added:traceSet('pins.added',added),removed:traceSet('pins.removed',removed),pinned:traceSet('pins', [...pins]),bootstrap:traceSet('pins.bootstrap',[...bootstrapUrls]),wanted:traceSet('pins.wanted',[...residencyWanted]),shown:traceSet('pins.shown',shown.map(page=>page.url))}));
 };
 const ensureBootstrap=async()=>{
  if(bootstrapReady)return;
  if(bootstrapLoading)return bootstrapLoading;
  if(bootstrap.some(page=>!hasBytes(page))&&!context.readPage)return;
  bootstrapLoading=(async()=>{
   const started=performance.now();
   engineDiagnostic('coverage-bootstrap-start','Chargement de la couverture complète de secours',{version:1,pages:bootstrap.length,slots});
   traceDiagnostic('coverage-bootstrap-start','Chargement de la couverture complète de secours',()=>({frame,pages:bootstrap.length,pageIds:pageRefs(bootstrap.map(page=>page.url)),slots,queueWaitMs:0}));
   let next=0;
   const workers=Array.from({length:Math.min(8,bootstrap.length)},async()=>{while(next<bootstrap.length){const page=bootstrap[next++];context.signal?.throwIfAborted();if(lost)throw new Error('WEBGPU_LOST');if(!hasBytes(page)){const array=await context.readPage!(page.url);context.signal?.throwIfAborted();if(lost)throw new Error('WEBGPU_LOST');backend.acceptPage!(page.url,array);}}});
   const results=await Promise.allSettled(workers);const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
   for(const page of bootstrap){context.signal?.throwIfAborted();if(lost)throw new Error('WEBGPU_LOST');await cache!.load(page.url,context.signal);cache!.pin(page.url);pins.add(page.url);}
   bootstrapReady=true;
   engineDiagnostic('coverage-bootstrap-ready','Couverture complète disponible sur le GPU',{version:1,pages:bootstrap.length,slots});
   traceDiagnostic('coverage-bootstrap-ready','Couverture complète disponible sur le GPU',()=>({frame,pages:bootstrap.length,bootstrap:traceSet('bootstrap',[...bootstrapUrls]),slots,durationMs:performance.now()-started,loaded:traceSet('bootstrap.loaded',bootstrap.map(page=>page.url)),wanted:traceSet('bootstrap.wanted',bootstrap.map(page=>page.url))}));
  })().catch(error=>{diagnosticFailure('coverage-bootstrap-failed',error);throw error;}).finally(()=>{bootstrapLoading=undefined;});
  return bootstrapLoading;
 };
 const ensureResident=async(wanted:PageRec[],jobFrame:number,jobId:number)=>{
  if(!cache)return;
  const started=performance.now(),urls=wanted.map(page=>page.url);
  traceDiagnostic('residency-ensure-start','Vérification de la résidence GPU demandée',()=>({frame:jobFrame,jobId,scope:'async-residency-ensure',pages:traceSet('ensure',urls),wanted:traceSet('ensure.wanted',urls),loaded:traceSet('ensure.loaded',urls.filter(url=>!!cache!.get(url))),queueWaitMs:null,elapsedMs:null,cpuWorkIncluded:true,gpuQueueWaitIncluded:false}));
  for(const rec of wanted){
   if(!residencyWanted.has(rec.url))continue;
   context.signal?.throwIfAborted();if(lost)throw new Error('WEBGPU_LOST');
   if(!hasBytes(rec)||cache.get(rec.url))continue;
   try{await cache.load(rec.url,context.signal);}catch(error){if(!residencyWanted.has(rec.url)&&String(error).includes('ALL_PAGES_PINNED'))continue;throw error;}
   if(lost||!cache)throw new Error('WEBGPU_LOST');
   if(residencyWanted.has(rec.url)||bootstrapUrls.has(rec.url)){cache.pin(rec.url);pins.add(rec.url);}
  }
  traceDiagnostic('residency-ensure-end','Résidence GPU vérifiée',()=>({frame:jobFrame,jobId,scope:'async-residency-ensure',pages:traceSet('ensure',urls),loaded:traceSet('ensure.loaded',urls.filter(url=>!!cache!.get(url))),durationMs:performance.now()-started,elapsedMs:performance.now()-started,cpuWorkIncluded:true,gpuQueueWaitIncluded:false,pinned:traceSet('pins',[...pins])}));
 };
 const queueResident=(wanted:PageRec[])=>{
  const queuedAt=performance.now(),jobId=++residencyJob;
  const jobFrame=frame;
  residencyWanted=new Set(wanted.map(page=>page.url));updatePins();
  const queued=[...new Map(wanted.filter(hasBytes).map(page=>[page.url,page])).values()];queuedResidency=queued;
  traceDiagnostic('residency-queue','Résidence GPU mise en file',()=>({frame,jobId,pages:traceSet('queue',queued.map(page=>page.url)),wanted:traceSet('wanted',[...residencyWanted]),loaded:traceSet('queue.loaded',queued.filter(page=>!!cache?.get(page.url)).map(page=>page.url)),queueDepth:queued.length,residentPages:cache?.stats().residentPages??null}));
  if(residencyRunning)return;
  residencyRunning=true;
  pending=Promise.resolve().then(async()=>{const started=performance.now();traceDiagnostic('residency-job-start','Job de résidence GPU démarré',()=>({frame:jobFrame,jobId,scope:'async-residency-job',queueWaitMs:started-queuedAt,pages:traceSet('job',queuedResidency?.map(page=>page.url)??[]),elapsedMs:null,cpuWorkIncluded:true,gpuQueueWaitIncluded:false}));try{while(queuedResidency){const next=queuedResidency;queuedResidency=undefined;await ensureResident(next,jobFrame,jobId);}}catch(error){diagnosticFailure('coverage-upload-failed',error);if(/LOST|DISPOSED/i.test(String(error)))lost=true;throw error;}finally{residencyRunning=false;traceDiagnostic('residency-job-end','Job de résidence GPU terminé',()=>({frame:jobFrame,jobId,scope:'async-residency-job',durationMs:performance.now()-started,elapsedMs:performance.now()-queuedAt,pages:traceSet('job',[...residencyWanted]),loaded:traceSet('job.loaded',[...residencyWanted].filter(url=>!!cache?.get(url))),residentPages:cache?.stats().residentPages??null,queueWaitMs:started-queuedAt,cpuWorkIncluded:true,gpuQueueWaitIncluded:false}));}});
  void pending.catch(()=>{});
 };
 const backend:WebgpuPagesBackend={
  id:'webgpu-page-raster',
  capabilities,
  scene,
  get overBudget(){return overBudget;},
  setDiagnostic(mode){diagnostic=mode;},
  refreshSceneLighting(){lights?.refresh();lightState=lights?.update();capturedRevision=-1;engineDiagnostic('scene-lighting','Inventaire des lumières actualisé',{version:1,...lightState,shadows:false,globalIllumination:false});},
  async prepare(){
   context.signal?.throwIfAborted();
   if(!gpuDevice)throw new Error('WEBGPU_UNAVAILABLE');
   if(bootstrap.length>slots)throw new Error(`INITIAL_COVERAGE_BUDGET: ${bootstrap.length} pages required, ${slots} slots`);
   gpuTiming=createGpuTiming(gpuDevice,{sampleEveryFrames:traceEnabled?1:60,retainSamples:!traceEnabled,onSample:traceEnabled?sample=>traceDiagnostic(sample.error?'gpu-timing-unavailable':'gpu-timing',sample.error?'Mesure GPU indisponible':'Durées GPU mesurées par passe',()=>({backend:'webgpu-page-raster',submission:sample.submission??null,scope:'render-passes-only',...sample,frame:sample.frame})):undefined});
   const timingStats=gpuTiming.stats();
   engineDiagnostic('gpu-timing-status','Disponibilité des mesures GPU par passe',{version:1,available:gpuTiming.supported,reason:gpuTiming.supported?null:'timestamp-query-unavailable',method:'timestamp-query',sampleEveryFrames:timingStats.sampleEveryFrames,maxPasses:64,maxPending:1,maxBufferAllocationBytes:2048,queryCount:128,gpuMs:null,scope:'render-passes-only',stats:timingStats});
   gpuDevice.addEventListener?.('uncapturederror',onGpuError);
   gpuDevice.lost.then(info=>{if(!lost)engineDiagnostic('gpu-device-lost','Périphérique WebGPU perdu',{reason:info.reason,message:info.message});lost=true;}).catch(error=>{if(!lost)diagnosticFailure('gpu-device-lost',error);lost=true;});
   try{
    lights=createSceneLightBuffer(gpuDevice,context.sceneLighting??source);lightState=lights.update();
    engineDiagnostic('scene-lighting','Lumières de la scène actives',{version:1,...lightState,shadows:false,globalIllumination:false});
    deferred=await createDeferredLighting(gpuDevice,lights.buffer);context.signal?.throwIfAborted();
    const outputCanvas=context.gpuCanvas??(typeof document!=='undefined'?document.createElement('canvas'):undefined);
    if(outputCanvas){
     presenter=createGpuPresenter(gpuDevice,outputCanvas);
     capabilities.unsupported=capabilities.unsupported.filter(item=>item!=='direct WebGPU present');
     if(!context.gpuCanvas){
      canvasTexture=new THREE.CanvasTexture(outputCanvas);canvasTexture.colorSpace=THREE.SRGBColorSpace;canvasTexture.flipY=false;canvasTexture.generateMipmaps=false;canvasTexture.minFilter=THREE.NearestFilter;canvasTexture.magFilter=THREE.NearestFilter;
      blitMaterial=new THREE.ShaderMaterial({uniforms:{image:{value:canvasTexture}},vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:'uniform sampler2D image;void main(){ivec2 sz=textureSize(image,0);gl_FragColor=texelFetch(image,ivec2(int(gl_FragCoord.x),sz.y-1-int(gl_FragCoord.y)),0);\n#include <colorspace_fragment>\n}',depthTest:false,depthWrite:false,toneMapped:false});
      blit=new THREE.Mesh(new THREE.PlaneGeometry(2,2),blitMaterial);blit.frustumCulled=false;blit.userData.blit=true;scene.add(blit);
     }
    }
    engineDiagnostic('gpu-presentation','Présentation GPU initialisée',{mode:context.gpuCanvas?'direct-canvas':presenter?'gpu-canvas-webgl-composition':'texture-only',imageReadbackDuringRender:false});
    const cacheOptions=(traceEnabled?{pageBytes,slots,onDiagnostic:(event:{phase:string;message:string;context:Record<string,unknown>})=>traceDiagnostic(`cache-${event.phase}`,event.message,()=>({...event.context,frame}))}:{pageBytes,slots}) as Parameters<typeof createGpuPageCache>[2];
    cache=createGpuPageCache(gpuDevice,pageSource,cacheOptions);
    bindGroupLayout=gpuDevice.createBindGroupLayout({entries:[
     {binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
     {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
     {binding:2,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:UNIFORM_STRIDE}},
    ]});
    const module=gpuDevice.createShaderModule({code:SHADER});
    const layout=gpuDevice.createPipelineLayout({bindGroupLayouts:[bindGroupLayout]});
    const fragment={module,entryPoint:'fs',targets:[{format:'rgba8unorm' as GPUTextureFormat}]};
    const depthStencil={format:'depth32float' as GPUTextureFormat,depthWriteEnabled:true,depthCompare:'less' as GPUCompareFunction};
    pipelineBack=gpuDevice.createRenderPipeline({layout,vertex:{module,entryPoint:'vs'},fragment,primitive:{topology:'triangle-list',cullMode:'back',frontFace:'ccw'},depthStencil});
    pipelineBackCw=gpuDevice.createRenderPipeline({layout,vertex:{module,entryPoint:'vs'},fragment,primitive:{topology:'triangle-list',cullMode:'back',frontFace:'cw'},depthStencil});
    pipelineNone=gpuDevice.createRenderPipeline({layout,vertex:{module,entryPoint:'vs'},fragment,primitive:{topology:'triangle-list',cullMode:'none',frontFace:'ccw'},depthStencil});
    pipelineBlend=gpuDevice.createRenderPipeline({layout,vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm' as GPUTextureFormat,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none',frontFace:'ccw'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'less'}});
    for(const rec of allPages){
     if(positionBuffers.has(rec.attributes))continue;
     const attr=rec.attributes.position;if(!attr)continue;
     const xyz=new Float32Array(attr.count*3);
     for(let i=0;i<attr.count;i++){xyz[i*3]=attr.getX(i);xyz[i*3+1]=attr.getY(i);xyz[i*3+2]=attr.getZ(i);}
     const buffer=gpuDevice.createBuffer({size:xyz.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
     gpuDevice.queue.writeBuffer(buffer,0,xyz.buffer);positionBuffers.set(rec.attributes,buffer);
    }
    zeroUv=gpuDevice.createBuffer({size:8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    gpuDevice.queue.writeBuffer(zeroUv,0,new Float32Array([0,0]));
    for(const copy of blendCopies){
     if(isTransmissive(copy.material)){if(context.gpuCanvas)throw new Error('UNSUPPORTED_TRANSMISSION');continue;}
     const mat=visMaterial(copy.material);
     const attr=copy.geometry.attributes.position,idx=copy.geometry.getIndex();if(!attr||!idx)continue;
     let position=positionBuffers.get(copy.geometry.attributes);
     if(!position){
      const xyz=new Float32Array(attr.count*3);for(let i=0;i<attr.count;i++){xyz[i*3]=attr.getX(i);xyz[i*3+1]=attr.getY(i);xyz[i*3+2]=attr.getZ(i);}
      position=gpuDevice.createBuffer({size:xyz.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});gpuDevice.queue.writeBuffer(position,0,xyz.buffer);positionBuffers.set(copy.geometry.attributes,position);
     }
     const paged=!!copy.userData.pagedBlend;
     const src=idx.array,indexData=paged?new Uint32Array(0):src instanceof Uint32Array?src:new Uint32Array(src as ArrayLike<number>);
     const index=gpuDevice.createBuffer({size:Math.max(4,indexData.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
     if(indexData.byteLength)gpuDevice.queue.writeBuffer(index,0,indexData.buffer,indexData.byteOffset,indexData.byteLength);
     const uvAttr=copy.geometry.attributes.uv;
     let uv:GPUBuffer|undefined;
     if(uvAttr){
      const uvData=new Float32Array(uvAttr.count*2);for(let i=0;i<uvAttr.count;i++){uvData[i*2]=uvAttr.getX(i);uvData[i*2+1]=uvAttr.getY(i);}
      uv=gpuDevice.createBuffer({size:Math.max(8,uvData.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      gpuDevice.queue.writeBuffer(uv,0,uvData.buffer as ArrayBuffer,uvData.byteOffset,uvData.byteLength);
     }
     const normalAttr=copy.geometry.attributes.normal,tangentAttr=copy.geometry.attributes.tangent;let normal:GPUBuffer|undefined;
     if(normalAttr){const data=new Float32Array(normalAttr.count*7);for(let i=0;i<normalAttr.count;i++){data[i*7]=normalAttr.getX(i);data[i*7+1]=normalAttr.getY(i);data[i*7+2]=normalAttr.getZ(i);if(tangentAttr){data[i*7+3]=tangentAttr.getX(i);data[i*7+4]=tangentAttr.getY(i);data[i*7+5]=tangentAttr.getZ(i);data[i*7+6]=tangentAttr.getW(i);}}normal=gpuDevice.createBuffer({size:Math.max(12,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});gpuDevice.queue.writeBuffer(normal,0,data);}
     const opacity=Array.isArray(copy.material)?(copy.material[0] as THREE.MeshBasicMaterial).opacity??1:(copy.material as THREE.MeshBasicMaterial).opacity??1;
     let flags=0;if(mat.lit)flags|=FLAG_LIT;if(mat.doubleSided)flags|=FLAG_DOUBLE;if(normal)flags|=FLAG_HAS_NORMAL;if(tangentAttr)flags|=FLAG_HAS_TANGENT;if(mat.backSide)flags|=FLAG_BACK;if(mat.map&&mat.map.wrapS!==THREE.ClampToEdgeWrapping)flags|=FLAG_WRAP_S_REPEAT;if(mat.map&&mat.map.wrapT!==THREE.ClampToEdgeWrapping)flags|=FLAG_WRAP_T_REPEAT;
     // Static source transforms are baked for this backend. World AABBs remain
     // conservative under rotation, mirroring, nonuniform scale and shear.
     let bounds:THREE.Box3|undefined;
     if(copy.frustumCulled){
      if(!copy.geometry.boundingBox)copy.geometry.computeBoundingBox();
      const box=copy.geometry.boundingBox?.clone().applyMatrix4(copy.matrix);
      if(box&&!box.isEmpty()&&[...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))bounds=box;
     }
     const item={position,index,uv,normal,material:copy.material,count:paged?0:idx.count,matrix:copy.matrix,sourceMesh:copy.userData.sourceMesh as THREE.Mesh|undefined,sourceGeometry:copy.geometry,bounds,rgba:[mat.baseColor[0],mat.baseColor[1],mat.baseColor[2],opacity] as [number,number,number,number],map:mat.map,flags,paged};
     blendGpu.push(item);if(paged&&item.sourceMesh)pagedBlendGpu.set(item.sourceMesh,item);
     scene.remove(copy);
    }
    const [width,height]=viewport??[1,1];ensureTargets(gpuDevice,Math.max(1,width),Math.max(1,height));
    ensureUniform(gpuDevice,cap);
    try{
     geometryBlocks.clear();mapLayer.clear();dataLayer.clear();uvScales.length=0;uvScales.push([1,1]);dataUvScales.length=0;dataUvScales.push([1,1]);
     let vertexCount=0;
     for(const rec of allPages){
      if(rec.transparent||geometryBlocks.has(rec.attributes))continue;
      const n=rec.attributes.position?.count??0;
      geometryBlocks.set(rec.attributes,{vertexBase:vertexCount,count:n,hasUv:!!rec.attributes.uv,hasNormal:!!rec.attributes.normal,hasTangent:!!rec.attributes.tangent});
      vertexCount+=n;
     }
     vertexCount=Math.max(1,vertexCount);
     const pos=new Float32Array(vertexCount*3),uv=new Float32Array(vertexCount*2),nrm=new Float32Array(vertexCount*7),filled=new Set<THREE.BufferGeometry['attributes']>();
     for(const rec of allPages){
      if(rec.transparent||filled.has(rec.attributes))continue;filled.add(rec.attributes);
      const block=geometryBlocks.get(rec.attributes)!;const p=rec.attributes.position,u=rec.attributes.uv,n=rec.attributes.normal,t=rec.attributes.tangent;
      for(let i=0;i<block.count;i++){
       const o=block.vertexBase+i;
       if(p){pos[o*3]=p.getX(i);pos[o*3+1]=p.getY(i);pos[o*3+2]=p.getZ(i);}
       if(u){uv[o*2]=u.getX(i);uv[o*2+1]=u.getY(i);}
       if(t){nrm[o*7+3]=t.getX(i);nrm[o*7+4]=t.getY(i);nrm[o*7+5]=t.getZ(i);nrm[o*7+6]=t.getW(i);}
       if(n){nrm[o*7]=n.getX(i);nrm[o*7+1]=n.getY(i);nrm[o*7+2]=n.getZ(i);}
      }
     }
     const upload=(data:Float32Array)=>{const buffer=gpuDevice.createBuffer({size:Math.max(4,data.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});gpuDevice.queue.writeBuffer(buffer,0,data.buffer as ArrayBuffer,data.byteOffset,data.byteLength);return buffer;};
     concatPos=upload(pos);concatUv=upload(uv);concatNrm=upload(nrm);
     const maps:THREE.Texture[]=[],dataMaps:THREE.Texture[]=[];
     const addColor=(texture?:THREE.Texture)=>{if(texture&&!mapLayer.has(texture)){mapLayer.set(texture,maps.length+1);maps.push(texture);}};
     const addData=(texture?:THREE.Texture)=>{if(texture&&!dataLayer.has(texture)){dataLayer.set(texture,dataMaps.length+1);dataMaps.push(texture);}};
     for(const rec of allPages){const mat=visMaterial(rec.material);addColor(mat.map);addColor(mat.emissiveMap);addData(mat.roughnessMap);addData(mat.metalnessMap);addData(mat.normalMap);addData(mat.aoMap);}
     for(const copy of blendCopies){const mat=visMaterial(copy.material);addColor(mat.map);addColor(mat.emissiveMap);addData(mat.roughnessMap);addData(mat.metalnessMap);addData(mat.normalMap);addData(mat.aoMap);}
     engineDiagnostic('material-textures','Textures nécessaires au rendu',{colorTextures:maps.length,dataTextures:dataMaps.length,materials:new Set(allPages.map(page=>page.material)).size,opaquePages:allPages.length,forwardMeshes:blendCopies.length,geometryWithTangents:[...geometryBlocks.values()].filter(block=>block.hasTangent).length,geometryWithoutTangents:[...geometryBlocks.values()].filter(block=>!block.hasTangent).length});
     const textureStarted=performance.now();
     let maxW=1,maxH=1;
     const rgbaMaps=maps.map(texture=>{const rgba=textureRgba(texture);if(rgba){maxW=Math.max(maxW,rgba.width);maxH=Math.max(maxH,rgba.height);}else{const image=texture.image as {width?:number;height?:number}|undefined;if(image?.width&&image.height){maxW=Math.max(maxW,image.width);maxH=Math.max(maxH,image.height);}}return rgba;});
     const layers=Math.max(2,maps.length+1);
     mapsTexture=gpuDevice.createTexture({size:{width:maxW,height:maxH,depthOrArrayLayers:layers},format:'rgba8unorm-srgb',mipLevelCount:1+Math.floor(Math.log2(Math.max(maxW,maxH))),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
     const white=new Uint8Array(maxW*maxH*4);white.fill(255);
     gpuDevice.queue.writeTexture({texture:mapsTexture,origin:[0,0,0]},white,{bytesPerRow:maxW*4,rowsPerImage:maxH},{width:maxW,height:maxH});
     for(let i=0;i<maps.length;i++){
      const rgba=rgbaMaps[i],layer=i+1;uvScales[layer]=[1,1];
      if(rgba){
       const padded=new Uint8Array(maxW*maxH*4);padded.fill(255);
       for(let y=0;y<rgba.height;y++)padded.set(rgba.data.subarray(y*rgba.width*4,(y+1)*rgba.width*4),y*maxW*4);
       gpuDevice.queue.writeTexture({texture:mapsTexture,origin:[0,0,layer]},padded,{bytesPerRow:maxW*4,rowsPerImage:maxH},{width:maxW,height:maxH});
       uvScales[layer]=[rgba.width/maxW,rgba.height/maxH];
      }else{
       const image=maps[i].image as GPUCopyExternalImageSource|undefined;
       if(!image||typeof gpuDevice.queue.copyExternalImageToTexture!=='function')throw new Error('MATERIAL_COLOR_TEXTURE_UNAVAILABLE');
       {
        try{
         const w='width' in image?(image as ImageBitmap).width:maxW,h='height' in image?(image as ImageBitmap).height:maxH;
         gpuDevice.queue.copyExternalImageToTexture({source:image},{texture:mapsTexture,origin:[0,0,layer]},[w,h]);
         uvScales[layer]=[w/maxW,h/maxH];
        }catch(error){diagnosticFailure('color-texture-upload-failed',error);throw error;}
       }
      }
     }
     let dataW=1,dataH=1;
     const rgbaData=dataMaps.map(texture=>{const rgba=textureRgba(texture);if(rgba){dataW=Math.max(dataW,rgba.width);dataH=Math.max(dataH,rgba.height);}else{const image=texture.image as {width?:number;height?:number}|undefined;if(image?.width&&image.height){dataW=Math.max(dataW,image.width);dataH=Math.max(dataH,image.height);}}return rgba;});
     const dataLayers=Math.max(2,dataMaps.length+1);
     dataMapsTexture=gpuDevice.createTexture({size:{width:dataW,height:dataH,depthOrArrayLayers:dataLayers},format:'rgba8unorm',mipLevelCount:1+Math.floor(Math.log2(Math.max(dataW,dataH))),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
     const dataWhite=new Uint8Array(dataW*dataH*4);dataWhite.fill(255);
     gpuDevice.queue.writeTexture({texture:dataMapsTexture,origin:[0,0,0]},dataWhite,{bytesPerRow:dataW*4,rowsPerImage:dataH},{width:dataW,height:dataH});
     for(let i=0;i<dataMaps.length;i++){
      const rgba=rgbaData[i],layer=i+1;dataUvScales[layer]=[1,1];
      if(rgba){
       const padded=new Uint8Array(dataW*dataH*4);padded.fill(255);
       for(let y=0;y<rgba.height;y++)padded.set(rgba.data.subarray(y*rgba.width*4,(y+1)*rgba.width*4),y*dataW*4);
       gpuDevice.queue.writeTexture({texture:dataMapsTexture,origin:[0,0,layer]},padded,{bytesPerRow:dataW*4,rowsPerImage:dataH},{width:dataW,height:dataH});
       dataUvScales[layer]=[rgba.width/dataW,rgba.height/dataH];
      }else{
       const image=dataMaps[i].image as GPUCopyExternalImageSource|undefined;
       if(!image||typeof gpuDevice.queue.copyExternalImageToTexture!=='function')throw new Error('MATERIAL_DATA_TEXTURE_UNAVAILABLE');
       const w='width' in image?(image as ImageBitmap).width:dataW,h='height' in image?(image as ImageBitmap).height:dataH;
       gpuDevice.queue.copyExternalImageToTexture({source:image},{texture:dataMapsTexture,origin:[0,0,layer]},[w,h]);
       dataUvScales[layer]=[w/dataW,h/dataH];
      }
     }
     await generateMaterialMips(gpuDevice,mapsTexture,'rgba8unorm-srgb',maxW,maxH,uvScales);
     await generateMaterialMips(gpuDevice,dataMapsTexture,'rgba8unorm',dataW,dataH,dataUvScales);
     const scales=new Float32Array(Math.max(uvScales.length,dataUvScales.length)*4);
     for(let i=0;i<scales.length/4;i++){scales.set(dataUvScales[i]??[1,1],i*4);scales.set(uvScales[i]??[1,1],i*4+2);}
     materialScales=gpuDevice.createBuffer({size:scales.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});gpuDevice.queue.writeBuffer(materialScales,0,scales);
     engineDiagnostic('material-textures-ready','Textures et filtrage prêts',{color:{count:maps.length,size:[maxW,maxH],mipLevels:1+Math.floor(Math.log2(Math.max(maxW,maxH))),format:'rgba8unorm-srgb'},data:{count:dataMaps.length,size:[dataW,dataH],mipLevels:1+Math.floor(Math.log2(Math.max(dataW,dataH))),format:'rgba8unorm'},preparationMs:performance.now()-textureStarted,lighting:'GGX direct + diffuse hemisphere; no environment map',display:'ACES once, sRGB once'});
     mapsSampler=gpuDevice.createSampler({magFilter:'linear',minFilter:'linear',mipmapFilter:'linear'});
     try{
      blendBindGroupLayout=gpuDevice.createBindGroupLayout({entries:[
       {binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
       {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
       {binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
       {binding:3,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform',hasDynamicOffset:true,minBindingSize:UNIFORM_STRIDE}},
       {binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d-array'}},
       {binding:5,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
       {binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d-array'}},
       {binding:7,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
       {binding:8,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      {binding:9,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      ]});
      const blendModule=gpuDevice.createShaderModule({code:BLEND_SHADER});
      const makeBlend=(cullMode:GPUCullMode)=>{const descriptor:GPURenderPipelineDescriptor={
       layout:gpuDevice.createPipelineLayout({bindGroupLayouts:[blendBindGroupLayout]}),
       vertex:{module:blendModule,entryPoint:'vs'},
       fragment:{module:blendModule,entryPoint:'fs',targets:[{format:'rgba16float' as GPUTextureFormat,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},
       primitive:{topology:'triangle-list',cullMode,frontFace:'ccw'},
       depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'less'},
      };return gpuDevice.createRenderPipelineAsync?gpuDevice.createRenderPipelineAsync(descriptor):Promise.resolve(gpuDevice.createRenderPipeline(descriptor));};
      for(const item of blendGpu)item.group=undefined;
      pipelineBlendTextured=await makeBlend('none');pipelineBlendFront=await makeBlend('front');pipelineBlendBack=await makeBlend('back');
     }catch(error){diagnosticFailure('forward-material-pipeline-failed',error);blendBindGroupLayout=undefined;pipelineBlendTextured=undefined;}
     shadeUniform=gpuDevice.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
     visBindGroupLayout=gpuDevice.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
      {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
      {binding:2,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      {binding:3,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
      {binding:4,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform',minBindingSize:64}},
      {binding:5,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
      {binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d-array'}},
      {binding:7,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
     ]});
     zeroFlags=gpuDevice.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
     gpuDevice.queue.writeBuffer(zeroFlags,0,new Uint32Array([0]));
     visUniform=gpuDevice.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
     const visModule=gpuDevice.createShaderModule({code:VIS_SHADER});
     const shadeModule=gpuDevice.createShaderModule({code:SHADE_SHADER});
     if(typeof visModule.getCompilationInfo==='function'){
      const visInfo=await visModule.getCompilationInfo();
      if(visInfo.messages.some(message=>message.type==='error'))throw new Error('VIS_SHADER');
     }
     if(typeof shadeModule.getCompilationInfo==='function'){
      const shadeInfo=await shadeModule.getCompilationInfo();
      if(shadeInfo.messages.some(message=>message.type==='error'))throw new Error('SHADE_SHADER: '+shadeInfo.messages.filter(message=>message.type==='error').map(message=>message.message).join(' | '));
     }
     const visLayout=gpuDevice.createPipelineLayout({bindGroupLayouts:[visBindGroupLayout]});
     const visDepth={format:'depth32float' as GPUTextureFormat,depthWriteEnabled:true,depthCompare:'less' as GPUCompareFunction};
     const makeVis=(layout:GPUPipelineLayout,vertex:string,fragment:string,targets:GPUColorTargetState[],cull:GPUCullMode,frontFace:GPUFrontFace='ccw')=>gpuDevice.createRenderPipeline({layout,vertex:{module:visModule,entryPoint:vertex},fragment:{module:visModule,entryPoint:fragment,targets},primitive:{topology:'triangle-list',cullMode:cull,frontFace},depthStencil:visDepth});
     const oneTarget:GPUColorTargetState[]=[{format:'r32uint'}];
     gpuHiz=await createGpuHiz(gpuDevice,Math.max(1,width),Math.max(1,height),cap);
     const scoped=async<T,>(run:()=>T):Promise<T>=>{
      if(typeof gpuDevice.pushErrorScope==='function')gpuDevice.pushErrorScope('validation');
      const value=run();
      const error=typeof gpuDevice.popErrorScope==='function'?await gpuDevice.popErrorScope():null;
      if(error)throw error;
      return value;
     };
     try{
      if(!gpuHiz||!visBindGroupLayout)throw new Error('HIZ_UNAVAILABLE');
      const twoTarget:GPUColorTargetState[]=[{format:'r32uint'},{format:'r32float'}];
      await scoped(()=>{
       visPipelineBack=makeVis(visLayout,'vis_vs','vis_hiz_fs',twoTarget,'back');
       visPipelineBackCw=makeVis(visLayout,'vis_vs','vis_hiz_fs',twoTarget,'back','cw');
       visPipelineNone=makeVis(visLayout,'vis_vs','vis_hiz_fs',twoTarget,'none');
       visPipelineFront=makeVis(visLayout,'vis_vs','vis_hiz_fs',twoTarget,'front');
       visPipelineFrontCw=makeVis(visLayout,'vis_vs','vis_hiz_fs',twoTarget,'front','cw');
       visHizRestBack=makeVis(visLayout,'vis_hiz_vs','vis_hiz_fs',twoTarget,'back');
       visHizRestNone=makeVis(visLayout,'vis_hiz_vs','vis_hiz_fs',twoTarget,'none');
       visHizRestFront=makeVis(visLayout,'vis_hiz_vs','vis_hiz_fs',twoTarget,'front');
       visHizRestBackCw=makeVis(visLayout,'vis_hiz_vs','vis_hiz_fs',twoTarget,'back','cw');
       visHizRestFrontCw=makeVis(visLayout,'vis_hiz_vs','vis_hiz_fs',twoTarget,'front','cw');
      });
     }catch(error){
      diagnosticFailure('hiz-pipeline-fallback',error);dropGpuHiz();
      await scoped(()=>{
       visPipelineBack=makeVis(visLayout,'vis_vs','vis_fs',oneTarget,'back');
       visPipelineBackCw=makeVis(visLayout,'vis_vs','vis_fs',oneTarget,'back','cw');
       visPipelineNone=makeVis(visLayout,'vis_vs','vis_fs',oneTarget,'none');
       visPipelineFront=makeVis(visLayout,'vis_vs','vis_fs',oneTarget,'front');
       visPipelineFrontCw=makeVis(visLayout,'vis_vs','vis_fs',oneTarget,'front','cw');
      });
     }
     shadeBindGroupLayout=gpuDevice.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'uint'}},
      {binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      {binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      {binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      {binding:4,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      {binding:5,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},
      {binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d-array'}},
      {binding:7,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
      {binding:8,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform',minBindingSize:256}},
      {binding:9,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d-array'}},
     ]});
     await scoped(()=>{
      shadePipeline=gpuDevice.createRenderPipeline({
       layout:gpuDevice.createPipelineLayout({bindGroupLayouts:[shadeBindGroupLayout]}),
       vertex:{module:shadeModule,entryPoint:'shade_vs'},
       fragment:{module:shadeModule,entryPoint:'shade_fs',targets:SURFACE_FORMATS.map(format=>({format}))},
       primitive:{topology:'triangle-list',cullMode:'none'},
      });
     });
     if(!pageTable)pageTable=gpuDevice.createBuffer({size:PAGE_INFO_STRIDE,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
     if(visView&&cache&&concatPos&&concatUv&&concatNrm&&mapsTexture&&dataMapsTexture&&mapsSampler&&shadeUniform&&shadeBindGroupLayout){
      shadeBindGroup=gpuDevice.createBindGroup({layout:shadeBindGroupLayout,entries:[
       {binding:0,resource:visView},{binding:1,resource:{buffer:cache.buffer}},{binding:2,resource:{buffer:concatPos}},
       {binding:3,resource:{buffer:concatUv}},{binding:4,resource:{buffer:concatNrm}},{binding:5,resource:{buffer:pageTable}},
       {binding:6,resource:mapsTexture.createView({dimension:'2d-array'})},{binding:7,resource:mapsSampler},{binding:8,resource:{buffer:shadeUniform}},
       {binding:9,resource:dataMapsTexture.createView({dimension:'2d-array'})},
      ]});
     }
     visEnabled=!!visTexture&&!!shadeBindGroup&&!!shadePipeline&&!!visPipelineBack;
     if(visEnabled){
      engineDiagnostic('material-surfaces-ready','Surfaces et éclairage séparés',{surfaceVersion:1,formats:SURFACE_FORMATS,bytesPerPixel:28,lighting:'HDR',globalIllumination:false,motionVectors:false});
      capabilities.materials='Source glTF via GGX direct specular and hemisphere diffuse lighting with visibility buffer; double-sided when the material is';
      capabilities.unsupported=capabilities.unsupported.filter(item=>item!=='visibility buffer'&&item!=='textured PBR maps'&&item!=='occlusion culling'&&item!=='temporal occlusion culling');
      gpuDraw=await createGpuDraw(gpuDevice,slots);
      if(gpuDraw)capabilities.unsupported=capabilities.unsupported.filter(item=>item!=='indirect draw');
     }else dropVis();
    }catch(error){diagnosticFailure('material-pipeline-failed',error);dropVis();}
    if(blendGpu.length&&!pipelineBlendTextured)dropVis();
    if(context.gpuCanvas&&!visEnabled)throw new Error('WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE');
    if(context.gpuCanvas&&blendGpu.length&&!pipelineBlendTextured)throw new Error('WEBGPU_FORWARD_MATERIAL_UNAVAILABLE');
    const xyzCache=new WeakMap<THREE.BufferGeometry['attributes'],Float32Array>();
    for(const rec of allPages){
     const array=rec.array,attr=rec.attributes.position;
     if(!array||!attr)continue;
     let xyz=xyzCache.get(rec.attributes);
     if(!xyz){xyz=new Float32Array(attr.count*3);for(let i=0;i<attr.count;i++){xyz[i*3]=attr.getX(i);xyz[i*3+1]=attr.getY(i);xyz[i*3+2]=attr.getZ(i);}xyzCache.set(rec.attributes,xyz);}
     rec.cone=visMaterial(rec.material).doubleSided||visMaterial(rec.material).backSide?OPEN_CONE:triangleCone(xyz,array);
    }
    const packed=packSelectionForest(roots);
    gpuSelection=await createGpuSelection(gpuDevice,packed);
    capabilities.gpuDriven=!!gpuSelection;
    await ensureBootstrap();
    engineDiagnostic('render-capabilities','Chemins de rendu prêts',{surfaceVersion:surfaces?.version??null,deferredLighting:!!deferred,frameBudgetBytes:frameBudget,imageReadbackDuringRender:false,visibilityBuffer:visEnabled,gpuSelection:!!gpuSelection,indirectDraw:!!gpuDraw,hiz:!!gpuHiz,unsupported:[...capabilities.unsupported]});
   }catch(error){
    diagnosticFailure('webgpu-prepare-failed',error);
    if(String(error).includes('WEBGPU')||String(error).includes('INVALID_PAGE_BUDGET'))throw error;
    throw error;
   }
  },
  render(camera){
   if(secondaryCamera&&!surfaceRenderAllowed)throw new Error('SURFACE_CAPTURE_BUSY');
   if(context.signal?.aborted)context.signal.throwIfAborted();
   if(lost)throw new Error('WEBGPU_LOST');
   if(!gpuDevice||!cache)throw new Error('WEBGPU_UNAVAILABLE');
   source.updateMatrixWorld(true);
   for(let i=0;i<roots.length;i++)worldUpdates.set(roots[i].world.elements,i*16);
   if(gpuSelection?.updateWorlds(worldUpdates)){previouslyDrawnUrls.clear();temporalHizState.pyramid=undefined;temporalHizState.camera=undefined;}
   for(const item of blendGpu)if(item.sourceMesh){item.matrix.copy(item.sourceMesh.matrixWorld);if(item.bounds&&item.sourceGeometry.boundingBox)item.bounds.copy(item.sourceGeometry.boundingBox).applyMatrix4(item.matrix);}
   const cpuStart=performance.now();
   lightState=lights?.update();
   const lightsEnd=performance.now();
   lastCamera=camera;overBudget=false;submittedTriangles=0;hizRejected=0;frame++;
   traceDiagnostic('cpu-lights','Mise à jour CPU des lumières',()=>({frame,scope:'cpu/lights.update',elapsedMs:lightsEnd-cpuStart,lightState}));
   const pixelError=resolvePixelError(context,camera,motion);
   const selectionStarted=lightsEnd;
   let selected:{complete?:boolean;shown:PageRec[];wanted?:PageRec[];visible:number;selectedTriangles:number;frustumRejected:number;lodLevel:number}|undefined;
   let gpuPeekUrls:string[]=[];
   let gpuSelectionDecision:{source:'gpu'|'cpu';decision:string;reason?:string;pageIds?:Array<string|number>;uniformsMatch?:boolean}={source:'cpu',decision:'not-attempted'};
   if(gpuSelection?.failed()){gpuSelectionDecision={source:'cpu',decision:'fallback',reason:'gpu-selection-marked-failed'};traceDiagnostic('gpu-selection-dispatch','Sélection GPU indisponible, fallback CPU',{frame,submission:imageRevision,reason:gpuSelectionDecision.reason});dropGpuSelection();}
   if(gpuSelection){
    cameraSelectionUniforms(camera,pixelError,viewport,selectionUniforms);
    traceDiagnostic('gpu-selection-dispatch','Dispatch de sélection GPU',()=>({frame,submission:imageRevision,pixelError,viewport:viewport.slice(),cameraWorld:selectionUniforms.cameraWorld,source:'gpu-selection'}));
    try{gpuSelection.dispatch(selectionUniforms);}catch(error){diagnosticFailure('gpu-selection-dispatch-failed',error);gpuSelectionDecision={source:'cpu',decision:'fallback',reason:'dispatch-failed'};dropGpuSelection();}
    const cut=gpuSelection?.peek();
    const uniformsMatch=!!cut&&sameSelectionUniforms(cut.uniforms,selectionUniforms);
    if(cut&&uniformsMatch){
     const gpuShown=shownFromGpu(packedPages,cut.result,frame);
     gpuPeekUrls=gpuShown.shown.map(rec=>rec.url);
     const missing=gpuShown.shown.filter(rec=>!hasBytes(rec)||!cache!.get(rec.url)).map(rec=>rec.url);
     if(bootstrapReady&&!missing.length){selected=gpuShown;gpuSelectionDecision={source:'gpu',decision:'accepted',uniformsMatch:true};}
     else gpuSelectionDecision={source:'cpu',decision:'rejected',reason:!bootstrapReady?'coverage-not-ready':'selected-pages-not-resident',uniformsMatch:true};
    }else if(gpuSelection){
     gpuSelectionDecision={source:'cpu',decision:'rejected',reason:cut?'stale-selection-uniforms':'no-selection-result',uniformsMatch:false};
    }
     traceDiagnostic('gpu-selection-peek','Décision de la sélection GPU',()=>({frame,submission:imageRevision,...gpuSelectionDecision,selected:traceSet(`gpu-selection.${gpuSelectionDecision.decision}`,gpuPeekUrls),peekPageCount:cut?.result.pageIds.length??0}));
   }
   const gpuSelectionResolveEnd=performance.now();
   traceDiagnostic('gpu-selection-resolution','Résolution CPU du résultat de sélection GPU',()=>({frame,submission:imageRevision,scope:'cpu/gpu-selection-dispatch-peek',elapsedMs:gpuSelectionResolveEnd-selectionStarted,decision:gpuSelectionDecision,selectedFromGpu:!!selected}));
   if(!selected){
    const cpuSelectionStarted=performance.now();
    selected=selectVisiblePages(roots,camera,{pixelError,viewport,frame,holdResident:true,isResident:rec=>!!cache!.get(rec.url)},shown);
   const cpuSelectionEnd=performance.now(),chosen=selected;traceDiagnostic('cpu-selection','Sélection CPU de référence',()=>({frame,submission:imageRevision,scope:'cpu/selectVisiblePages',elapsedMs:cpuSelectionEnd-cpuSelectionStarted,shown:traceSet('selection.shown',chosen.shown.map(page=>page.url)),wanted:traceSet('selection.wanted',chosen.wanted?.map(page=>page.url)??chosen.shown.map(page=>page.url)),visible:chosen.visible,selectedTriangles:chosen.selectedTriangles,frustumRejected:chosen.frustumRejected,lodLevel:chosen.lodLevel,reason:gpuSelectionDecision.reason??'gpu-selection-unavailable'}));
   }
   else{shown.length=0;shown.push(...selected.shown);}
   desired.length=0;for(let i=0;i<(selected.wanted?.length??shown.length);i++)desired.push((selected.wanted??shown)[i]);
   overBudget=false;visible=selected.visible;selectedTriangles=selected.selectedTriangles;frustumRejected=selected.frustumRejected;lodLevel=selected.lodLevel;
   const admissionStarted=performance.now(),requested=new Set([...bootstrapUrls,...desired.map(page=>page.url)]);
   const wasLimited=coverageBudgetLimited;coverageBudgetLimited=requested.size>slots;
   if(wasLimited!==coverageBudgetLimited)coverageBudgetEvent={version:1,limited:coverageBudgetLimited,requiredSlots:requested.size,slots,fallbackRetained:bootstrapReady};
   traceDiagnostic('residency-admission','Admission des ensembles demandés',()=>({frame,scope:'cpu/residency-admission',elapsedMs:performance.now()-admissionStarted,requested:traceSet('admission.requested',[...requested]),wanted:traceSet('admission.wanted',desired.map(page=>page.url)),loaded:traceSet('admission.loaded',drawn.map(page=>page.url)),slots,limited:coverageBudgetLimited}));
   if(!bootstrapReady){
    drawn.length=0;submittedTriangles=0;gpuDrawCalls=0;
    const loadingEnd=performance.now(),sample={version:1,frame,submission:imageRevision,scope:'backend-render-call',totalMs:loadingEnd-cpuStart,lightsMs:lightsEnd-cpuStart,selectionMs:loadingEnd-lightsEnd,residencyScheduleAndTargetsMs:null,encodeSubmitMs:null,transparentEncodeMs:0,transparentIncludedIn:'encodeSubmitMs',asyncResidencyWaitMs:null};
    cpuSample=sample;
    traceDiagnostic('frame','Snapshot de frame en attente de couverture GPU',()=>({backend:'webgpu-page-raster',frame,submission:imageRevision,pose:cameraPose(camera),source:gpuSelectionDecision.source,selection:gpuSelectionDecision,cpu:sample,coverage:{loaded:traceSet('frame.loaded',[]),wanted:traceSet('frame.wanted',desired.map(page=>page.url)),shown:traceSet('frame.shown',[]),bootstrap:traceSet('frame.bootstrap',bootstrap.map(page=>page.url)),ready:false},budget:{slots,requested:traceSet('frame.requested',[...bootstrapUrls,...desired.map(page=>page.url)]),limited:coverageBudgetLimited},gpuTiming:gpuTiming?.stats()??{supported:false,reason:'not-initialized'}}));
    return;
   }
   if(selected.complete===false)throw new Error('GPU_COVERAGE_INCOMPLETE');
   // A complete root cover is always pinned. Coarsen atomically before reclaiming
   // old detail slots if old and new refinements cannot coexist in the budget.
   const transitionStarted=performance.now(),transition=new Set([...requested,...shown.map(page=>page.url)]);
   if(!coverageBudgetLimited&&transition.size>slots){
    const fallback=selectVisiblePages(roots,camera,{pixelError,viewport,frame,holdResident:true,isResident:rec=>bootstrapUrls.has(rec.url)&&!!cache!.get(rec.url)});
    if(!fallback.complete)throw new Error('GPU_COVERAGE_INCOMPLETE');
    shown.length=0;shown.push(...fallback.shown);lodLevel=fallback.lodLevel;
   }
   traceDiagnostic('residency-transition','Transition de couverture calculée',()=>({frame,scope:'cpu/residency-transition',elapsedMs:performance.now()-transitionStarted,from:traceSet('transition.from',drawn.map(page=>page.url)),to:traceSet('transition.to',shown.map(page=>page.url)),requested:traceSet('transition.requested',[...requested]),transition:traceSet('transition.all',[...transition]),slots}));
   if(shown.some(page=>!hasBytes(page)))throw new Error('GPU_COVERAGE_BYTES_MISSING');
   readyScratch.length=0;readyScratch.push(...shown);
   let culled:PageRec[]=readyScratch;
   if(visEnabled&&!gpuHiz&&readyScratch.length>=2&&readyScratch.every(page=>page.array)){
    try{
     const cut=applyTemporalHiz(readyScratch.filter(page=>!page.transparent) as Array<PageRec&{array:Uint32Array}>,camera,viewport??targetSize,temporalHizState);
     culled=[...cut.shown,...readyScratch.filter(page=>page.transparent)];hizRejected=cut.hizRejected;
    }catch(error){diagnosticFailure('hiz-frame-fallback',error);/* Keep the selected cut. */}
   }
   const selectionEnd=performance.now();
   const queueStarted=performance.now();queueResident(coverageBudgetLimited?[]:desired);const queueEnd=performance.now();
   traceDiagnostic('residency-queue-reconstruct','Ensembles de résidence reconstruits',()=>({frame,scope:'cpu/residency-queue-reconstruct',elapsedMs:queueEnd-queueStarted,requested:traceSet('reconstruct.requested',desired.map(page=>page.url)),queued:traceSet('reconstruct.queued',queuedResidency?.map(page=>page.url)??[]),job:residencyJob}));
   const drawnVerifyStarted=performance.now();if(culled.some(page=>!cache!.get(page.url)))throw new Error('GPU_COVERAGE_INCOMPLETE');
   drawn.length=0;drawn.push(...culled);
   const drawnVerifyEnd=performance.now();traceDiagnostic('residency-drawn-verify','Couverture résidente vérifiée avant encodage',()=>({frame,scope:'cpu/residency-drawn-copy',elapsedMs:drawnVerifyEnd-drawnVerifyStarted,shown:traceSet('drawn.shown',shown.map(page=>page.url)),drawn:traceSet('drawn',drawn.map(page=>page.url)),loaded:traceSet('drawn.loaded',drawn.filter(page=>!!cache!.get(page.url)).map(page=>page.url))}));
   const [width,height]=viewport??targetSize,targetStarted=performance.now();ensureTargets(gpuDevice,Math.max(1,width),Math.max(1,height));
   traceDiagnostic('targets-ensure','Cibles GPU assurées',()=>({frame,scope:'cpu/ensureTargets',elapsedMs:performance.now()-targetStarted,width,height}));
   if(!renderPathLogged){
    renderPathLogged=true;
    const details={clearColor:`#${clearColor.toString(16).padStart(6,'0')}`,targetSize,visibilityBuffer:visEnabled,visibilityReady:!!(visPipelineBack&&shadePipeline&&visView),selectedPages:shown.length,drawnPages:drawn.length};
    engineDiagnostic('first-render-path','Configuration du premier rendu WebGPU',details);
    if(typeof window!=='undefined')console.info('[web-geometry] configuration du premier rendu WebGPU',details);
   }
   const tStart=performance.now();
   submittedTriangles=encodeDraws(gpuDevice,camera);
   const cpuEnd=performance.now();lastSubmitMs=cpuEnd-tStart;
   const sample={version:1,frame,submission:imageRevision,scope:'backend-render-call',totalMs:cpuEnd-cpuStart,lightsMs:lightsEnd-cpuStart,selectionMs:selectionEnd-lightsEnd,residencyScheduleAndTargetsMs:tStart-selectionEnd,encodeSubmitMs:lastSubmitMs,transparentEncodeMs,transparentIncludedIn:'encodeSubmitMs',asyncResidencyWaitMs:null};
   cpuSample=sample;
   traceDiagnostic('frame','Snapshot complet de la frame WebGPU',()=>({backend:'webgpu-page-raster',frame,submission:imageRevision,pose:cameraPose(camera),source:gpuSelectionDecision.source,selection:gpuSelectionDecision,cpu:sample,coverage:{loaded:traceSet('frame.loaded',drawn.map(page=>page.url)),wanted:traceSet('frame.wanted',desired.map(page=>page.url)),shown:traceSet('frame.shown',shown.map(page=>page.url)),bootstrap:traceSet('frame.bootstrap',bootstrap.map(page=>page.url)),ready:bootstrapReady},budget:{slots,requested:traceSet('frame.requested',[...new Set([...bootstrapUrls,...desired.map(page=>page.url)])]),limited:coverageBudgetLimited,frameBytes:frameBudget},gpuTiming:gpuTiming?.stats()??{supported:false,reason:'not-initialized'},transparent:{candidates:blendGpu.length,visibleMeshes:visibleBlend.length,frustumRejected:blendFrustumRejected,drawCalls:blendDrawCalls,submittedTriangles:blendSubmittedTriangles},hizRejected,drawCalls:gpuDrawCalls}));

  },
  syncResident(){
   if(secondaryCamera)return;
   if(lost||!gpuDevice||!cache||!lastCamera)return;
   // Page bytes are already accepted. Keep the submitted image stable until its
   // explicit readback completes; the next render selects/uploads those bytes.
   if(capturePending){captureStreamingDeferrals++;return;}
   // A complete cut is reselected for the latest camera; CPU arrival alone
   // never authorizes replacing any region's GPU fallback.
   backend.render(lastCamera);
  },
  async flush(){
   await Promise.resolve();
   await ensureBootstrap();
   await pending;
   if(coverageBudgetEvent){engineDiagnostic('coverage-budget','Admission de la coupe demandée',coverageBudgetEvent);coverageBudgetEvent=undefined;}
   await gpuTiming?.flush();
   for(const sample of gpuTiming?.drain()??[]){const phase=sample.error?'gpu-timing-unavailable':'gpu-timing';engineDiagnostic(phase,sample.error?'Mesure GPU indisponible':'Durées GPU mesurées par passe',sample);if(traceEnabled)traceDiagnostic(phase,sample.error?'Mesure GPU indisponible':'Durées GPU mesurées par passe',()=>({backend:'webgpu-page-raster',submission:sample.submission??null,scope:'render-passes-only',...sample,frame:sample.frame}));}
   if(!traceEnabled&&cpuSample&&frame!==lastCpuLogFrame&&performance.now()-lastProgressMs>=2000){lastCpuLogFrame=frame;engineDiagnostic('cpu-timing','Durées CPU mesurées dans le moteur',cpuSample);}
   if(performance.now()-lastProgressMs>=2000){lastProgressMs=performance.now();engineDiagnostic('render-progress','Suivi du rendu GPU',{frame,coverage:{version:1,ready:bootstrapReady,bootstrapPages:bootstrap.length,budgetLimited:coverageBudgetLimited},lights:lightState,selectedPages:shown.length,residentPages:drawn.length,selectedTriangles,submittedTriangles,transparent:{version:1,candidates:blendGpu.length,visibleMeshes:visibleBlend.length,frustumRejected:blendFrustumRejected,drawCalls:blendDrawCalls,submittedTriangles:blendSubmittedTriangles,gpuMs:null},pendingPages:collectPendingUrls(desired,pendingScratch).length,surfaceVersion:surfaces?.version??null,presentation:context.gpuCanvas?'direct':'composed',imageReadbackDuringRender:false});}
   if(gpuSelection){
    try{await gpuSelection.flush();if(gpuSelection.failed())dropGpuSelection();}
    catch(error){diagnosticFailure('gpu-selection-fallback',error);dropGpuSelection();}
   }
   if(gpuDevice&&colorTexture&&!secondaryCamera&&imageRevision>0&&capturedRevision!==imageRevision){
    if(!capturePending){const revision=imageRevision,[width,height]=targetSize,texture=colorTexture;
     checkFrameBudget(width,height,captureAllocationBytes+Math.ceil(width*4/256)*256*height);
     capturePending=readGpuImage(gpuDevice,texture,width,height,context.signal).then(pixels=>{if(!lost&&revision===imageRevision){capturedPixels=pixels;capturedRevision=revision;if(!outputDiagnosticLogged){outputDiagnosticLogged=true;engineDiagnostic('first-readback','Premier relevé explicite de la cible WebGPU',{width,height,origin:'bottom-left',...outputColorDiagnostic(pixels,width,height,clearColor,'bottom-left')});engineDiagnostic('presentation-capture','Capture explicite du rendu WebGPU',{width,height,origin:'bottom-left',imageRevision:revision,surface:'webgpu-color-target',...outputColorDiagnostic(pixels,width,height,clearColor,'bottom-left')});}}}).finally(()=>{capturePending=undefined;});
    }
    await capturePending;
    if(lost)throw new Error('WEBGPU_LOST');
    if(capturedRevision!==imageRevision)throw new Error('CAPTURE_CHANGED_DURING_FLUSH');
    if(captureStreamingDeferrals&&!captureDeferralLogged){captureDeferralLogged=true;engineDiagnostic('capture-streaming-deferred','Mise à jour du streaming reportée au rendu suivant pendant la capture',{imageRevision:capturedRevision,deferredUpdates:captureStreamingDeferrals,pagesRetained:true});}
   }
   await Promise.resolve();
  },
  async captureSurfaceView(camera,options){
   context.signal?.throwIfAborted();options.signal?.throwIfAborted();
   if(secondaryCamera||surfaceCapture)throw new Error('SURFACE_CAPTURE_BUSY: dispose the previous capture first');
   if(lost||!gpuDevice||!visEnabled||!lastCamera)throw new Error('SURFACE_CAPTURE_UNAVAILABLE');
   const reserve=checkSurfaceSize(gpuDevice,options.width,options.height,frameBudget,32);
   checkFrameBudget(viewport[0],viewport[1],reserve);checkFrameBudget(options.width,options.height,reserve);
   const main=lastCamera,savedSize:[number,number]=[viewport[0],viewport[1]],savedDiagnostic=diagnostic,savedMotion={...motion};
   const view=camera.clone();view.aspect=options.width/options.height;view.updateProjectionMatrix();view.updateMatrixWorld();
   const started=performance.now();let result:SurfaceCapture|undefined;
   secondaryCamera=view;captureAllocationBytes=reserve;
   const renderInternal=(camera:THREE.PerspectiveCamera)=>{surfaceRenderAllowed=true;try{backend.render(camera);}finally{surfaceRenderAllowed=false;}};
   const clearHistory=()=>{previouslyDrawnUrls.clear();temporalHizState.pyramid=undefined;temporalHizState.camera=undefined;temporalHizState.viewport=undefined;};
   engineDiagnostic('surface-capture-start','Capture GPU depuis une seconde caméra',{width:options.width,height:options.height,allocationBytes:reserve});
   try{
    await pending;await gpuDevice.queue.onSubmittedWorkDone();options.signal?.throwIfAborted();context.signal?.throwIfAborted();
    viewport[0]=options.width;viewport[1]=options.height;diagnostic='beauty';clearHistory();motion.last=undefined;motion.lastMs=undefined;
    renderInternal(view);await pending;
    const missing=collectPendingUrls(desired,[]);
    if(missing.length)throw new Error(`SURFACE_PAGES_NOT_RESIDENT: ${missing.length}`);
    if(coverageBudgetLimited)throw new Error('SURFACE_PAGE_BUDGET');
    await ensureResident(shown,frame,++residencyJob);
    if(shown.some(page=>!cache?.get(page.url)))throw new Error('SURFACE_GPU_COVERAGE_INCOMPLETE');drawn=shown.slice();
    if(drawn.length!==shown.length)throw new Error('SURFACE_GPU_COVERAGE_INCOMPLETE');
    options.signal?.throwIfAborted();context.signal?.throwIfAborted();
    submittedTriangles=encodeDraws(gpuDevice,view);
    if(!visEnabled||!surfaces||!depthTexture)throw new Error('SURFACE_CAPTURE_UNAVAILABLE');
    const owned=createSurfaceBuffer(gpuDevice,options.width,options.height,reserve);
    let depth:GPUTexture;
    try{depth=gpuDevice.createTexture({label:'WG owned surface depth',size:{width:options.width,height:options.height},format:'depth32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});}catch(error){owned.dispose();throw error;}
    let released=false;
    result={...owned,allocationBytes:reserve,depth,inverseViewProjection:viewProj.clone().invert().elements.slice(),cameraWorld:view.getWorldPosition(new THREE.Vector3()).toArray() as [number,number,number],selectedTriangles,
     dispose(){if(released)return;released=true;owned.dispose();depth.destroy();captureAllocationBytes=0;surfaceCapture=undefined;engineDiagnostic('surface-capture-released','Capture GPU libérée',{allocationBytes:reserve});}};
    const encoder=gpuDevice.createCommandEncoder();
    const from=[surfaces.baseMetal,surfaces.normalRough,surfaces.emissiveAo,surfaces.flags,depthTexture],to=[owned.baseMetal,owned.normalRough,owned.emissiveAo,owned.flags,depth];
    for(let i=0;i<from.length;i++)encoder.copyTextureToTexture({texture:from[i]},{texture:to[i]},[options.width,options.height]);
    gpuDevice.queue.submit([encoder.finish()]);await gpuDevice.queue.onSubmittedWorkDone();
    options.signal?.throwIfAborted();context.signal?.throwIfAborted();if(lost)throw new Error('WEBGPU_LOST');
    surfaceCapture=result;
    engineDiagnostic('surface-capture-ready','Surface GPU disponible',{surfaceVersion:1,width:options.width,height:options.height,selectedTriangles,allocationBytes:reserve,durationMs:performance.now()-started,imageReadback:false});
   }catch(error){result?.dispose();captureAllocationBytes=0;diagnosticFailure('surface-capture-failed',error);throw error;}
   finally{
    viewport[0]=savedSize[0];viewport[1]=savedSize[1];diagnostic=savedDiagnostic;clearHistory();Object.assign(motion,savedMotion);
    try{
     if(!lost&&!context.signal?.aborted){
      renderInternal(main);await pending;await ensureResident(shown,frame,++residencyJob);if(shown.some(page=>!cache?.get(page.url)))throw new Error('SURFACE_GPU_COVERAGE_INCOMPLETE');drawn=shown.slice();submittedTriangles=encodeDraws(gpuDevice,main);
      if(presenter&&colorTexture){const encoder=gpuDevice.createCommandEncoder();presenter.present(encoder,colorTexture,...targetSize);gpuDevice.queue.submit([encoder.finish()]);}
      if(canvasTexture)canvasTexture.needsUpdate=true;
      engineDiagnostic('surface-main-restored','Vue principale restaurée',{width:savedSize[0],height:savedSize[1]});
     }
    }catch(error){result?.dispose();diagnosticFailure('surface-restore-failed',error);throw error;}
    finally{secondaryCamera=undefined;surfaceRenderAllowed=false;}
   }

   return result!;
  },
  capture(){
   if(lost)throw new Error('WEBGPU_LOST');
   if(capturedPixels&&capturedRevision===imageRevision)return capturedPixels;
   if(!presenter||!gpuDevice||!colorTexture||secondaryCamera)throw new Error('CAPTURE_NOT_READY: render then await flush before capture');
   const encoder=gpuDevice.createCommandEncoder();presenter.present(encoder,colorTexture,...targetSize);gpuDevice.queue.submit([encoder.finish()]);
   if(!synchronousCapture){synchronousCapture=createSynchronousCanvasCapture();engineDiagnostic('capture-synchronous','Lecture synchrone demandée par l’hôte',{outsideBeauty:true,prefer:'await flush(); capture()'});}
   capturedPixels=synchronousCapture.read(presenter.canvas);capturedRevision=imageRevision;return capturedPixels;
  },
  selectedPageIds(){return shown.map(rec=>rec.url);},
  visibilityIds(){
   const size=viewport??targetSize,pages=drawn.filter(rec=>rec.array&&!rec.transparent).map(rec=>({...rec,array:rec.array!}));
   return rasterVisibilityIds(pages,lastCamera??new THREE.PerspectiveCamera(),size);
  },
  rasterRgba(){
   const size=viewport??targetSize,pages=drawn.filter(rec=>rec.array&&!rec.transparent).map(rec=>({...rec,array:rec.array!})),cam=lastCamera??new THREE.PerspectiveCamera();
   return shadeVisibility(rasterVisibilityIds(pages,cam,size),pages,cam,size,clearColor);
  },
  pendingUrls(){return collectPendingUrls(!bootstrapReady?bootstrap:coverageBudgetLimited?[]:desired,pendingScratch);},
  pageUrls(){urlScratch.length=0;const seen=new Set<string>();for(const list of [bootstrap,shown,coverageBudgetLimited?[]:desired])for(let i=0;i<list.length;i++){const url=list[i].url;if(seen.has(url))continue;seen.add(url);urlScratch.push(url);}return urlScratch;},
  acceptPage(url,array){deferredDrops.delete(url);const recs=byUrl.get(url);if(!recs)return;for(let i=0;i<recs.length;i++){recs[i].array=array;recs[i].indexBytes=array.byteLength;}sourceBytes.set(url,new Uint8Array(array.buffer,array.byteOffset,array.byteLength));traceDiagnostic('page-accepted','Page CPU acceptée pour résidence GPU',{frame,url,bytes:array.byteLength,bootstrap:bootstrapUrls.has(url),wanted:residencyWanted.has(url),pinned:pins.has(url)});},
  dropPage(url){if(bootstrapUrls.has(url)){traceDiagnostic('page-drop-deferred','Abandon de page bootstrap ignoré pour préserver la couverture',{frame,url,reason:'bootstrap-pinned'});return;}if(pins.has(url)||residencyWanted.has(url)){deferredDrops.add(url);traceDiagnostic('page-drop-deferred','Abandon de page différé pendant la transition de couverture',{frame,url,reason:pins.has(url)?'pinned':'wanted',pinned:pins.has(url),wanted:residencyWanted.has(url),deferred:[...deferredDrops]});return;}deferredDrops.delete(url);const recs=byUrl.get(url);if(!recs)return;for(let i=0;i<recs.length;i++){recs[i].array=undefined;recs[i].indexBytes=recs[i].triangles*12;}sourceBytes.delete(url);cache?.unload?.(url);pins.delete(url);traceDiagnostic('page-dropped','Page CPU/GPU libérée',{frame,url,reason:'host-request',deferred:false});},
  metrics(){
   const stats=cache?.stats();
   let vertexBytes=0;for(const buffer of positionBuffers.values())vertexBytes+=buffer.size;
   vertexBytes+=(concatPos?.size??0)+(concatUv?.size??0)+(concatNrm?.size??0);
   for(const item of blendGpu)vertexBytes+=item.index.size+(item.uv?.size??0)+(item.normal?.size??0);

   return {coverageReady:bootstrapReady,coverageBudgetLimited,clusters:visible,selectedTriangles,residentPages:drawn.length,pageEvictions:stats?.evictions??0,geometryAllocationBytes:(stats?.allocatedBytes??0)+vertexBytes,frustumRejected,lodLevel,submittedTriangles,transparentMeshes:visibleBlend.length,transparentFrustumRejected:blendFrustumRejected,transparentDrawCalls:blendDrawCalls,transparentSubmittedTriangles:blendSubmittedTriangles,hizRejected:visEnabled?hizRejected:null,cpuSubmitMs:lastSubmitMs,vramBytes:null,drawCalls:gpuDrawCalls};
  },
  dispose(){
   gpuDevice?.removeEventListener?.('uncapturederror',onGpuError);
   lost=true;pending=pending.catch(()=>{});gpuTiming?.dispose();dropGpuSelection();dropVis();
   visTexture?.destroy();visTexture=undefined;visView=undefined;
   for(const buffer of positionBuffers.values())buffer.destroy();
   for(const item of blendGpu){item.index.destroy();item.uv?.destroy();item.normal?.destroy();}blendGpu.length=0;
   pagedBlendGpu.clear();pagedBlendCopies.clear();blendCuts.clear();blendDrawnPages.length=0;visibleBlend.length=0;
   uniformBuffer?.destroy();uniformBuffer=undefined;
   colorTexture?.destroy();depthTexture?.destroy();hdrTexture?.destroy();surfaces?.dispose();surfaceCapture?.dispose();deferred?.dispose();lights?.dispose();presenter?.dispose();synchronousCapture?.dispose();
   canvasTexture?.dispose();blitMaterial?.dispose();blit?.geometry.dispose();
   const closing=cache?.dispose();cache=undefined;scene.clear();
   drainTraceNow();
   const traceClosing=Promise.resolve();
   return Promise.all([Promise.resolve(closing),traceClosing]).then(()=>{});
  },
 };
 return backend;
};
