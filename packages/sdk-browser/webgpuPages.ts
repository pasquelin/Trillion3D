import {createSurfaceBuffer,checkSurfaceSize,frameTargetBytes,SURFACE_FORMATS,type SurfaceBuffer,type SurfaceCapture} from './surfaceBuffer.ts';
import {createSceneLightBuffer,SCENE_LIGHTING_WGSL} from './sceneLighting.ts';
import {createDeferredLighting} from './deferredLighting.ts';
import {createGpuPresenter,readGpuImage,createSynchronousCanvasCapture} from './gpuPresentation.ts';
import {STANDARD_LIGHTING_WGSL,NORMAL_TRANSFORM_WGSL} from './standardLighting.ts';
import {generateMaterialMips} from './textureMips.ts';
import {createGpuSmallTriangles,type GpuSmallTriangles} from './gpuSmallTriangles.ts';
import {createGpuTiming} from './gpuTiming.ts';
import {createCpuStepProfile} from './cpuProfile.ts';
import type {BackendCapabilities,BackendFactory,RenderBackend} from './backendTypes.ts';
import {createGpuPageCache} from './gpuPages.ts';
import {acceptPageArray,collectClusterPages,collectPendingUrls,indexPagesByUrl,pageRequestUrl,resolvePixelError,selectVisiblePages,rootCoverage,type PageRec} from './pageSelection.ts';
import {cameraSelectionUniforms,sameSelectionUniforms,type GpuSelection,type SelectionUniforms} from './gpuSelection.ts';
import {createGpuDagSelection,packDagSelection} from './gpuDagSelection.ts';
import {OPEN_CONE,triangleCone} from './pageCone.ts';
import {RASTER_BACKGROUND} from './pageRaster.ts';
import {HIZ_BOUNDS_VALUES,applyTemporalHiz,createBoxCorners,projectBoxesFlat,sameHizView,splitOccludersFlat,type TemporalHizState} from './hiz.ts';
import {createGpuHiz,type GpuHiz} from './gpuHiz.ts';
import {BIN_BACK,BIN_FRONT,BIN_NONE,DRAW_ITEM_U32,createGpuDraw,type GpuDraw} from './gpuDraw.ts';
import {FLAG_BACK,FLAG_DOUBLE,FLAG_HAS_MAP,FLAG_HAS_NORMAL,FLAG_HAS_TANGENT,FLAG_HAS_NORMAL_MAP,FLAG_HAS_ORM,FLAG_HAS_UV,FLAG_LIT,FLAG_MASK,FLAG_WRAP_S_REPEAT,FLAG_WRAP_T_REPEAT,PAGE_INFO_STRIDE,SHADE_SHADER,VIS_MAX_PAGES,VIS_SHADER,VIS_TRIANGLE_BITS,assertVisibilityPageTriangles,clusterHash,isTransmissive,rasterVisibilityIds,shadeVisibility,textureRgba,visMaterial} from './visibilityBuffer.ts';
import type {DiagnosticMode,GpuPassTimings} from '../sdk-core/index.ts';
import * as THREE from 'three';
/** Spread arguments overflow the call stack beyond ~100k pages; append with a loop instead. */
function appendAll<T>(target:T[],...sources:readonly (readonly T[])[]){for(const source of sources)for(let i=0;i<source.length;i++)target.push(source[i]);}

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
/** Ceiling on the screen error the GPU page budget may impose; past it the root cover is the cut. */
const MAX_BUDGET_PIXEL_ERROR=4096;

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

/** Turns a GPU page-id list into records, into an array the caller owns: no per-frame allocation. */
function shownFromGpu(pages:PageRec[],ids:readonly number[],frame:number,into:PageRec[]){
 into.length=0;let selectedTriangles=0;
 for(let i=0;i<ids.length;i++){const rec=pages[ids[i]];if(!rec)continue;rec.seen=frame;into.push(rec);selectedTriangles+=rec.triangles;}
 return selectedTriangles;
}
/** Sum of a cut's triangles, without the closure a `reduce` allocates on every frame. */
function triangleSum(pages:readonly PageRec[],transparent?:boolean){
 let total=0;
 for(let i=0;i<pages.length;i++)if(transparent===undefined||!!pages[i].transparent===transparent)total+=pages[i].triangles;
 return total;
}
/** Copies the records of `source` whose transparency matches, into an array the caller owns. */
function partitionByPass(source:readonly PageRec[],transparent:boolean,into:PageRec[]){
 into.length=0;
 for(let i=0;i<source.length;i++)if(!!source[i].transparent===transparent)into.push(source[i]);
 return into;
}

/** WebGPU raster of cluster pages. GPU frustum + per-cluster error band when compute is available;
 *  `selectVisiblePages` remains the CPU oracle and the silent fallback. */
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
 /** Screen-error floor the GPU page budget imposes on the cut; 0 when the requested detail fits. */
 let budgetPixelError=0;
 const deferredDrops=new Set<string>();
 let coverageBudgetEvent:Record<string,unknown>|undefined;
 const residencyWanted=new Set<string>(),queueSeen=new Set<string>(),residencyQueue:PageRec[]=[];
 let residencyPending=false,residencyRunning=false;
 // `byUrl` is indexed by REQUEST key: the streaming bundle when the cache publishes one, the cluster
 // object otherwise. One request therefore hands bytes to every cluster that shares it. The GPU page
 // cache below stays keyed by cluster (`rec.url`), because that is the granularity it uploads and pins.
 const byUrl=indexPagesByUrl(allPages),pendingScratch:string[]=[],urlScratch:string[]=[],readyScratch:PageRec[]=[];
 const bundledPages=allPages.some(page=>page.streamUrl!==undefined);
 const requestUrlByPage=bundledPages?new Map(allPages.map(page=>[page.url,pageRequestUrl(page)] as const)):undefined;
 const cap=maxResidentPages??Math.max(1024,prepared);
 const uniquePages=Math.max(1,new Set(allPages.map(page=>page.url)).size);
 const slots=Math.max(1,Math.min(cap,uniquePages));
 const scene=new THREE.Scene();lighting(scene,clearColor);for(const copy of blendCopies)scene.add(copy);
 let pageBytes=4;for(const page of allPages){const n=page.array?.byteLength??page.indexBytes;const padded=n+(n%4?4-n%4:0);if(padded>pageBytes)pageBytes=padded;}
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
 let lost=false,overBudget=false,visible=0,selectedTriangles=0,submittedTriangles=0,frustumRejected=0,lodLevel=0,frame=0;
 let diagnostic:DiagnosticMode='beauty';
 const motion:{last?:THREE.Vector3;lastMs?:number}={};
 let pending:Promise<unknown>=Promise.resolve(),shown:PageRec[]=[],desired:PageRec[]=[],drawn:PageRec[]=[],targetSize:[number,number]=[viewport?.[0]??1,viewport?.[1]??1];
 let gpuSelection:GpuSelection|undefined;
 const opaqueRoots=roots.filter(root=>!root.pages[0]?.transparent),transparentRoots=roots.filter(root=>root.pages[0]?.transparent);
 const packedPages:PageRec[]=opaqueRoots.flatMap(root=>root.pages);
 const worldUpdates=new Float32Array(opaqueRoots.length*16);
 const residentFlags=new Uint32Array(packedPages.length);
 // One cluster key can back several placements, so a residency change names every page sharing it.
 const pageIndicesByUrl=new Map<string,number[]>();
 for(let i=0;i<packedPages.length;i++){
  const list=pageIndicesByUrl.get(packedPages[i].url);
  if(list)list.push(i);else pageIndicesByUrl.set(packedPages[i].url,[i]);
 }
 const pageIndexByRec=new Map<PageRec,number>();
 for(let i=0;i<packedPages.length;i++)pageIndexByRec.set(packedPages[i],i);
 // The occluder half of an image is reused as the next image's first pass, and it is keyed by cluster
 // key: a key backing several placements occludes for all of them. A dense index per key replaces the
 // set of strings the drawing path used to hash once per page per image.
 const urlIndexOfPage=new Int32Array(packedPages.length);
 let urlCount=0;
 {
  const dense=new Map<string,number>();
  for(let i=0;i<packedPages.length;i++){
   const url=packedPages[i].url;
   let index=dense.get(url);
   if(index===undefined){index=urlCount++;dense.set(url,index);}
   urlIndexOfPage[i]=index;
  }
 }
 const drawnOccluderUrls=new Uint8Array(Math.max(1,urlCount));
 let noOccluderHistory=true;
 const gpuWanted:PageRec[]=bootstrap.filter(page=>!page.transparent);
 // Reused by `renderGpuCut`; the cut changes every frame, the arrays and sets behind it do not.
 const opaqueScratch:PageRec[]=[],transparentScratch:PageRec[]=[],drawableScratch:PageRec[]=[];
 const requestedScratch=new Set<string>(),transitionScratch=new Set<string>();
 const keepScratch=new Set<string>();
 const copiesByUrl=new Map<string,number>();let maxCopies=1;
 for(const page of packedPages){const n=(copiesByUrl.get(page.url)??0)+1;copiesByUrl.set(page.url,n);maxCopies=Math.max(maxCopies,n);}
 // Visibility IDs reserve 24 bits for row+1 (zero means background) and 8 for the triangle.
 const drawSlots=Math.max(1,Math.min(VIS_MAX_PAGES,packedPages.length,slots*maxCopies));
 /** Every triangle of every drawable row: the bound the small-triangle list can never exceed. */
 const smallTriangleCapacity=drawSlots*Math.ceil(Math.max(1,pageBytes/4)/3);
 /**
  * A page-table row is the rank of a cluster in the drawable set, in catalogue order. A row therefore
  * never outlives its occupant: an arrival or an eviction moves the rows it shifts, instead of handing a
  * newcomer a row another cluster still describes. That also keeps the visibility identifier — the row
  * plus one — a function of the drawable set alone, which is what makes the image reproducible from one
  * process to the next. What the frame no longer pays for is the table itself: a settled drawable set
  * writes and uploads nothing at all, and an admission moves the ranks it displaces rather than
  * rebuilding them.
  */
 const residentOffsetWords=new Int32Array(packedPages.length).fill(-1);
 /** What each row currently describes: its occupant, the slot offset written, and the input epoch. */
 const rowPageIndex=new Int32Array(drawSlots).fill(-1),rowOffsetWords=new Int32Array(drawSlots).fill(-1),rowEpoch=new Int32Array(drawSlots);
 /** Catalogue index of the page each drawn row carries, for the occluder history of the next image. */
 const packedPageIndex=new Int32Array(drawSlots);
 /**
  * The rank an image gives each page, and where the previous image had already written that page.
  * A page admitted in the middle of the catalogue shifts every following rank by one, and the bytes of
  * a shifted row are the bytes of the row it comes from except for the two words that are the rank
  * itself — so the frame moves ranges instead of rebuilding rows, and the ranks stay the baseline's.
  */
 const newRowPage=new Int32Array(drawSlots),newRowSource=new Int32Array(drawSlots);
 /** The two words of a row that are its rank and nothing else: the visibility identifier base and the Hi-Z slot. */
 const ROW_ID_BASE_WORD=27,ROW_HIZ_SLOT_WORD=31;
 const rowOfPage=new Int32Array(packedPages.length).fill(-1);
 const rowRewrites=new Int32Array(drawSlots);
 let rowCount=0,tableEpoch=1;
 /**
  * Resident cluster keys the change journal has accounted for but the row table never carries — the
  * transparent ones. The mirror's own count cannot be checked against the cache's, which counts those
  * too; what has to hold is that the journal saw every change, so that is what is compared.
  */
 const residentOutsideTable=new Set<string>();
 let journalResident=0;
 const residencyKeys:string[]=[],residencySlots:number[]=[];
 /** The rows changed since the last upload, as one span: ranks shift upward, never scatter. */
 let dirtyFrom=drawSlots,dirtyTo=-1;
 const markRowDirty=(row:number)=>{if(row<dirtyFrom)dirtyFrom=row;if(row>dirtyTo)dirtyTo=row;};
 let candidateCount=0,candidateOverflow=0;
 // Frame scratch, one entry per row the frame can draw. Sized once, never reallocated.
 const packedRecs:Array<PageRec|undefined>=new Array(drawSlots).fill(undefined);
 const packedPositions:Array<GPUBuffer|undefined>=new Array(drawSlots).fill(undefined);
 /** Vertex buffer of each page, by page index. Built once with the buffers, so a frame looks up nothing. */
 const pagePositions:Array<GPUBuffer|undefined>=new Array(packedPages.length).fill(undefined);
 let packedCount=0,rowsChanged=true;
 /**
  * World-space corners of every page's box, kept across images and rebuilt only when the epoch of the
  * shared inputs changes — the same epoch a row is rewritten on. A moving camera reprojects them every
  * image; it no longer retransforms them.
  */
 const boxCorners=createBoxCorners(packedPages.length);
 const hizBounds=new Float64Array(drawSlots*HIZ_BOUNDS_VALUES);
 const hizTestedBounds=new Float64Array(drawSlots*HIZ_BOUNDS_VALUES);
 const hizTestedRows=new Uint32Array(drawSlots);
 const hizRest=new Uint8Array(drawSlots);
 const drawItemWords=new Uint32Array(drawSlots*DRAW_ITEM_U32);
 const drawRestBits=new Uint32Array(Math.max(1,Math.ceil(drawSlots/32)));
 let pageTableFloats:Float32Array|undefined,pageTableInts:Uint32Array|undefined;
 let gpuFrameActive=false,gpuMetricsReady=false;
 const selectionUniforms:SelectionUniforms={planes:new Float32Array(24),view:new Float32Array(16),pixelScale:[1,1],pixelError:0,near:0.1,cameraWorld:[0,0,0]};
 const untexturedMaterials='Untextured source color; double-sided when the material is';
 const visFeatures=['visibility buffer','textured PBR maps','occlusion culling','temporal occlusion culling'];
 const capabilities:BackendCapabilities={renderer:'WebGPU page raster',materials:untexturedMaterials,hierarchy:true,gpuDriven:false,simplification:false,eviction:true,unsupported:['material extensions, skinning and morph targets in WebGPU','per-texture transforms, UV channels and sampler modes','environment maps, light shadows, area lights and light probes','indirect draw','occlusion culling','temporal occlusion culling','small-triangle compute raster','physical VRAM instrumentation','global illumination, surface cache and motion vectors','textured PBR maps','visibility buffer','direct WebGPU present']};
 const dropGpuSelection=()=>{gpuSelection?.dispose();gpuSelection=undefined;capabilities.gpuDriven=false;};
 let visEnabled=false,visTexture:GPUTexture|undefined,visView:GPUTextureView|undefined;
 let visPipelineBack:GPURenderPipeline|undefined,visPipelineBackCw:GPURenderPipeline|undefined,visPipelineNone:GPURenderPipeline|undefined,visPipelineFront:GPURenderPipeline|undefined,visPipelineFrontCw:GPURenderPipeline|undefined,shadePipeline:GPURenderPipeline|undefined;
 let gpuHiz:GpuHiz|undefined;
 let gpuSmall:GpuSmallTriangles|undefined,hybridUnavailable=false;
 let visHizRestBack:GPURenderPipeline|undefined,visHizRestBackCw:GPURenderPipeline|undefined,visHizRestNone:GPURenderPipeline|undefined,visHizRestFront:GPURenderPipeline|undefined,visHizRestFrontCw:GPURenderPipeline|undefined;
 let visBindGroupLayout:GPUBindGroupLayout|undefined,visBindGroup:GPUBindGroup|undefined,visHizBindGroup:GPUBindGroup|undefined,visUniform:GPUBuffer|undefined,zeroFlags:GPUBuffer|undefined,zeroUv:GPUBuffer|undefined,blendBindGroupLayout:GPUBindGroupLayout|undefined;
 let gpuDraw:GpuDraw|undefined;
 let shadeBindGroupLayout:GPUBindGroupLayout|undefined,shadeBindGroup:GPUBindGroup|undefined;
 // Six raster slots × tested-or-not, and the small-triangle groups by flag source × selection:
 // both sets are built from buffers that outlive the frame, so a frame never rebuilds a bind group.
 const visSlotGroups:Array<GPUBindGroup|undefined>=new Array(12).fill(undefined);
 const smallGroups:Array<unknown>=new Array(8).fill(undefined);
 let concatPos:GPUBuffer|undefined,concatUv:GPUBuffer|undefined,concatNrm:GPUBuffer|undefined,pageTable:GPUBuffer|undefined,shadeUniform:GPUBuffer|undefined,mapsTexture:GPUTexture|undefined,dataMapsTexture:GPUTexture|undefined,mapsSampler:GPUSampler|undefined,materialScales:GPUBuffer|undefined;
 let mapsArrayView:GPUTextureView|undefined,dataMapsArrayView:GPUTextureView|undefined;
 const inverseViewProj=new THREE.Matrix4(),cameraWorldScratch=new THREE.Vector3(),cameraWorldArray:[number,number,number]=[0,0,0];
 const shadeUniPacked=new Float32Array(64),visUniPacked=new Float32Array(7*64),geometryBlocks=new Map<THREE.BufferGeometry['attributes'],{vertexBase:number;count:number;hasUv:boolean;hasNormal:boolean;hasTangent:boolean}>(),mapLayer=new Map<THREE.Texture,number>(),dataLayer=new Map<THREE.Texture,number>();
 const uvScales:Array<[number,number]>=[[1,1]],dataUvScales:Array<[number,number]>=[[1,1]];
 const textureJobs:Array<{kind:'color'|'data';layer:number;bytes:number;upload:()=>void}>=[];
 const textureBudget=Math.max(1,Number.isFinite(context.maxTextureTransferBytesPerFrame)?context.maxTextureTransferBytesPerFrame!:16*1024*1024);
 let texturePump:Promise<void>|undefined,textureColorSize:[number,number]=[1,1],textureDataSize:[number,number]=[1,1],textureSkipped=0,textureUploaded=0;
 const pumpTextures=()=>{
  if(texturePump||!textureJobs.length||!gpuDevice)return texturePump??Promise.resolve();
  const run=async()=>{
   let admitted=0;const colorLayers:number[]=[],dataLayers:number[]=[];
   while(textureJobs.length&&admitted+textureJobs[0].bytes<=textureBudget){
    const job=textureJobs.shift()!;
    try{job.upload();admitted+=job.bytes;textureUploaded++;(job.kind==='color'?colorLayers:dataLayers).push(job.layer);}
    catch(error){textureSkipped++;diagnosticFailure('progressive-texture-upload-failed',error);}
   }
   if(textureJobs.length&&textureJobs[0].bytes>textureBudget){textureJobs.shift();textureSkipped++;}
   if(colorLayers.length&&mapsTexture)await generateMaterialMips(gpuDevice!,mapsTexture,'rgba8unorm-srgb',...textureColorSize,uvScales,colorLayers);
   if(dataLayers.length&&dataMapsTexture)await generateMaterialMips(gpuDevice!,dataMapsTexture,'rgba8unorm',...textureDataSize,dataUvScales,dataLayers);
  };
  texturePump=run().finally(()=>{texturePump=undefined;});return texturePump;
 };
 const temporalHizState:TemporalHizState={};
 let previousHizView:THREE.PerspectiveCamera|undefined;
 let lastSubmitMs:number|null=null;
 let gpuTiming:ReturnType<typeof createGpuTiming>|undefined,lastGpuPassMs:GpuPassTimings|null=null,lastGpuFrameMs:number|null=null;
 /** True only while the image being encoded dispatches selection, so its pass joins that image's sample. */
 let selectionInImage=false;
 // Encode-side step durations of the current image, reported by the `cpu-timing` diagnostic.
 let lastProjectMs=0,lastPartitionMs=0,lastItemsMs=0,rowsSyncedFrame=-1;
 const CPU_STEPS=['adoptCutMs','transparentSelectMs','admissionMs','residencyQueueMs','syncRowsMs','residencyUploadMs','selectionDispatchMs','projectBoxesMs','partitionMs','itemsMs','encodeRestMs','encodeSubmitMs','totalMs'] as const;
 const cpuProfile=createCpuStepProfile(CPU_STEPS);
 let lastCpuLogMs=0;
 /**
  * Publishes where the image's CPU time went, on the cadence of the progress diagnostic. It is called
  * by both render paths: a measured loop renders without ever flushing, and the profile is exactly what
  * such a loop needs.
  */
 const publishCpuProfile=()=>{
  if(traceEnabled||!cpuSample||frame===lastCpuLogFrame)return;
  const now=performance.now();
  if(now-lastCpuLogMs<2000)return;
  lastCpuLogMs=now;lastCpuLogFrame=frame;
  engineDiagnostic('cpu-timing','Durées CPU mesurées dans le moteur',{...cpuSample,steps:cpuProfile.summary()});
 };
 let cpuSample:Record<string,unknown>|undefined,transparentEncodeMs=0,lastCpuLogFrame=-1;
 let residencyJob=0;
 const cameraPose=(camera:THREE.PerspectiveCamera)=>({position:camera.getWorldPosition(new THREE.Vector3()).toArray(),quaternion:camera.getWorldQuaternion(new THREE.Quaternion()).toArray()});
 const createRenderEncoder=(device:GPUDevice)=>gpuTiming&&!secondaryCamera?gpuTiming.createEncoder(frame):device.createCommandEncoder();
 const dropGpuHiz=()=>{
  gpuHiz?.dispose();gpuHiz=undefined;visHizBindGroup=undefined;
  visHizRestBack=undefined;visHizRestBackCw=undefined;visHizRestNone=undefined;visHizRestFront=undefined;visHizRestFrontCw=undefined;
  noOccluderHistory=true;previousHizView=undefined;
  temporalHizState.pyramid=undefined;temporalHizState.camera=undefined;temporalHizState.viewport=undefined;
 };
 const dropGpuDraw=()=>{
  gpuDraw?.dispose();gpuDraw=undefined;
  if(!capabilities.unsupported.includes('indirect draw'))capabilities.unsupported.push('indirect draw');
 };
 const dropVis=()=>{
  visEnabled=false;visPipelineBack=undefined;visPipelineBackCw=undefined;visPipelineNone=undefined;visPipelineFront=undefined;visPipelineFrontCw=undefined;shadePipeline=undefined;shadeBindGroup=undefined;shadeBindGroupLayout=undefined;visBindGroupLayout=undefined;visBindGroup=undefined;visHizBindGroup=undefined;mapsSampler=undefined;blendBindGroupLayout=undefined;pipelineBlendTextured=undefined;
  for(const item of blendGpu)item.group=undefined;
  visSlotGroups.fill(undefined);smallGroups.fill(undefined);
  gpuSmall?.dispose();gpuSmall=undefined;
  dropGpuDraw();dropGpuHiz();
  concatPos?.destroy();concatUv?.destroy();concatNrm?.destroy();pageTable?.destroy();shadeUniform?.destroy();visUniform?.destroy();zeroFlags?.destroy();mapsTexture?.destroy();dataMapsTexture?.destroy();materialScales?.destroy();materialScales=undefined;
  visSlotGroups.fill(undefined);smallGroups.fill(undefined);
  concatPos=concatUv=concatNrm=pageTable=shadeUniform=visUniform=zeroFlags=mapsTexture=dataMapsTexture=undefined;
  mapsArrayView=undefined;dataMapsArrayView=undefined;pageTableFloats=undefined;pageTableInts=undefined;
  rowPageIndex.fill(-1);rowOffsetWords.fill(-1);rowEpoch.fill(0);
  rowCount=0;dirtyFrom=drawSlots;dirtyTo=-1;candidateCount=0;packedCount=0;rowsChanged=true;
  capabilities.materials=untexturedMaterials;
  textureJobs.length=0;
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
  gpuSmall?.dispose();gpuSmall=undefined;
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
  if(traceEnabled)traceDiagnostic('transparent-encoding','Transparents sélectionnés et encodés',()=>({frame,submission:imageRevision,candidates:blendGpu.length,visibleMeshes:visibleBlend.length,frustumRejected:blendFrustumRejected,drawCalls:blendDrawCalls,submittedTriangles:blendSubmittedTriangles,encodeMs:transparentEncodeMs,passes:visibleBlend.length?2:0}));
 };
 /** The row table spans every row a page can claim, so it is allocated once and never resized. */
 const ensurePageTable=(device:GPUDevice)=>{
  if(pageTableFloats)return;
  const bytes=Math.max(PAGE_INFO_STRIDE,drawSlots*PAGE_INFO_STRIDE);
  pageTableFloats=new Float32Array(bytes/4);pageTableInts=new Uint32Array(pageTableFloats.buffer);
  pageTable?.destroy();shadeBindGroup=undefined;visBindGroup=undefined;visHizBindGroup=undefined;visSlotGroups.fill(undefined);smallGroups.fill(undefined);
  pageTable=device.createBuffer({label:'WG page table',size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 };
 /**
  * Writes one page-table row. Called when a cluster claims a row, when its GPU slot moves, or when a
  * shared input changes epoch — never once per frame: every field below belongs to the page, its
  * material, its geometry block or its slot, none of them to the image.
  */
 const writePageRow=(rec:PageRec,pageIndex:number,row:number,offsetWords:number,index:Uint32Array)=>{
  const floats=pageTableFloats!,ints=pageTableInts!;
  const base=row*(PAGE_INFO_STRIDE/4),mat=visMaterial(rec.material),geo=geometryBlocks.get(rec.attributes);
  const layer=mat.map&&mapLayer.has(mat.map)?mapLayer.get(mat.map)!:0,scale=uvScales[layer]??[1,1];
  const roughLayer=mat.roughnessMap&&dataLayer.has(mat.roughnessMap)?dataLayer.get(mat.roughnessMap)!:0;
  const metalLayer=mat.metalnessMap&&dataLayer.has(mat.metalnessMap)?dataLayer.get(mat.metalnessMap)!:0;
  const nrmLayer=mat.normalMap&&dataLayer.has(mat.normalMap)?dataLayer.get(mat.normalMap)!:0;
  floats.set(rec.matrix.elements,base);
  floats[base+16]=mat.baseColor[0];floats[base+17]=mat.baseColor[1];floats[base+18]=mat.baseColor[2];floats[base+19]=mat.alphaTest>0?mat.alphaTest:1;
  floats[base+20]=mat.metalness;floats[base+21]=mat.roughness;
  let flags=0;if(mat.lit)flags|=FLAG_LIT;if(mat.doubleSided)flags|=FLAG_DOUBLE;if(geo?.hasUv)flags|=FLAG_HAS_UV;if(layer)flags|=FLAG_HAS_MAP;if(geo?.hasNormal)flags|=FLAG_HAS_NORMAL;if(geo?.hasTangent)flags|=FLAG_HAS_TANGENT;if(mat.alphaTest>0)flags|=FLAG_MASK;if(mat.backSide)flags|=FLAG_BACK;
  if(roughLayer||metalLayer)flags|=FLAG_HAS_ORM;if(nrmLayer)flags|=FLAG_HAS_NORMAL_MAP;
  if(mat.map&&mat.map.wrapS!==THREE.ClampToEdgeWrapping)flags|=FLAG_WRAP_S_REPEAT;
  if(mat.map&&mat.map.wrapT!==THREE.ClampToEdgeWrapping)flags|=FLAG_WRAP_T_REPEAT;
  // A page holding more triangles than the identifier's eight low bits would alias the next page.
  assertVisibilityPageTriangles(index.length/3,rec.url);
  ints[base+22]=layer;ints[base+23]=flags;ints[base+24]=offsetWords;ints[base+25]=index.length;ints[base+26]=geo?.vertexBase??0;ints[base+ROW_ID_BASE_WORD]=((row+1)<<VIS_TRIANGLE_BITS)>>>0;
  floats[base+28]=scale[0];floats[base+29]=scale[1];ints[base+30]=clusterHash(rec.clusterId);
  // The Hi-Z verdict of a row lives at the row's own index, and the rows a frame does not test are
  // cleared on the GPU before the test, so no row ever reads the verdict of an earlier image.
  ints[base+ROW_HIZ_SLOT_WORD]=row;
  ints[base+32]=roughLayer;ints[base+33]=metalLayer;ints[base+34]=nrmLayer;floats[base+35]=mat.normalScale;
  const roughScale=dataUvScales[roughLayer]??[1,1],metalScale=dataUvScales[metalLayer]??[1,1],nrmScale=dataUvScales[nrmLayer]??[1,1];
  floats[base+36]=roughScale[0];floats[base+37]=roughScale[1];floats[base+38]=metalScale[0];floats[base+39]=metalScale[1];
  floats[base+40]=nrmScale[0];floats[base+41]=nrmScale[1];
  const aoLayer=mat.aoMap?dataLayer.get(mat.aoMap)??0:0,emissiveLayer=mat.emissiveMap?mapLayer.get(mat.emissiveMap)??0:0;
  const aoScale=dataUvScales[aoLayer]??[1,1],emissiveScale=uvScales[emissiveLayer]??[1,1];
  ints[base+42]=aoLayer;floats[base+43]=mat.aoIntensity;
  floats[base+44]=aoScale[0];floats[base+45]=aoScale[1];ints[base+46]=emissiveLayer;ints[base+47]=pageIndex;
  floats.set(mat.emissive,base+48);floats[base+52]=emissiveScale[0];floats[base+53]=emissiveScale[1];floats[base+54]=mat.normalScaleY;
  markRowDirty(row);
 };
 /**
  * Applies the cache's arrivals and departures to the residency mirror. The mirror is the only
  * incremental state on this path, so the journal that feeds it is checked against the cache on every
  * drain: the journal's own resident count — every key it saw, rowed or not — must equal the cache's.
  * A disagreement means an entry moved without a record, and the mirror is rebuilt from the cache
  * instead of being left to drift into a hole.
  */
 const syncResidencyMirror=()=>{
  if(!cache)return;
  residencyKeys.length=0;residencySlots.length=0;
  cache.drainResidencyChanges(residencyKeys,residencySlots);
  for(let c=0;c<residencyKeys.length;c++){
   const key=residencyKeys[c],offsetWords=residencySlots[c],pages=pageIndicesByUrl.get(key);
   const was=pages?residentOffsetWords[pages[0]]>=0:residentOutsideTable.has(key);
   if(offsetWords>=0&&!was)journalResident++;else if(offsetWords<0&&was)journalResident--;
   if(!pages){if(offsetWords>=0)residentOutsideTable.add(key);else residentOutsideTable.delete(key);continue;}
   for(let i=0;i<pages.length;i++)residentOffsetWords[pages[i]]=offsetWords;
  }
  const resident=cache.stats().residentPages;
  if(journalResident===resident)return;
  engineDiagnostic('gpu-residency-mirror-rebuilt','Miroir de résidence reconstruit depuis le cache',{frame,journal:journalResident,resident});
  journalResident=0;residentOutsideTable.clear();
  for(let c=0;c<pageCatalog.length;c++){
   const url=pageCatalog[c],page=cache.get(url),pages=pageIndicesByUrl.get(url);
   if(page)journalResident++;
   if(!pages){if(page)residentOutsideTable.add(url);continue;}
   const offsetWords=page?page.offset/4:-1;
   for(let i=0;i<pages.length;i++)residentOffsetWords[pages[i]]=offsetWords;
  }
 };
 /**
  * Turns the ranks an image just decided into table rows. A row whose occupant kept its slot and epoch
  * is not rebuilt: it is moved. Ranks only ever shift as a block — one admission pushes every later
  * rank up by one — so `newRowSource` describes runs of constant displacement, and the whole run travels
  * in one `copyWithin`, followed by the two words of each row that *are* the rank. What remains to
  * build word by word is one row per page that arrived, changed GPU slot, or lost its epoch.
  *
  * The displacement is non-decreasing along the rows — both orders walk the pages ascending, so a
  * source row advances by at least one per row — which is what makes moving in place safe: the runs
  * that pull from below are applied from the last row down, the runs that pull from above from the
  * first row up, and neither can overwrite a source the other still has to read. A cut whose order is
  * not the catalogue's breaks that property, and `monotone` then rebuilds every row instead.
  */
 const commitRows=(count:number,monotone:boolean)=>{
  const floats=pageTableFloats!,ints=pageTableInts!,rowWords=PAGE_INFO_STRIDE/4;
  let rewrites=0,moved=0;
  /** Moves rows `[start..end]` from `[start+delta..end+delta]`, then restamps the rank each row is. */
  const move=(start:number,end:number,delta:number)=>{
   floats.copyWithin(start*rowWords,(start+delta)*rowWords,(end+delta+1)*rowWords);
   for(let row=start;row<=end;row++){const base=row*rowWords;ints[base+ROW_ID_BASE_WORD]=((row+1)<<VIS_TRIANGLE_BITS)>>>0;ints[base+ROW_HIZ_SLOT_WORD]=row;}
   markRowDirty(start);markRowDirty(end);moved+=end-start+1;
  };
  if(monotone)for(let pass=0;pass<2;pass++){
   // Runs pulling from below travel from the last row down, runs pulling from above from the first row
   // up: neither can then overwrite a source a pending run still has to read.
   const negative=pass===0;
   let start=-1,end=-1,delta=0;
   const flush=()=>{if(start>=0)move(start,end,delta);start=-1;};
   for(let step=0;step<count;step++){
    const row=negative?count-1-step:step;
    const source=newRowSource[row],d=source>=0?source-row:0;
    const keep=source>=0&&(negative?d<0:d>0);
    if(keep&&start>=0&&d===delta&&row===(negative?start-1:end+1)){if(negative)start=row;else end=row;continue;}
    flush();
    if(keep){start=row;end=row;delta=d;}
   }
   flush();
  }
  for(let row=0;row<count;row++)if(!(monotone&&newRowSource[row]>=0))rowRewrites[rewrites++]=row;
  // The rebuilds come last: a row a run still had to read cannot already hold its new occupant.
  for(let r=0;r<rewrites;r++){
   const row=rowRewrites[r],pageIndex=newRowPage[row],rec=packedRecs[row]!;
   writePageRow(rec,pageIndex,row,residentOffsetWords[pageIndex],rec.array!);
  }
  if(rewrites||moved)rowsChanged=true;
  for(let row=0;row<count;row++){
   const pageIndex=newRowPage[row];
   rowPageIndex[row]=pageIndex;rowOffsetWords[row]=residentOffsetWords[pageIndex];rowEpoch[row]=tableEpoch;
   rowOfPage[pageIndex]=row;
  }
  // A shorter drawable set leaves the rows past it unread: `tableRows` bounds every pass that walks
  // the table, so they are not cleared, only forgotten.
  if(count!==rowCount)rowsChanged=true;
  rowCount=count;packedCount=count;
 };
 /** Where the previous image wrote this page, or -1 when its row cannot be reused as it stands. */
 const sourceRowOf=(pageIndex:number,offsetWords:number)=>{
  const source=rowOfPage[pageIndex];
  if(source<0||source>=rowCount||rowPageIndex[source]!==pageIndex)return -1;
  return rowOffsetWords[source]===offsetWords&&rowEpoch[source]===tableEpoch?source:-1;
 };
 /**
  * Rows for the drawable set. `residentFlags` keeps `pageSelection`'s predicate — CPU bytes present and
  * the cluster resident — read fresh from every page, so what may be drawn is never carried over from
  * an earlier image.
  */
 const syncRows=()=>{
  if(!cache||!pageTableFloats)return;
  syncResidencyMirror();
  let count=0,candidates=0,overflow=0,lastSource=-1,monotone=true;
  for(let i=0;i<packedPages.length;i++){
   const offsetWords=residentOffsetWords[i],rec=packedPages[i],index=rec.array;
   const resident=offsetWords>=0&&!!index;
   if(residentFlags[i]!==(resident?1:0))residentFlags[i]=resident?1:0;
   if(!resident)continue;
   candidates++;
   if(rec.transparent)continue;
   const position=pagePositions[i];
   if(!position)continue;
   if(count>=drawSlots){overflow++;continue;}
   const row=count++;
   const source=sourceRowOf(i,offsetWords);
   if(source>=0){if(source<=lastSource)monotone=false;lastSource=source;}
   newRowPage[row]=i;newRowSource[row]=source;
   packedRecs[row]=rec;packedPositions[row]=position;packedPageIndex[row]=i;
  }
  commitRows(count,monotone);
  candidateCount=candidates;candidateOverflow=overflow+Math.max(0,candidates-drawSlots);
 };
 /** The CPU cut names its own pages, so its rows are its order; the cut is rebuilt every frame. */
 const syncRowsFromCut=()=>{
  if(!cache||!pageTableFloats)return;
  syncResidencyMirror();
  let count=0,lastSource=-1,monotone=true;
  for(let i=0;i<drawn.length&&count<drawSlots;i++){
   const rec=drawn[i];if(rec.transparent)continue;
   const pageIndex=pageIndexByRec.get(rec);if(pageIndex===undefined)continue;
   const offsetWords=residentOffsetWords[pageIndex],index=rec.array,position=pagePositions[pageIndex];
   if(offsetWords<0||!index||!position)continue;
   const row=count++;
   const source=sourceRowOf(pageIndex,offsetWords);
   if(source>=0){if(source<=lastSource)monotone=false;lastSource=source;}
   newRowPage[row]=pageIndex;newRowSource[row]=source;
   packedRecs[row]=rec;packedPositions[row]=position;packedPageIndex[row]=pageIndex;
  }
  commitRows(count,monotone);
 };
 /** Uploads the span of rows whose bytes changed, and nothing when none did. */
 const uploadDirtyRows=(device:GPUDevice)=>{
  if(dirtyTo<dirtyFrom||!pageTable||!pageTableFloats)return;
  device.queue.writeBuffer(pageTable,dirtyFrom*PAGE_INFO_STRIDE,pageTableFloats.buffer as ArrayBuffer,
   dirtyFrom*PAGE_INFO_STRIDE,(dirtyTo-dirtyFrom+1)*PAGE_INFO_STRIDE);
  dirtyFrom=drawSlots;dirtyTo=-1;
 };
 const submitColorCopy=(device:GPUDevice,encoder:GPUCommandEncoder,height:number,width:number,presented=false)=>{
   if(!presented&&presenter&&colorTexture&&!secondaryCamera){presenter.present(encoder,colorTexture,width,height);gpuDrawCalls++;}
   const command=encoder.finish();device.queue.submit([command]);imageRevision++;
   traceDiagnostic('encoding-submit','Commandes WebGPU soumises',()=>({frame,submission:imageRevision,pose:lastCamera?cameraPose(lastCamera):null,width,height,drawCalls:gpuDrawCalls,drawnTriangles:gpuFrameActive&&!gpuMetricsReady?null:drawn.reduce((sum,page)=>sum+page.triangles,0),transparent:{drawCalls:blendDrawCalls,submittedTriangles:blendSubmittedTriangles},presentation:secondaryCamera?'surface-capture':context.gpuCanvas?'direct':'composed'}));
   if(gpuTiming?.isSampled(encoder))gpuTiming.submitted(encoder,{submission:imageRevision,viewport:[width,height],cameraWorld:lastCamera?.getWorldPosition(new THREE.Vector3()).toArray(),viewProjection:[...viewProj.elements],scope:'selection-and-render-passes',excludes:['uploads and copies','CPU work','presentation latency'],drawCalls:gpuDrawCalls,transparentDrawCalls:blendDrawCalls,transparentSubmittedTriangles:blendSubmittedTriangles});
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
  inverseViewProj.copy(viewProj).invert();
  camera.getWorldPosition(cameraWorldScratch);
  cameraWorldArray[0]=cameraWorldScratch.x;cameraWorldArray[1]=cameraWorldScratch.y;cameraWorldArray[2]=cameraWorldScratch.z;
  deferred.update(inverseViewProj.elements,cameraWorldArray,width,height,clearColor,diagnostic!=='beauty');
  deferred.light(encoder,hdrView);gpuDrawCalls++;
  encodeBlend(device,encoder,uniformBase);
  const presentation=secondaryCamera?undefined:presenter?.targetView(width,height);
  gpuDrawCalls++;deferred.compose(encoder,colorView,{r:(clearColor>>16)/255,g:((clearColor>>8)&255)/255,b:(clearColor&255)/255,a:1},presentation);
  return !!presentation;
 };
 const visBin=(rec:PageRec):0|1|2=>{
  const side=materialSide(rec.material);
  if(side===THREE.DoubleSide)return BIN_NONE;
  // Indirect pipelines share ccw front faces; a reflection swaps which side
  // must be culled instead of requiring three more draw slots.
  return (side===THREE.BackSide)!==windingCw(rec)?BIN_FRONT:BIN_BACK;
 };
 const encodeVis=(device:GPUDevice,camera:THREE.PerspectiveCamera,itemsDirty:boolean)=>{
  if(!visBindGroupLayout||!cache||!concatPos||!colorView||!depthView||!visView||!visPipelineBack||!shadePipeline||!pageTable||!pageTableInts)return 0;
  const idsView=visView,depthTarget=depthView;
  const [width,height]=targetSize;
  if(!packedCount){
   if(!surfaces)throw new Error('SURFACE_UNAVAILABLE');
   const encoder=createRenderEncoder(device);
   const pass=encoder.beginRenderPass({label:'WG empty surfaces',colorAttachments:surfaces.views().map(view=>({view,loadOp:'clear' as const,storeOp:'store' as const,clearValue:[0,0,0,0]})),depthStencilAttachment:{view:depthTarget,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});pass.end();
   const presented=encodeSurfaceLighting(device,encoder,camera,0);
   submitColorCopy(device,encoder,height,width,presented);
   return blendSubmittedTriangles;
  }
  ensureUniform(device,Math.max(1,packedCount+blendGpu.length));
  if(!gpuSmall&&!hybridUnavailable&&typeof device.createComputePipeline==='function'){
   try{checkFrameBudget(width,height,captureAllocationBytes+width*height*8+smallTriangleCapacity*4);gpuSmall=createGpuSmallTriangles(device,width,height,smallTriangleCapacity);capabilities.unsupported=capabilities.unsupported.filter(item=>item!=='small-triangle compute raster');}
   catch(error){hybridUnavailable=true;diagnosticFailure('small-triangle-compute-unavailable',error);}
  }
  // Occluder/rest partition of the image: the half the previous image drew unoccluded, and the nearest
  // half by depth when there is no history or the history splits nothing. The boxes feed both the
  // partition and the Hi-Z test, projected with the view-projection built once for the batch rather
  // than once per page and once again per tested page.
  let occluders=0,twoPass=false,boundsForAll=false;
  const worldBoxes={corners:boxCorners,pageIndex:packedPageIndex,epoch:tableEpoch};
  lastProjectMs=0;lastPartitionMs=0;lastItemsMs=0;
  const partitionStart=performance.now();
  hizRest.fill(0,0,packedCount);
  if(gpuHiz&&packedCount>=2){
   if(!noOccluderHistory){
    for(let i=0;i<packedCount;i++){
     const rest=drawnOccluderUrls[urlIndexOfPage[packedPageIndex[i]]]?0:1;
     hizRest[i]=rest;if(!rest)occluders++;
    }
    if(!occluders||occluders===packedCount){
     projectBoxesFlat(packedRecs,packedCount,camera,[width,height],hizBounds,undefined,worldBoxes);
     occluders=splitOccludersFlat(packedCount,hizBounds,hizRest);boundsForAll=true;
    }
   }else{
    projectBoxesFlat(packedRecs,packedCount,camera,[width,height],hizBounds,undefined,worldBoxes);
    occluders=splitOccludersFlat(packedCount,hizBounds,hizRest);boundsForAll=true;
   }
   twoPass=occluders>0&&occluders<packedCount&&!!visHizRestBack;
  }
  if(!twoPass){hizRest.fill(0,0,packedCount);occluders=packedCount;}
  lastPartitionMs=performance.now()-partitionStart;
  // Only the tested half needs a screen rectangle, and the history branch has projected nothing yet.
  const projectStart=performance.now();
  if(twoPass&&!boundsForAll)projectBoxesFlat(packedRecs,packedCount,camera,[width,height],hizBounds,hizRest,worldBoxes);
  lastProjectMs=performance.now()-projectStart;
  const maxVertexCount=Math.max(1,pageBytes/4);
  const useIndirect=!!gpuDraw&&packedCount<=drawSlots;
  // The table holds every row ever claimed, so a row a page keeps stays valid across frames.
  const tableRows=rowCount;
  if(tableRows>VIS_MAX_PAGES)throw new Error(`VISIBILITY_ID_RANGE: ${tableRows} pages exceed the ${VIS_MAX_PAGES} a visibility identifier addresses`);
  let occluderVertices=0,restVertices=0,testedCount=0;
  drawRestBits.fill(0,0,Math.ceil(Math.max(1,packedCount)/32));
  const itemsStart=performance.now();
  for(let i=0;i<packedCount;i++){
   const row=i,rest=hizRest[i];
   if(itemsDirty){
    const word=i*DRAW_ITEM_U32;
    drawItemWords[word]=row;drawItemWords[word+1]=visBin(packedRecs[i]!);
    drawItemWords[word+2]=packedPageIndex[i];drawItemWords[word+3]=0;
   }
   if(rest)drawRestBits[i>>5]|=1<<(i&31);
   const count=packedRecs[i]!.array!.length;
   if(rest)restVertices+=count;else occluderVertices+=count;
   // Only the tested half travels to the GPU, each box naming the flag row it answers for.
   if(twoPass&&rest){
    const from=i*HIZ_BOUNDS_VALUES,to=testedCount*HIZ_BOUNDS_VALUES;
    for(let k=0;k<HIZ_BOUNDS_VALUES;k++)hizTestedBounds[to+k]=hizBounds[from+k];
    hizTestedRows[testedCount++]=row;
   }
  }
  lastItemsMs=performance.now()-itemsStart;
  uploadDirtyRows(device);
  if(!visUniform)visUniform=device.createBuffer({size:7*256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const visInts=new Uint32Array(visUniPacked.buffer);
  for(let slot=0;slot<7;slot++){
   const base=slot*64;
   visUniPacked.set(viewProj.elements,base);
   visUniPacked[base+16]=width;visUniPacked[base+17]=height;visUniPacked[base+18]=gpuSmall?7:0;
   // The compute raster splits the page row over two dispatch dimensions; it needs the live count.
   visInts[base+19]=tableRows;
   visInts[base+20]=Math.max(0,slot-1);visInts[base+21]=slot===0?0:1;
   visInts[base+22]=gpuFrameActive?(gpuSelection?.maskOffset??0):0;visInts[base+23]=gpuFrameActive?1:0;
  }
  device.queue.writeBuffer(visUniform,0,visUniPacked);
  if(!shadeUniform)shadeUniform=device.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  shadeUniPacked.set(viewProj.elements,0);shadeUniPacked[16]=width;shadeUniPacked[17]=height;
  const shadeInts=new Uint32Array(shadeUniPacked.buffer);shadeInts[20]=tableRows;shadeInts[21]=diagnostic==='wireframe'?1:diagnostic==='pages'?3:diagnostic==='beauty'?0:2;
  device.queue.writeBuffer(shadeUniform,0,shadeUniPacked);
  if(!shadeBindGroup&&shadeBindGroupLayout&&visView&&pageTable&&concatPos&&concatUv&&concatNrm&&mapsTexture&&dataMapsTexture&&mapsSampler&&shadeUniform&&cache){
   shadeBindGroup=device.createBindGroup({layout:shadeBindGroupLayout,entries:[
    {binding:0,resource:visView},{binding:1,resource:{buffer:cache.buffer}},{binding:2,resource:{buffer:concatPos}},
    {binding:3,resource:{buffer:concatUv}},{binding:4,resource:{buffer:concatNrm}},{binding:5,resource:{buffer:pageTable}},
    {binding:6,resource:mapsArrayView??=mapsTexture.createView({dimension:'2d-array'})},{binding:7,resource:mapsSampler},{binding:8,resource:{buffer:shadeUniform}},
    {binding:9,resource:dataMapsArrayView??=dataMapsTexture.createView({dimension:'2d-array'})},
   ]});
  }
  if(visBindGroupLayout&&cache&&concatPos&&concatUv&&pageTable&&visUniform&&zeroFlags&&mapsTexture&&mapsSampler){
   const visMaps=mapsArrayView??=mapsTexture.createView({dimension:'2d-array'});
   if(!visBindGroup)visBindGroup=device.createBindGroup({layout:visBindGroupLayout,entries:[
    {binding:0,resource:{buffer:cache.buffer}},{binding:1,resource:{buffer:concatPos}},
    {binding:2,resource:{buffer:pageTable}},{binding:3,resource:{buffer:zeroFlags}},
    {binding:4,resource:{buffer:visUniform,offset:0,size:96}},{binding:5,resource:{buffer:concatUv}},
    {binding:6,resource:visMaps},{binding:7,resource:mapsSampler},
    {binding:8,resource:{buffer:zeroFlags}},{binding:9,resource:{buffer:zeroFlags}},
   ]});
   if(!visHizBindGroup&&gpuHiz)visHizBindGroup=device.createBindGroup({layout:visBindGroupLayout,entries:[
    {binding:0,resource:{buffer:cache.buffer}},{binding:1,resource:{buffer:concatPos}},
    {binding:2,resource:{buffer:pageTable}},{binding:3,resource:{buffer:gpuHiz.flags}},
    {binding:4,resource:{buffer:visUniform,offset:0,size:96}},{binding:5,resource:{buffer:concatUv}},
    {binding:6,resource:visMaps},{binding:7,resource:mapsSampler},
    {binding:8,resource:{buffer:zeroFlags}},{binding:9,resource:{buffer:zeroFlags}},
   ]});
  }
  const encoder=createRenderEncoder(device);
  // The item words restate the rows, so the upload is what consumes the changed flag.
  if(useIndirect){gpuDraw!.encode(encoder,drawItemWords,packedCount,itemsDirty,drawRestBits,maxVertexCount,gpuFrameActive?gpuSelection:undefined);rowsChanged=false;}
  const visColors=(loadOp:'clear'|'load')=>{
   const ids:{view:GPUTextureView;loadOp:'clear'|'load';storeOp:'store';clearValue?:GPUColor}={view:idsView,loadOp,storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}};
   if(!gpuHiz)return [ids];
   return [ids,{view:gpuHiz.level0View,loadOp,storeOp:'store' as const,clearValue:{r:1,g:0,b:0,a:1}}];
  };
  const visSlots=[visPipelineBack,visPipelineNone,visPipelineFront,visHizRestBack,visHizRestNone,visHizRestFront];
  const visGroupFor=(slot:number,rest:boolean)=>{
   if(!visBindGroupLayout||!cache||!concatPos||!concatUv||!pageTable||!visUniform||!mapsTexture||!mapsSampler||!gpuDraw)return;
   const flags=rest?gpuHiz?.flags:zeroFlags;if(!flags)return;
   const key=slot*2+(rest?1:0);
   let group=visSlotGroups[key];
   if(!group){
    const visMaps=mapsArrayView??=mapsTexture.createView({dimension:'2d-array'});
    group=device.createBindGroup({layout:visBindGroupLayout,entries:[
     {binding:0,resource:{buffer:cache.buffer}},{binding:1,resource:{buffer:concatPos}},
     {binding:2,resource:{buffer:pageTable}},{binding:3,resource:{buffer:flags}},
     {binding:4,resource:{buffer:visUniform,offset:(slot+1)*256,size:96}},{binding:5,resource:{buffer:concatUv}},
     {binding:6,resource:visMaps},{binding:7,resource:mapsSampler},
     {binding:8,resource:{buffer:gpuDraw.instanceBuffer}},{binding:9,resource:{buffer:gpuDraw.slotOffsetsBuffer}},
    ]});
    visSlotGroups[key]=group;
   }
   return group;
  };
  /** Draws the occluder half (`rest` false) or the tested half; with `twoPass` false, everything. */
  const drawVis=(pass:GPURenderPassEncoder,rest:boolean)=>{
   if(useIndirect){
    if(!gpuDraw)return;
    const start=rest?3:0;
    for(let s=start;s<start+3;s++){
     const pipeline=visSlots[s],group=visGroupFor(s,rest);if(!pipeline||!group)continue;
     pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.drawIndirect(gpuDraw.indirectBuffer,s*16);gpuDrawCalls++;
    }
    return;
   }
   const group=rest?(visHizBindGroup??visBindGroup):visBindGroup;
   if(!group)return;
   for(let i=0;i<packedCount;i++){
    if(twoPass&&(hizRest[i]!==0)!==rest)continue;
    const pipeline=visPipelineFor(packedRecs[i]!,rest);
    if(!pipeline)continue;
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(packedRecs[i]!.array!.length,1,0,i);gpuDrawCalls++;
   }
  };
  const visPass=encoder.beginRenderPass({
   label:'WG visibility primary',
   colorAttachments:visColors('clear'),
   depthStencilAttachment:{view:depthTarget,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'},
  });
  visPass.setViewport(0,0,width,height,0,1);
  drawVis(visPass,false);
  visPass.end();
  let vertices=twoPass?occluderVertices:occluderVertices+restVertices;
  if(twoPass&&gpuHiz){
   gpuHiz.encodePyramid(encoder);
   gpuHiz.encodeTest(device,encoder,hizTestedBounds,hizTestedRows,testedCount,tableRows);
   const restPass=encoder.beginRenderPass({
    label:'WG visibility secondary',
    colorAttachments:visColors('load'),
    depthStencilAttachment:{view:depthTarget,depthLoadOp:'load',depthStoreOp:'store'},
   });
   restPass.setViewport(0,0,width,height,0,1);
   drawVis(restPass,true);
   restPass.end();
   vertices+=restVertices;
  }
  if(gpuHiz){
   // The occluders of this image are the first pass of the next one, unless the view or a world moves.
   drawnOccluderUrls.fill(0);
   for(let i=0;i<packedCount;i++)if(!hizRest[i])drawnOccluderUrls[urlIndexOfPage[packedPageIndex[i]]]=1;
   noOccluderHistory=occluders===0;
  }
  if(gpuSmall&&cache&&concatPos&&concatUv&&pageTable&&visUniform&&zeroFlags&&mapsTexture&&mapsSampler){
   // Every row carries its own Hi-Z slot, so a frame that ran no occlusion test is handed the zero
   // flags: the pyramid verdicts of the previous image do not describe this one.
   const hizFlags=twoPass&&gpuHiz?gpuHiz.flags:zeroFlags;
   const smallKey=(hizFlags===zeroFlags?0:1)+(gpuFrameActive?2:0);
   gpuSmall.encode(encoder,{indices:cache.buffer,positions:concatPos,pages:pageTable,hizFlags,uniform:visUniform,uvs:concatUv,maps:mapsArrayView??=mapsTexture.createView({dimension:'2d-array'}),sampler:mapsSampler,pageRows:tableRows,maxTriangles:Math.ceil(maxVertexCount/3),idsView,depthView:depthTarget,hizView:gpuHiz?.level0View,selection:gpuFrameActive?gpuSelection:undefined,groups:smallGroups,groupKey:smallKey});
   gpuDrawCalls++;
  }
  if(!surfaces||!deferred||!hdrView)throw new Error('DEFERRED_UNAVAILABLE');
  const shadePass=encoder.beginRenderPass({label:'WG material surfaces v1',colorAttachments:surfaces.views().map(view=>({view,loadOp:'clear' as const,storeOp:'store' as const,clearValue:[0,0,0,0]}))});
  shadePass.setViewport(0,0,width,height,0,1);
  if(shadeBindGroup){shadePass.setPipeline(shadePipeline);shadePass.setBindGroup(0,shadeBindGroup);shadePass.draw(3);gpuDrawCalls++;}
  shadePass.end();
  const presented=encodeSurfaceLighting(device,encoder,camera,packedCount);
  submitColorCopy(device,encoder,height,width,presented);
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
  ensurePageTable(device);
  if(!gpuFrameActive)syncRowsFromCut();else if(rowsSyncedFrame!==frame){syncRows();rowsSyncedFrame=frame;}
  const itemsDirty=rowsChanged;
  if(visEnabled&&visPipelineBack&&shadePipeline&&visView){
   try{return encodeVis(device,camera,itemsDirty);}catch(error){gpuTiming?.cancelUnsubmitted();diagnosticFailure('visibility-render-failed',error);dropVis();gpuDrawCalls=0;if(context.gpuCanvas||secondaryCamera||gpuFrameActive)throw error;}
  }
  if(!pipelineBack)return 0;
  uploadDirtyRows(device);
  if(!packedCount){
   const encoder=createRenderEncoder(device);
   encodeClear(device,encoder);
   encodeBlend(device,encoder,0);
   submitColorCopy(device,encoder,height,width);
   return blendSubmittedTriangles;
  }
  ensureUniform(device,Math.max(1,packedCount+blendGpu.length));
  const packedInts=new Uint32Array(uniformPacked.buffer,uniformPacked.byteOffset,uniformPacked.length);
  const fallbackWords=PAGE_INFO_STRIDE/4;
  for(let i=0;i<packedCount;i++){
   const rec=packedRecs[i]!,row=i,base=i*(UNIFORM_STRIDE/4),color=pageRgb(rec);
   uniformPacked.set(viewProj.elements,base);uniformPacked.set(rec.matrix.elements,base+16);
   uniformPacked[base+32]=color[0];uniformPacked[base+33]=color[1];uniformPacked[base+34]=color[2];uniformPacked[base+35]=1;
   packedInts[base+36]=pageTableInts![row*fallbackWords+24];packedInts[base+37]=pageTableInts![row*fallbackWords+25];packedInts[base+38]=diagnostic==='wireframe'?1:0;
  }
  if(packedCount&&uniformBuffer)device.queue.writeBuffer(uniformBuffer,0,uniformPacked.subarray(0,packedCount*(UNIFORM_STRIDE/4)));
  const encoder=createRenderEncoder(device);
  const pass=encoder.beginRenderPass({
   label:'WG opaque fallback',
   colorAttachments:[{view:colorView,loadOp:'clear',storeOp:'store',clearValue:{r:(clearColor>>16)/255,g:((clearColor>>8)&255)/255,b:(clearColor&255)/255,a:1}}],
   depthStencilAttachment:{view:depthView,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'},
  });
  pass.setViewport(0,0,width,height,0,1);
  let vertices=0;
  for(let i=0;i<packedCount;i++){
   const position=packedPositions[i];if(!position)continue;
   const group=bindGroupFor(device,position),pipeline=pipelineFor(packedRecs[i]!);if(!group||!pipeline)continue;
   const count=pageTableInts![i*fallbackWords+25];
   pass.setPipeline(pipeline);pass.setBindGroup(0,group,[i*UNIFORM_STRIDE]);pass.draw(count);gpuDrawCalls++;vertices+=count;
  }
  pass.end();
  encodeBlend(device,encoder,packedCount);
  submitColorCopy(device,encoder,height,width);
  return vertices/3+blendSubmittedTriangles;
 };
 const hasBytes=(rec:PageRec)=>!!(rec.array||sourceBytes.has(rec.url));
 /**
  * Residency the GPU page budget can actually hold. The pinned roots come first and are never given
  * up, then the wanted clusters coarsest first, so what survives is always a complete cover plus as
  * much detail as fits. A cut wider than the budget is coarsened by `budgetPixelError`, so this
  * bound only smooths the frames it takes that feedback to settle; it never truncates the drawn cut.
  */
 const residencyScratch:PageRec[]=[],culledScratch:PageRec[]=[];
 const budgetedResidency=(pages:readonly PageRec[])=>{
  const room=Math.max(0,slots-bootstrapUrls.size);
  residencyScratch.length=0;
  for(let i=0;i<pages.length;i++)if(!bootstrapUrls.has(pages[i].url))residencyScratch.push(pages[i]);
  if(residencyScratch.length<=room)return residencyScratch;
  // Coarse clusters cover more surface per slot and are what the residency fallback steps back to.
  residencyScratch.sort((a,b)=>(b.level??0)-(a.level??0));
  residencyScratch.length=room;
  return residencyScratch;
 };
 const pinsBefore=new Set<string>();
 const updatePins=()=>{
  if(!cache)return;
  // `added`/`removed` only feed the trace record, so the copy that computes them is taken only then.
  if(traceEnabled){pinsBefore.clear();for(const key of pins)pinsBefore.add(key);}
  const keep=keepScratch;keep.clear();
  for(const key of bootstrapUrls)keep.add(key);
  for(let i=0;i<shown.length;i++)if(!gpuFrameActive||shown[i].transparent)keep.add(shown[i].url);
  for(const key of residencyWanted)keep.add(key);
  for(const key of pins)if(!keep.has(key)){cache.unpin(key);pins.delete(key);}
  for(const key of keep)if(cache.get(key)&&!pins.has(key)){cache.pin(key);pins.add(key);}
  if(deferredDrops.size){
   // `keep` holds cluster keys; a deferred drop names the request that carries them.
   const keepRequests=requestUrlByPage?new Set([...keep].map(url=>requestUrlByPage.get(url)??url)):keep;
   for(const key of deferredDrops)if(!keepRequests.has(key))backend.dropPage!(key);
  }
  if(!traceEnabled)return;
  const added=[...pins].filter(key=>!pinsBefore.has(key)),removed=[...pinsBefore].filter(key=>!pins.has(key));
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
   const workers=Array.from({length:Math.min(8,bootstrap.length)},async()=>{while(next<bootstrap.length){const page=bootstrap[next++];context.signal?.throwIfAborted();if(lost)throw new Error('WEBGPU_LOST');if(!hasBytes(page)){const key=pageRequestUrl(page);const array=await context.readPage!(key);context.signal?.throwIfAborted();if(lost)throw new Error('WEBGPU_LOST');backend.acceptPage!(key,array);}}});
   const results=await Promise.allSettled(workers);const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
   for(const page of bootstrap){context.signal?.throwIfAborted();if(lost)throw new Error('WEBGPU_LOST');await cache!.load(page.url,context.signal);cache!.pin(page.url);pins.add(page.url);}
   bootstrapReady=true;
   engineDiagnostic('coverage-bootstrap-ready','Couverture complète disponible sur le GPU',{version:1,pages:bootstrap.length,slots});
   traceDiagnostic('coverage-bootstrap-ready','Couverture complète disponible sur le GPU',()=>({frame,pages:bootstrap.length,bootstrap:traceSet('bootstrap',[...bootstrapUrls]),slots,durationMs:performance.now()-started,loaded:traceSet('bootstrap.loaded',bootstrap.map(page=>page.url)),wanted:traceSet('bootstrap.wanted',bootstrap.map(page=>page.url))}));
  })().catch(error=>{diagnosticFailure('coverage-bootstrap-failed',error);throw error;}).finally(()=>{bootstrapLoading=undefined;});
  return bootstrapLoading;
 };
 const ensureResident=async(wanted:readonly PageRec[],jobFrame:number,jobId:number)=>{
  if(!cache)return;
  const started=performance.now(),urls=traceEnabled?wanted.map(page=>page.url):[];
  traceDiagnostic('residency-ensure-start','Vérification de la résidence GPU demandée',()=>({frame:jobFrame,jobId,scope:'async-residency-ensure',pages:traceSet('ensure',urls),wanted:traceSet('ensure.wanted',urls),loaded:traceSet('ensure.loaded',urls.filter(url=>!!cache!.get(url))),queueWaitMs:null,elapsedMs:null,cpuWorkIncluded:true,gpuQueueWaitIncluded:false}));
  for(let i=0;i<wanted.length;i++){
   const rec=wanted[i];
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
  // The wanted set and the upload queue are rebuilt in place. The running job reads the queue by
  // index and re-checks `residencyWanted` for every entry, so it always works on the latest cut.
  residencyWanted.clear();for(let i=0;i<wanted.length;i++)residencyWanted.add(wanted[i].url);
  updatePins();
  residencyQueue.length=0;queueSeen.clear();
  for(let i=0;i<wanted.length;i++){const page=wanted[i];if(!hasBytes(page)||queueSeen.has(page.url))continue;queueSeen.add(page.url);residencyQueue.push(page);}
  residencyPending=true;const queued=residencyQueue;
  if(traceEnabled)traceDiagnostic('residency-queue','Résidence GPU mise en file',()=>({frame,jobId,pages:traceSet('queue',queued.map(page=>page.url)),wanted:traceSet('wanted',[...residencyWanted]),loaded:traceSet('queue.loaded',queued.filter(page=>!!cache?.get(page.url)).map(page=>page.url)),queueDepth:queued.length,residentPages:cache?.stats().residentPages??null}));
  if(residencyRunning)return;
  residencyRunning=true;
  pending=Promise.resolve().then(async()=>{const started=performance.now();traceDiagnostic('residency-job-start','Job de résidence GPU démarré',()=>({frame:jobFrame,jobId,scope:'async-residency-job',queueWaitMs:started-queuedAt,pages:traceSet('job',residencyQueue.map(page=>page.url)),elapsedMs:null,cpuWorkIncluded:true,gpuQueueWaitIncluded:false}));try{while(residencyPending){residencyPending=false;await ensureResident(residencyQueue,jobFrame,jobId);}}catch(error){diagnosticFailure('coverage-upload-failed',error);if(/LOST|DISPOSED/i.test(String(error)))lost=true;throw error;}finally{residencyRunning=false;traceDiagnostic('residency-job-end','Job de résidence GPU terminé',()=>({frame:jobFrame,jobId,scope:'async-residency-job',durationMs:performance.now()-started,elapsedMs:performance.now()-queuedAt,pages:traceSet('job',[...residencyWanted]),loaded:traceSet('job.loaded',[...residencyWanted].filter(url=>!!cache?.get(url))),residentPages:cache?.stats().residentPages??null,queueWaitMs:started-queuedAt,cpuWorkIncluded:true,gpuQueueWaitIncluded:false}));}});
  void pending.catch(()=>{});
 };
 // Readback describes submitted work and future streaming requests. It never
 // decides the cut drawn for a moving camera; the current GPU mask does that.
 const adoptGpuCut=()=>{
  const cut=gpuSelection?.peek();
  if(!cut?.result.drawablePageIds)return;
  gpuWanted.length=0;for(const id of cut.result.pageIds){const rec=packedPages[id];if(rec)gpuWanted.push(rec);}
  partitionByPass(desired,true,transparentScratch);
  desired.length=0;appendAll(desired,gpuWanted,transparentScratch);
  if(!sameSelectionUniforms(cut.uniforms,selectionUniforms))return;
  if(cut.result.complete===false)throw new Error('GPU_COVERAGE_INCOMPLETE');
  const drawnTriangles=shownFromGpu(packedPages,cut.result.drawablePageIds,frame,drawableScratch);
  partitionByPass(shown,true,transparentScratch);
  shown.length=0;appendAll(shown,drawableScratch,transparentScratch);drawn.length=0;appendAll(drawn,shown);
  visible=desired.length;selectedTriangles=triangleSum(desired);
  submittedTriangles=drawnTriangles+blendSubmittedTriangles;
  frustumRejected=cut.result.frustumRejected;lodLevel=cut.result.lodLevel;gpuMetricsReady=true;
 };
 const renderGpuCut=(camera:THREE.PerspectiveCamera,pixelError:number,cpuStart:number,lightsEnd:number)=>{
  if(!gpuDevice||!cache||!gpuSelection)return;
  gpuFrameActive=true;
  // A cut wider than the GPU page budget is coarsened, never truncated: truncating a DAG cut punches
  // holes, while a coarser threshold is still an exact partition of the surface. `budgetPixelError`
  // carries the previous frame's verdict, the same feedback `pageBudget` applies on the CPU path.
  const budgeted=Math.max(pixelError,budgetPixelError);
  cameraSelectionUniforms(camera,budgeted,viewport,selectionUniforms);
  adoptGpuCut();
  const adoptEnd=performance.now();
  // Forward transparency has its own CPU cut; it is absent from the GPU cluster set.
  const transparentBudget=Math.max(1,slots-bootstrapUrls.size);
  const transparent=transparentRoots.length?selectVisiblePages(transparentRoots,camera,{pixelError:budgeted,viewport,frame,holdResident:true,rootFallback:true,pageBudget:transparentBudget,isResident:rec=>!!cache!.get(rec.url)}):undefined;
  const transparentSelectEnd=performance.now();
  const oldOpaque=partitionByPass(shown,false,opaqueScratch);
  shown.length=0;appendAll(shown,oldOpaque,transparent?.shown??[]);
  desired.length=0;appendAll(desired,gpuWanted,transparent?.wanted??[]);
  if(gpuMetricsReady){visible=desired.length;selectedTriangles=triangleSum(desired);}
  const requested=requestedScratch;requested.clear();
  for(const url of bootstrapUrls)requested.add(url);
  for(let i=0;i<desired.length;i++)requested.add(desired[i].url);
  const wasLimited=coverageBudgetLimited;coverageBudgetLimited=requested.size>slots;
  // Coarsen until the wanted cut fits, and relax again once it fits with room to spare. Doubling
  // and halving with a gap between the two thresholds keeps the loop from oscillating every frame.
  if(coverageBudgetLimited)budgetPixelError=Math.min(MAX_BUDGET_PIXEL_ERROR,budgetPixelError>0?budgetPixelError*2:Math.max(1,pixelError*2));
  else if(budgetPixelError>0&&requested.size<slots*0.7)budgetPixelError=budgetPixelError>pixelError*2?budgetPixelError/2:0;
  if(wasLimited!==coverageBudgetLimited)coverageBudgetEvent={version:1,limited:coverageBudgetLimited,requiredSlots:requested.size,slots,fallbackRetained:bootstrapReady,pixelError:budgeted};
  if(!bootstrapReady){
   gpuMetricsReady=false;
   traceDiagnostic('frame','Frame en attente de couverture GPU',{backend:'webgpu-page-raster',frame,submission:imageRevision,source:'gpu',coverage:{ready:false},selectedTriangles:null,submittedTriangles:null});
   return;
  }
  // With the roots pinned the transparent cut always falls back to them, so an incomplete cut here
  // means a pinned root is itself absent from the cache, which is a bug and not a streaming state.
  if(transparent?.complete===false)throw new Error('GPU_COVERAGE_INCOMPLETE: a pinned transparent root cluster is not resident');
  transitionScratch.clear();
  if(transparent&&!coverageBudgetLimited){
   for(const url of requested)transitionScratch.add(url);
   for(let i=0;i<transparent.shown.length;i++)transitionScratch.add(transparent.shown[i].url);
  }
  if(transparent&&!coverageBudgetLimited&&transitionScratch.size>slots){
   const fallback=selectVisiblePages(transparentRoots,camera,{pixelError:budgeted,viewport,frame,holdResident:true,rootFallback:true,pageBudget:transparentBudget,isResident:rec=>bootstrapUrls.has(rec.url)&&!!cache!.get(rec.url)});
   if(!fallback.complete)throw new Error('GPU_COVERAGE_INCOMPLETE: the pinned transparent cover is not resident');
   shown.length=0;appendAll(shown,oldOpaque,fallback.shown);
  }
  const admissionEnd=performance.now();
  queueResident(budgetedResidency(desired));
  // Enumerate the bounded resident candidates once. GPU selection and compaction
  // share their page indices; no CPU frustum/LOD traversal or regrouping follows.
  const queueEnd=performance.now();
  ensurePageTable(gpuDevice);
  syncRows();rowsSyncedFrame=frame;
  const rowsEnd=performance.now();
  if(candidateOverflow){
   // The CPU fallback can still select a representable visible subset.
   engineDiagnostic('gpu-selection-capacity','Sélection CPU requise par la capacité des identifiants de visibilité',{residentCandidates:candidateCount+candidateOverflow,maxCandidates:drawSlots});
   dropGpuSelection();gpuFrameActive=false;backend.render(camera);return;
  }
  if(gpuSelection.updateResidency(residentFlags))gpuMetricsReady=false;
  const residencyUploadEnd=performance.now();
  selectionInImage=true;
  try{gpuSelection.dispatch(selectionUniforms);}catch(error){
   selectionInImage=false;
   diagnosticFailure('gpu-selection-dispatch-failed',error);dropGpuSelection();gpuFrameActive=false;
   backend.render(camera);return;
  }
  selectionInImage=false;
  drawn.length=0;appendAll(drawn,shown);
  const selectionEnd=performance.now();
  const [width,height]=viewport;ensureTargets(gpuDevice,Math.max(1,width),Math.max(1,height));
  if(!renderPathLogged){renderPathLogged=true;engineDiagnostic('first-render-path','Configuration du premier rendu WebGPU',{clearColor:`#${clearColor.toString(16).padStart(6,'0')}`,targetSize,visibilityBuffer:true,selection:'current-frame-mask',residentCandidates:candidateCount});}
  const encodeStart=performance.now();
  try{encodeDraws(gpuDevice,camera);}catch(error){
   if(context.gpuCanvas)throw error;
   dropGpuSelection();gpuFrameActive=false;backend.render(camera);return;
  }
  const cpuEnd=performance.now();lastSubmitMs=cpuEnd-encodeStart;
  if(gpuMetricsReady)submittedTriangles=triangleSum(shown,false)+blendSubmittedTriangles;
  const steps=cpuProfile.row;
  steps[0]=adoptEnd-lightsEnd;steps[1]=transparentSelectEnd-adoptEnd;steps[2]=admissionEnd-transparentSelectEnd;
  steps[3]=queueEnd-admissionEnd;steps[4]=rowsEnd-queueEnd;steps[5]=residencyUploadEnd-rowsEnd;
  steps[6]=selectionEnd-residencyUploadEnd;steps[7]=lastProjectMs;steps[8]=lastPartitionMs;steps[9]=lastItemsMs;
  steps[10]=lastSubmitMs-lastProjectMs-lastPartitionMs-lastItemsMs;steps[11]=lastSubmitMs;steps[12]=cpuEnd-cpuStart;
  cpuProfile.record(frame,cpuEnd-cpuStart);
  cpuSample={version:1,frame,submission:imageRevision,scope:'backend-render-call',totalMs:cpuEnd-cpuStart,lightsMs:lightsEnd-cpuStart,selectionMs:selectionEnd-lightsEnd,residencyScheduleAndTargetsMs:encodeStart-selectionEnd,encodeSubmitMs:lastSubmitMs,transparentEncodeMs,transparentIncludedIn:'encodeSubmitMs',asyncResidencyWaitMs:null};
  publishCpuProfile();
  if(traceEnabled)traceDiagnostic('gpu-selection-current-frame','Sélection GPU consommée par le dessin',()=>({frame,submission:imageRevision,source:'gpu',decision:'current-frame-mask',residentCandidates:candidateCount,readbackPurpose:'streaming-and-metrics',metricsReady:gpuMetricsReady}));
  if(traceEnabled)traceDiagnostic('frame','Snapshot complet de la frame WebGPU',()=>({backend:'webgpu-page-raster',frame,submission:imageRevision,pose:cameraPose(camera),source:'gpu',selection:{source:'gpu',decision:'current-frame-mask'},cpu:cpuSample,coverage:{loaded:traceSet('frame.loaded',packedRecs.slice(0,packedCount).map(page=>page!.url)),wanted:traceSet('frame.wanted',desired.map(page=>page.url)),shown:gpuMetricsReady?traceSet('frame.shown',shown.map(page=>page.url)):null,ready:bootstrapReady},budget:{slots,limited:coverageBudgetLimited},selectedTriangles:gpuMetricsReady?selectedTriangles:null,submittedTriangles:gpuMetricsReady?submittedTriangles:null,drawCalls:gpuDrawCalls}));
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
   gpuTiming=createGpuTiming(gpuDevice,{sampleEveryFrames:traceEnabled?1:12,onSample:sample=>{
    // The public metric carries the contract's fields only; the diagnostic keeps the full context.
    lastGpuPassMs={frame:sample.frame,totalMs:sample.totalMs,passes:sample.passes,truncated:sample.truncated,...(sample.error?{error:sample.error}:{})};lastGpuFrameMs=sample.frameMs;
    const phase=sample.error?'gpu-timing-unavailable':'gpu-timing',message=sample.error?'Mesure GPU indisponible':'Durées GPU mesurées par passe';
    engineDiagnostic(phase,message,sample);
    if(traceEnabled)traceDiagnostic(phase,message,()=>({backend:'webgpu-page-raster',submission:sample.submission??null,...sample}));
   }});
   const timingStats=gpuTiming.stats();
   engineDiagnostic('gpu-timing-status','Disponibilité des mesures GPU par passe',{version:1,available:gpuTiming.supported,reason:gpuTiming.supported?null:'timestamp-query-unavailable',method:'timestamp-query',sampleEveryFrames:timingStats.sampleEveryFrames,maxPasses:timingStats.maxPasses,maxParts:timingStats.maxParts,maxPending:1,queryCount:timingStats.queryCount,scope:'selection-and-render-passes',excludes:['uploads and copies','CPU work','presentation latency'],stats:timingStats});
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
    for(let i=0;i<packedPages.length;i++)pagePositions[i]=positionBuffers.get(packedPages[i].attributes);
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
     const normalMaps=new Set<THREE.Texture>();
     const addColor=(texture?:THREE.Texture)=>{if(texture&&!mapLayer.has(texture)){mapLayer.set(texture,maps.length+1);maps.push(texture);}};
     const addData=(texture?:THREE.Texture)=>{if(texture&&!dataLayer.has(texture)){dataLayer.set(texture,dataMaps.length+1);dataMaps.push(texture);}};
     for(const rec of allPages){const mat=visMaterial(rec.material);addColor(mat.map);addColor(mat.emissiveMap);addData(mat.roughnessMap);addData(mat.metalnessMap);addData(mat.normalMap);if(mat.normalMap)normalMaps.add(mat.normalMap);addData(mat.aoMap);}
     for(const copy of blendCopies){const mat=visMaterial(copy.material);addColor(mat.map);addColor(mat.emissiveMap);addData(mat.roughnessMap);addData(mat.metalnessMap);addData(mat.normalMap);if(mat.normalMap)normalMaps.add(mat.normalMap);addData(mat.aoMap);}
     engineDiagnostic('material-textures','Textures nécessaires au rendu',{colorTextures:maps.length,dataTextures:dataMaps.length,materials:new Set(allPages.map(page=>page.material)).size,opaquePages:allPages.length,forwardMeshes:blendCopies.length,geometryWithTangents:[...geometryBlocks.values()].filter(block=>block.hasTangent).length,geometryWithoutTangents:[...geometryBlocks.values()].filter(block=>!block.hasTangent).length});
     const textureStarted=performance.now();
     let maxW=1,maxH=1;
     const rgbaMaps=maps.map(texture=>{const rgba=textureRgba(texture);if(rgba){maxW=Math.max(maxW,rgba.width);maxH=Math.max(maxH,rgba.height);}else{const image=texture.image as {width?:number;height?:number}|undefined;if(image?.width&&image.height){maxW=Math.max(maxW,image.width);maxH=Math.max(maxH,image.height);}}return rgba;});
     const layers=Math.max(2,maps.length+1);
     if(layers>gpuDevice.limits.maxTextureArrayLayers)throw new Error(`TEXTURE_ATLAS_LAYERS: ${layers} texture layers exceed the device limit ${gpuDevice.limits.maxTextureArrayLayers}`);
     mapsTexture=gpuDevice.createTexture({size:{width:maxW,height:maxH,depthOrArrayLayers:layers},format:'rgba8unorm-srgb',mipLevelCount:1+Math.floor(Math.log2(Math.max(maxW,maxH))),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
     const fallbackEncoder=gpuDevice.createCommandEncoder();
     const clearLayer=(texture:GPUTexture,layer:number,color:{r:number;g:number;b:number;a:number})=>{
      const pass=fallbackEncoder.beginRenderPass({colorAttachments:[{view:texture.createView({dimension:'2d',baseArrayLayer:layer,arrayLayerCount:1,baseMipLevel:0,mipLevelCount:1}),clearValue:color,loadOp:'clear',storeOp:'store'}]});pass.end();
     };
     for(let layer=0;layer<layers;layer++)clearLayer(mapsTexture,layer,{r:1,g:1,b:1,a:1});
     for(let i=0;i<maps.length;i++){
      const rgba=rgbaMaps[i],layer=i+1;uvScales[layer]=[1,1];
      if(rgba){
       uvScales[layer]=[rgba.width/maxW,rgba.height/maxH];
       textureJobs.push({kind:'color',layer,bytes:rgba.data.byteLength,upload:()=>{
        gpuDevice.queue.writeTexture({texture:mapsTexture!,origin:[0,0,layer]},Uint8Array.from(rgba.data),{bytesPerRow:rgba.width*4,rowsPerImage:rgba.height},{width:rgba.width,height:rgba.height});
       }});
      }else{
       const image=maps[i].image as GPUCopyExternalImageSource|undefined;
       if(!image||typeof gpuDevice.queue.copyExternalImageToTexture!=='function')throw new Error('MATERIAL_COLOR_TEXTURE_UNAVAILABLE');
       const w='width' in image?(image as ImageBitmap).width:maxW,h='height' in image?(image as ImageBitmap).height:maxH;
       uvScales[layer]=[w/maxW,h/maxH];
       textureJobs.push({kind:'color',layer,bytes:w*h*4,upload:()=>gpuDevice.queue.copyExternalImageToTexture({source:image},{texture:mapsTexture!,origin:[0,0,layer]},[w,h])});
      }
     }
     textureColorSize=[maxW,maxH];
     let dataW=1,dataH=1;
     const rgbaData=dataMaps.map(texture=>{const rgba=textureRgba(texture);if(rgba){dataW=Math.max(dataW,rgba.width);dataH=Math.max(dataH,rgba.height);}else{const image=texture.image as {width?:number;height?:number}|undefined;if(image?.width&&image.height){dataW=Math.max(dataW,image.width);dataH=Math.max(dataH,image.height);}}return rgba;});
     const dataLayers=Math.max(2,dataMaps.length+1);
     if(dataLayers>gpuDevice.limits.maxTextureArrayLayers)throw new Error(`TEXTURE_ATLAS_LAYERS: ${dataLayers} texture layers exceed the device limit ${gpuDevice.limits.maxTextureArrayLayers}`);
     dataMapsTexture=gpuDevice.createTexture({size:{width:dataW,height:dataH,depthOrArrayLayers:dataLayers},format:'rgba8unorm',mipLevelCount:1+Math.floor(Math.log2(Math.max(dataW,dataH))),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
     for(let layer=0;layer<dataLayers;layer++)clearLayer(dataMapsTexture,layer,normalMaps.has(dataMaps[layer-1])?{r:128/255,g:128/255,b:1,a:1}:{r:1,g:1,b:1,a:1});
     gpuDevice.queue.submit([fallbackEncoder.finish()]);
     for(let i=0;i<dataMaps.length;i++){
      const rgba=rgbaData[i],layer=i+1;dataUvScales[layer]=[1,1];
      if(rgba){
       dataUvScales[layer]=[rgba.width/dataW,rgba.height/dataH];
       textureJobs.push({kind:'data',layer,bytes:rgba.data.byteLength,upload:()=>{
        gpuDevice.queue.writeTexture({texture:dataMapsTexture!,origin:[0,0,layer]},Uint8Array.from(rgba.data),{bytesPerRow:rgba.width*4,rowsPerImage:rgba.height},{width:rgba.width,height:rgba.height});
       }});
      }else{
       const image=dataMaps[i].image as GPUCopyExternalImageSource|undefined;
       if(!image||typeof gpuDevice.queue.copyExternalImageToTexture!=='function')throw new Error('MATERIAL_DATA_TEXTURE_UNAVAILABLE');
       const w='width' in image?(image as ImageBitmap).width:dataW,h='height' in image?(image as ImageBitmap).height:dataH;
       dataUvScales[layer]=[w/dataW,h/dataH];
       textureJobs.push({kind:'data',layer,bytes:w*h*4,upload:()=>gpuDevice.queue.copyExternalImageToTexture({source:image},{texture:dataMapsTexture!,origin:[0,0,layer]},[w,h])});
      }
     }
     textureDataSize=[dataW,dataH];
     await generateMaterialMips(gpuDevice,mapsTexture,'rgba8unorm-srgb',maxW,maxH,uvScales);
     await generateMaterialMips(gpuDevice,dataMapsTexture,'rgba8unorm',dataW,dataH,dataUvScales);
     await pumpTextures();
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
      {binding:4,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform',minBindingSize:96}},
      {binding:5,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
      {binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float',viewDimension:'2d-array'}},
      {binding:7,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
      {binding:8,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
      {binding:9,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
     ]});
     // The untested passes bind zeros at the same row index the tested ones read, so the buffer spans
     // the row table; WebGPU hands back a zeroed buffer and nothing ever writes to this one.
     zeroFlags=gpuDevice.createBuffer({size:Math.max(4,drawSlots*4),usage:GPUBufferUsage.STORAGE});
     visUniform=gpuDevice.createBuffer({size:7*256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
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
     // A row indexes its own Hi-Z verdict, so the flag array spans the rows, not the resident pages.
     gpuHiz=await createGpuHiz(gpuDevice,Math.max(1,width),Math.max(1,height),drawSlots);
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
      gpuDraw=await createGpuDraw(gpuDevice,drawSlots);
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
    // Every cluster carries its own error band, so the GPU cut is one thread per cluster.
    if(gpuDraw&&opaqueRoots.length)gpuSelection=await createGpuDagSelection(gpuDevice,packDagSelection(opaqueRoots),{residentCut:true,createEncoder:()=>selectionInImage?createRenderEncoder(gpuDevice!):gpuDevice!.createCommandEncoder()});
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
   void pumpTextures().catch(error=>diagnosticFailure('progressive-texture-mips-failed',error));
   for(let i=0;i<opaqueRoots.length;i++)worldUpdates.set(opaqueRoots[i].world.elements,i*16);
   // A moved root invalidates every row's world matrix, which is the only shared input to a row the
   // scene can still change after `prepare()`.
   if(gpuSelection?.updateWorlds(worldUpdates)){tableEpoch++;noOccluderHistory=true;temporalHizState.pyramid=undefined;temporalHizState.camera=undefined;}
   if(!sameHizView(previousHizView,camera)){noOccluderHistory=true;temporalHizState.pyramid=undefined;temporalHizState.camera=undefined;previousHizView=camera.clone();}
   for(const item of blendGpu)if(item.sourceMesh){item.matrix.copy(item.sourceMesh.matrixWorld);if(item.bounds&&item.sourceGeometry.boundingBox)item.bounds.copy(item.sourceGeometry.boundingBox).applyMatrix4(item.matrix);}
   const cpuStart=performance.now();
   lightState=lights?.update();
   const lightsEnd=performance.now();
   lastCamera=camera;overBudget=false;submittedTriangles=0;blendSubmittedTriangles=0;blendDrawCalls=0;frame++;
   if(traceEnabled)traceDiagnostic('cpu-lights','Mise à jour CPU des lumières',()=>({frame,scope:'cpu/lights.update',elapsedMs:lightsEnd-cpuStart,lightState}));
   const pixelError=resolvePixelError(context,camera,motion);
   gpuFrameActive=false;gpuMetricsReady=false;
   if(gpuSelection?.failed())dropGpuSelection();
   if(!secondaryCamera&&gpuSelection?.residentCut&&gpuDraw&&visEnabled){
    renderGpuCut(camera,pixelError,cpuStart,lightsEnd);
    return;
   }
   const selectionStarted=lightsEnd;
   let selected:{complete?:boolean;shown:PageRec[];wanted?:PageRec[];visible:number;selectedTriangles:number;frustumRejected:number;lodLevel:number}|undefined;
   const gpuSelectionDecision={source:'cpu' as const,decision:'fallback',reason:secondaryCamera?'surface-capture':'gpu-selection-unavailable'};
   const gpuSelectionResolveEnd=performance.now();
   traceDiagnostic('gpu-selection-resolution','Résolution CPU du résultat de sélection GPU',()=>({frame,submission:imageRevision,scope:'cpu/gpu-selection-dispatch-peek',elapsedMs:gpuSelectionResolveEnd-selectionStarted,decision:gpuSelectionDecision,selectedFromGpu:!!selected}));
   if(!selected){
    const cpuSelectionStarted=performance.now();
    selected=selectVisiblePages(roots,camera,{pixelError,viewport,frame,holdResident:true,rootFallback:true,isResident:rec=>!!cache!.get(rec.url)},shown);
   const cpuSelectionEnd=performance.now(),chosen=selected;traceDiagnostic('cpu-selection','Sélection CPU de référence',()=>({frame,submission:imageRevision,scope:'cpu/selectVisiblePages',elapsedMs:cpuSelectionEnd-cpuSelectionStarted,shown:traceSet('selection.shown',chosen.shown.map(page=>page.url)),wanted:traceSet('selection.wanted',chosen.wanted?.map(page=>page.url)??chosen.shown.map(page=>page.url)),visible:chosen.visible,selectedTriangles:chosen.selectedTriangles,frustumRejected:chosen.frustumRejected,lodLevel:chosen.lodLevel,reason:gpuSelectionDecision.reason??'gpu-selection-unavailable'}));
   }
   else{shown.length=0;appendAll(shown,selected.shown);}
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
    const fallback=selectVisiblePages(roots,camera,{pixelError,viewport,frame,holdResident:true,rootFallback:true,isResident:rec=>bootstrapUrls.has(rec.url)&&!!cache!.get(rec.url)});
    if(!fallback.complete)throw new Error('GPU_COVERAGE_INCOMPLETE');
    shown.length=0;appendAll(shown,fallback.shown);lodLevel=fallback.lodLevel;
   }
   traceDiagnostic('residency-transition','Transition de couverture calculée',()=>({frame,scope:'cpu/residency-transition',elapsedMs:performance.now()-transitionStarted,from:traceSet('transition.from',drawn.map(page=>page.url)),to:traceSet('transition.to',shown.map(page=>page.url)),requested:traceSet('transition.requested',[...requested]),transition:traceSet('transition.all',[...transition]),slots}));
   if(shown.some(page=>!hasBytes(page)))throw new Error('GPU_COVERAGE_BYTES_MISSING');
   readyScratch.length=0;appendAll(readyScratch,shown);
   let culled:PageRec[]=readyScratch;
   if(visEnabled&&!gpuHiz&&readyScratch.length>=2&&readyScratch.every(page=>page.array)){
    try{
     const cut=applyTemporalHiz(partitionByPass(readyScratch,false,opaqueScratch) as Array<PageRec&{array:Uint32Array}>,camera,viewport??targetSize,temporalHizState);
     culledScratch.length=0;appendAll(culledScratch,cut.shown,partitionByPass(readyScratch,true,transparentScratch));culled=culledScratch;
    }catch(error){diagnosticFailure('hiz-frame-fallback',error);/* Keep the selected cut. */}
   }
   const selectionEnd=performance.now();
   const queueStarted=performance.now();queueResident(coverageBudgetLimited?[]:desired);const queueEnd=performance.now();
   traceDiagnostic('residency-queue-reconstruct','Ensembles de résidence reconstruits',()=>({frame,scope:'cpu/residency-queue-reconstruct',elapsedMs:queueEnd-queueStarted,requested:traceSet('reconstruct.requested',desired.map(page=>page.url)),queued:traceSet('reconstruct.queued',residencyQueue.map(page=>page.url)),job:residencyJob}));
   const drawnVerifyStarted=performance.now();if(culled.some(page=>!cache!.get(page.url)))throw new Error('GPU_COVERAGE_INCOMPLETE');
   drawn.length=0;appendAll(drawn,culled);
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
   publishCpuProfile();
   if(traceEnabled)traceDiagnostic('frame','Snapshot complet de la frame WebGPU',()=>({backend:'webgpu-page-raster',frame,submission:imageRevision,pose:cameraPose(camera),source:gpuSelectionDecision.source,selection:gpuSelectionDecision,cpu:sample,coverage:{loaded:traceSet('frame.loaded',drawn.map(page=>page.url)),wanted:traceSet('frame.wanted',desired.map(page=>page.url)),shown:traceSet('frame.shown',shown.map(page=>page.url)),bootstrap:traceSet('frame.bootstrap',bootstrap.map(page=>page.url)),ready:bootstrapReady},budget:{slots,requested:traceSet('frame.requested',[...new Set([...bootstrapUrls,...desired.map(page=>page.url)])]),limited:coverageBudgetLimited,frameBytes:frameBudget},gpuTiming:gpuTiming?.stats()??{supported:false,reason:'not-initialized'},transparent:{candidates:blendGpu.length,visibleMeshes:visibleBlend.length,frustumRejected:blendFrustumRejected,drawCalls:blendDrawCalls,submittedTriangles:blendSubmittedTriangles},drawCalls:gpuDrawCalls}));

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
   // Material texture layers are part of readiness, not a per-frame decoration: a page drawn before
   // its layer lands is shaded from layer 0, so the image of one camera keeps changing while the
   // queue drains. `render` still admits at most `textureBudget` bytes per frame; the explicit
   // barrier drains the rest here, outside the measured loop, so a flushed pose is settled.
   while(gpuDevice&&textureJobs.length)await pumpTextures();
   await texturePump;
   await ensureBootstrap();
   await pending;
   if(coverageBudgetEvent){engineDiagnostic('coverage-budget','Admission de la coupe demandée',coverageBudgetEvent);coverageBudgetEvent=undefined;}
   await gpuTiming?.flush();
   if(performance.now()-lastProgressMs>=2000){lastProgressMs=performance.now();engineDiagnostic('render-progress','Suivi du rendu GPU',{frame,coverage:{version:1,ready:bootstrapReady,bootstrapPages:bootstrap.length,budgetLimited:coverageBudgetLimited},lights:lightState,selectedPages:shown.length,residentPages:drawn.length,selectedTriangles,submittedTriangles,transparent:{version:1,candidates:blendGpu.length,visibleMeshes:visibleBlend.length,frustumRejected:blendFrustumRejected,drawCalls:blendDrawCalls,submittedTriangles:blendSubmittedTriangles,gpuMs:null},pendingPages:collectPendingUrls(desired,pendingScratch).length,surfaceVersion:surfaces?.version??null,presentation:context.gpuCanvas?'direct':'composed',imageReadbackDuringRender:false});}
   if(gpuSelection){
    try{await gpuSelection.flush();if(gpuSelection.failed())dropGpuSelection();else if(gpuFrameActive)adoptGpuCut();}
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
   const clearHistory=()=>{noOccluderHistory=true;previousHizView=undefined;temporalHizState.pyramid=undefined;temporalHizState.camera=undefined;temporalHizState.viewport=undefined;};
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
  pageUrls(){urlScratch.length=0;const seen=new Set<string>();for(const list of [bootstrap,shown,coverageBudgetLimited?[]:desired])for(let i=0;i<list.length;i++){const url=pageRequestUrl(list[i]);if(seen.has(url))continue;seen.add(url);urlScratch.push(url);}return urlScratch;},
  acceptPage(url,array){deferredDrops.delete(url);const recs=byUrl.get(url);if(!recs)return;
   // One request can carry a whole bundle: each cluster takes the view at its own offset, and that
   // view — not the bundle — is what the GPU cache uploads under the cluster key.
   acceptPageArray(recs,array);
   for(let i=0;i<recs.length;i++){const rec=recs[i],view=rec.array!;sourceBytes.set(rec.url,new Uint8Array(view.buffer,view.byteOffset,view.byteLength));}
   traceDiagnostic('page-accepted','Page CPU acceptée pour résidence GPU',{frame,url,bytes:array.byteLength,clusters:recs.length,bootstrap:recs.some(rec=>bootstrapUrls.has(rec.url)),wanted:recs.some(rec=>residencyWanted.has(rec.url)),pinned:recs.some(rec=>pins.has(rec.url))});},
  dropPage(url){const recs=byUrl.get(url);if(!recs)return;
   // A request is kept whole: dropping it would take away every cluster it carries, so one pinned
   // cluster is enough to refuse or defer the drop.
   if(recs.some(rec=>bootstrapUrls.has(rec.url))){traceDiagnostic('page-drop-deferred','Abandon de page bootstrap ignoré pour préserver la couverture',{frame,url,reason:'bootstrap-pinned'});return;}
   const pinned=recs.some(rec=>pins.has(rec.url)),wanted=recs.some(rec=>residencyWanted.has(rec.url));
   if(pinned||wanted){deferredDrops.add(url);traceDiagnostic('page-drop-deferred','Abandon de page différé pendant la transition de couverture',{frame,url,reason:pinned?'pinned':'wanted',pinned,wanted,deferred:[...deferredDrops]});return;}
   deferredDrops.delete(url);
   for(let i=0;i<recs.length;i++){const rec=recs[i];rec.array=undefined;rec.indexBytes=rec.triangles*12;sourceBytes.delete(rec.url);cache?.unload?.(rec.url);pins.delete(rec.url);}
   traceDiagnostic('page-dropped','Page CPU/GPU libérée',{frame,url,clusters:recs.length,reason:'host-request',deferred:false});},
  metrics(){
   const stats=cache?.stats();
   let vertexBytes=0;for(const buffer of positionBuffers.values())vertexBytes+=buffer.size;
   vertexBytes+=(concatPos?.size??0)+(concatUv?.size??0)+(concatNrm?.size??0);
   for(const item of blendGpu)vertexBytes+=item.index.size+(item.uv?.size??0)+(item.normal?.size??0);

   return {coverageReady:bootstrapReady,coverageBudgetLimited,clusters:gpuFrameActive&&!gpuMetricsReady?null:visible,selectedTriangles:gpuFrameActive&&!gpuMetricsReady?null:selectedTriangles,residentPages:gpuFrameActive?stats?.residentPages??0:drawn.length,cacheEvictions:stats?.evictions??0,geometryAllocationBytes:(stats?.allocatedBytes??0)+vertexBytes,frustumRejected,lodLevel,submittedTriangles:gpuFrameActive&&!gpuMetricsReady?null:submittedTriangles,totalSubmittedTriangles:gpuFrameActive&&!gpuMetricsReady?null:submittedTriangles,transparentMeshes:visibleBlend.length,transparentFrustumRejected:blendFrustumRejected,transparentDrawCalls:blendDrawCalls,transparentSubmittedTriangles:blendSubmittedTriangles,textureUploaded,texturePending:textureJobs.length,textureSkipped,cpuSubmitMs:lastSubmitMs,gpuPassMs:lastGpuPassMs,gpuFrameMs:lastGpuFrameMs,vramBytes:null,drawCalls:gpuDrawCalls};
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
