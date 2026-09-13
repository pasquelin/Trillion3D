import {replicateInstances} from './replicateInstances.ts';
export {replicateInstances} from './replicateInstances.ts';
import {collectClusterPages,collectPendingUrls,indexPagesByUrl,resolvePixelError,selectVisiblePages,trimToBudget,type PageRec} from './pageSelection.ts';
import {assertCacheIdentity,assertFormat,DEFAULT_SCOPE,EngineError} from '../sdk-core/index.ts';
import {detectCapabilities} from './capabilities.ts';
import {checked,loadClusterPages} from './clusterPages.ts';
import {createPageStreamer} from './streamingPages.ts';
import {createComparisonCompositor, type ComparisonLayout} from './comparison.ts';
import {threeLodBackend} from './threeLod.ts';
import {webgpuPagesBackend} from './webgpuPages.ts';
import {createTriangleDiagnosticMaterial,disposeTriangleGeometry,materialSide,triangleGeometry,triangleSalt} from './triangleDiagnostic.ts';
import {EngineProfiler,type TelemetryReport} from './telemetry.ts';
export {EngineProfiler,type TelemetryReport} from './telemetry.ts';

import type {SafetyDecision,RuntimeEvent} from '../sdk-core/index.ts';
import {nextFrame} from './scheduling.ts';
import { FlyControls } from 'three/addons/controls/FlyControls.js';
import { frameStatistics, DIAGNOSTICS, type DiagnosticMode } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { compareImages, summarize } from '../sdk-core/index.ts';

import type {AssetScope,PreparationProgress,CameraPose,StablePreview,FrameMetrics,BackendCapabilities,ClusterManifest} from '../sdk-core/index.ts';
export type {AssetScope,PreparationProgress,CameraPose,StablePreview,FrameMetrics,BackendCapabilities,ClusterManifest} from '../sdk-core/index.ts';
/** Backends share source, camera and output format. No UI delay belongs in render(). */
export interface RenderBackend {
 id:string; capabilities:BackendCapabilities;
 setDiagnostic?(mode:DiagnosticMode):void;
 prepare():Promise<void>;
 render(camera:THREE.PerspectiveCamera):void;
 readonly overBudget:boolean;
 scene:THREE.Scene;
 metrics():Pick<FrameMetrics,'clusters'|'selectedTriangles'|'residentPages'|'geometryAllocationBytes'|'pageEvictions'|'frustumRejected'|'lodLevel'|'submittedTriangles'|'hizRejected'>&{drawCalls?:number};
 pendingUrls?():string[];
 pageUrls?():string[];
 acceptPage?(url:string,array:Uint32Array):void;
 dropPage?(url:string):void;
 syncResident?():void;
 flush?():Promise<void>;
 rasterRgba?():Uint8Array;
 visibilityIds?():Uint32Array;
 dispose():void;
}
export type BackendDiagnostic={phase:string;message:string;context:Record<string,unknown>};
export interface BackendContext { source:THREE.Object3D; metadata:ClusterManifest; indices:Map<string,Uint32Array>; associations:Map<THREE.Object3D,{meshes?:number;primitives?:number}>; signal?:AbortSignal; maxResidentPages?:number; maxCachedPages?:number; pixelError?:number; lodAdaptive?:boolean; clearColor?:number; onDiagnostic?:(diagnostic:BackendDiagnostic)=>void; viewport?:[number,number]; gpuDevice?:GPUDevice }
export type BackendFactory = (context:BackendContext)=>RenderBackend;
export type PointOfInterest={id:string;label:string;pose:CameraPose};
export interface ExplorerOptions {replicaCount?:1|4|9|12;detail?:'source'|'maximum';onEvent?:(event:RuntimeEvent)=>void;manifestUrl:string;scope?:AssetScope; signal?:AbortSignal; width?:number;height?:number;fov?:number;pixelRatio?:number;pageFetchWorkers?:number;onPreparation?:(event:PreparationProgress)=>void;backends?:BackendFactory[];maxResidentPages?:number;maxCachedPages?:number;pixelError?:number;lodAdaptive?:boolean;/** Presentation clear color supplied by the host, encoded as 0xRRGGBB. */clearColor?:number;/** Bounded diagnostics emitted by a backend and owned by the host report. */onDiagnostic?:(diagnostic:BackendDiagnostic)=>void;preload?:'visible'|'all';comparisonLayout?:import('./comparison.ts').ComparisonLayout;comparisonPair?:[string,string];gpu?:GPU;pointsOfInterest?:PointOfInterest[];logInterval?:number;}
/** Perspective framing from a bounding-sphere radius. `near` scales with the asset; there is no absolute centimetre floor. */
export function framingFromBounds(radius:number,aspect:number){
 if(!Number.isFinite(radius)||radius<=0)throw new Error('Empty scene bounds');
 if(!Number.isFinite(aspect)||aspect<=0)throw new Error('Invalid aspect');
 const near=radius/10000,far=radius*20,scale=radius*1.9/Math.min(1,aspect),len=Math.hypot(.85,.65,1);
 return {near,far,offset:[.85*scale/len,.65*scale/len,1*scale/len] as [number,number,number]};
}
const DEFAULT_FOV=55,DEFAULT_PIXEL_RATIO=1,DEFAULT_WIDTH=960,DEFAULT_HEIGHT=540,DEFAULT_PAGE_WORKERS=8,DEFAULT_CACHED_PAGES=16384,DEFAULT_CLEAR_COLOR=0x171d28;
const rgbHex=(red:number,green:number,blue:number)=>`#${[red,green,blue].map(channel=>channel.toString(16).padStart(2,'0')).join('')}`;
/** A bounded evidence record for the final WebGL composition used by captures and reports. */
export function presentationColorDiagnostic(pixels:Uint8Array,width:number,height:number,clearColor:number,surface='webgl-capture-target'){
 const pixel=(x:number,y:number)=>{const offset=(y*width+x)*4;return rgbHex(pixels[offset]??0,pixels[offset+1]??0,pixels[offset+2]??0);};
 const clearHex=`#${clearColor.toString(16).padStart(6,'0')}`;
 const topLeft=pixel(0,0),center=pixel(Math.floor(width/2),Math.floor(height/2));
 return {clearColor:clearHex,topLeft,center,matchesClearAtTopLeft:topLeft===clearHex,surface};
}
const baseCapabilities:BackendCapabilities={renderer:'Three.js WebGL2',materials:'Converted glTF PBR, textures, alpha and double-sided flags preserved; no shadow map',hierarchy:false,gpuDriven:false,simplification:false,eviction:false,unsupported:['general mesh LOD simplification','GPU-driven selection/indirect draw','occlusion culling','bounded GPU eviction','physical VRAM instrumentation']};
function hashId(id:string){let h=0;for(let i=0;i<id.length;i++)h=(Math.imul(h,31)+id.charCodeAt(i))>>>0;return h;}
function clusterColor(id:string,saturation=.75){return new THREE.Color().setHSL((hashId(id)*.61803398875)%1,saturation,.55);}
function lighting(scene:THREE.Scene,clearColor:number){scene.background=new THREE.Color(clearColor);scene.add(new THREE.HemisphereLight(0xffffff,0x495061,2));const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(1,3,2);scene.add(light);}
function objects(source:THREE.Object3D){const meshes:THREE.Mesh[]=[];source.updateMatrixWorld(true);source.traverse(o=>{if((o as THREE.Mesh).isMesh)meshes.push(o as THREE.Mesh);});return meshes;}
function geometryBytes(geometry:THREE.BufferGeometry,seen:Set<ArrayBufferView>){let bytes=0;const index=geometry.getIndex();if(index&&!seen.has(index.array)){seen.add(index.array);bytes+=index.array.byteLength;}for(const name in geometry.attributes){const attr=geometry.attributes[name];if(!attr||seen.has(attr.array))continue;seen.add(attr.array);bytes+=attr.array.byteLength;}return bytes;}
export const referenceBackend:BackendFactory=({source,clearColor=DEFAULT_CLEAR_COLOR})=>{
 const scene=new THREE.Scene();lighting(scene,clearColor);let order=0,residentPages=0,allocationBytes=0,selectedTriangles=0;const seen=new Set<ArrayBufferView>();
 const copies:THREE.Mesh[]=[];const overlays:THREE.Material[]=[];
 for(const mesh of objects(source)){const copy=new THREE.Mesh(mesh.geometry,mesh.material);copy.matrixAutoUpdate=false;copy.matrix.copy(mesh.matrixWorld);copy.renderOrder=order++;copy.userData.sourceGeometry=mesh.geometry;copy.userData.sourceMaterial=mesh.material;scene.add(copy);copies.push(copy);residentPages++;allocationBytes+=geometryBytes(mesh.geometry,seen);}
 const applyDiagnostic=(mode:DiagnosticMode)=>{overlays.splice(0).forEach(m=>m.dispose());for(const mesh of copies){const sourceGeometry=mesh.userData.sourceGeometry as THREE.BufferGeometry;const sourceMaterial=mesh.userData.sourceMaterial as THREE.Material|THREE.Material[];mesh.geometry=sourceGeometry;mesh.material=sourceMaterial;if(mode==='wireframe'){mesh.geometry=triangleGeometry(sourceGeometry,triangleSalt(String(mesh.id)));const material=createTriangleDiagnosticMaterial(materialSide(sourceMaterial));overlays.push(material);mesh.material=material;}}};
 return {id:'three-webgl-reference',capabilities:baseCapabilities,overBudget:false,scene,setDiagnostic:applyDiagnostic,async prepare(){},render(){selectedTriangles=0;for(const mesh of copies){const index=mesh.geometry.getIndex();selectedTriangles+=(index?index.count:mesh.geometry.getAttribute('position').count)/3;}},metrics:()=>({clusters:null,selectedTriangles,residentPages:null,geometryAllocationBytes:allocationBytes,pageEvictions:null,frustumRejected:null,lodLevel:null,submittedTriangles:selectedTriangles}),dispose(){overlays.forEach(m=>m.dispose());for(const mesh of copies)disposeTriangleGeometry(mesh.userData.sourceGeometry as THREE.BufferGeometry);scene.clear();}};
};
type PageBatch={key:number;mesh?:THREE.Mesh;geometry?:THREE.BufferGeometry;index:Uint32Array;attr?:THREE.BufferAttribute;signature:number;attached:boolean};
export const exactPagesBackend:BackendFactory=(context)=>{
 const {source,metadata,indices,associations,maxResidentPages,viewport,clearColor=DEFAULT_CLEAR_COLOR}=context;
 const {roots,allPages,blendCopies,prepared}=collectClusterPages(source,metadata,indices,associations);
 const cap=maxResidentPages??Math.max(1024,prepared),scene=new THREE.Scene();lighting(scene,clearColor);const shown:PageRec[]=[],desired:PageRec[]=[],attached:PageRec[]=[];
 const byUrl=indexPagesByUrl(allPages),pendingScratch:string[]=[],urlScratch:string[]=[],batches=new Map<number,PageBatch>();
 const groups=new Map<number,PageRec[]>(),groupPool:PageRec[][]=[];
 for(const copy of blendCopies){copy.userData.sourceGeometry=copy.geometry;copy.userData.sourceMaterial=copy.material;scene.add(copy);}
 const indexByUrl=new Map<string,THREE.BufferAttribute>();
 for(const rec of allPages)if(rec.array&&!indexByUrl.has(rec.url))indexByUrl.set(rec.url,new THREE.BufferAttribute(rec.array,1));
 let visible=0,selectedTriangles=0,frame=0,evictions=0,overBudget=false,frustumRejected=0,lodLevel=0,diagnostic:DiagnosticMode='beauty';
 const motion:{last?:THREE.Vector3;lastMs?:number}={};
 const diagnosticMaterials=new Map<string,THREE.Material>();
 const materialFor=(rec:PageRec)=>{if(diagnostic==='beauty')return rec.material;
  const side=Array.isArray(rec.material)?rec.material[0].side:rec.material.side;
  if(diagnostic==='wireframe'){const key=`wireframe:${rec.clusterId}`;let material=diagnosticMaterials.get(key);if(!material){material=createTriangleDiagnosticMaterial(side);diagnosticMaterials.set(key,material);}return material;}
  const key=diagnostic==='pages'?(rec.array?'resident':'loading'):diagnostic==='lod'?(rec.role==='coarse'?'coarse':'exact'):diagnostic==='visibility'?'visible':rec.clusterId;
  let material=diagnosticMaterials.get(key);if(!material){
   const color=diagnostic==='pages'?(rec.array?0x34d399:0xfbbf24):diagnostic==='lod'?(rec.role==='coarse'?0xf59e0b:0x38bdf8):diagnostic==='visibility'?0x34d399:diagnostic==='screen-error'?0xf472b6:clusterColor(key,.75);
   material=new THREE.MeshBasicMaterial({color,side});diagnosticMaterials.set(key,material);
  }return material;};
 const minPoint=new THREE.Vector3(),maxPoint=new THREE.Vector3(),metricsSeen=new Set<ArrayBufferView>();
 const paint=(mesh:THREE.Mesh,sourceGeometry:THREE.BufferGeometry,material:THREE.Material|THREE.Material[],salt=0)=>{mesh.material=material;mesh.geometry=diagnostic==='wireframe'?triangleGeometry(sourceGeometry,salt):sourceGeometry;};
 const paintBlend=()=>{for(const copy of blendCopies){const sourceGeometry=copy.userData.sourceGeometry as THREE.BufferGeometry;const sourceMaterial=copy.userData.sourceMaterial as THREE.Material|THREE.Material[];if(diagnostic==='wireframe'){const key=`blend:${copy.uuid}`;let material=diagnosticMaterials.get(key);if(!material){material=createTriangleDiagnosticMaterial(materialSide(sourceMaterial));diagnosticMaterials.set(key,material);}paint(copy,sourceGeometry,material,triangleSalt(copy.uuid));}else paint(copy,sourceGeometry,sourceMaterial);}};
 const release=(rec:PageRec)=>{if(rec.attached&&rec.mesh){scene.remove(rec.mesh);rec.attached=false;}};
 const attach=(rec:PageRec)=>{if(!rec.array)return;if(!indexByUrl.has(rec.url))indexByUrl.set(rec.url,new THREE.BufferAttribute(rec.array,1));if(!rec.mesh){const geometry=new THREE.BufferGeometry();geometry.attributes={...rec.attributes};geometry.setIndex(indexByUrl.get(rec.url)!);minPoint.fromArray(rec.min);maxPoint.fromArray(rec.max);geometry.boundingBox=new THREE.Box3().set(minPoint,maxPoint);geometry.boundingSphere=new THREE.Sphere();geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);const copy=new THREE.Mesh(geometry,materialFor(rec));copy.matrixAutoUpdate=false;copy.matrix.copy(rec.matrix);copy.frustumCulled=false;copy.renderOrder=rec.renderOrder;copy.userData.clusterId=rec.clusterId;copy.userData.lodRole=rec.role??'exact';rec.geometry=geometry;rec.mesh=copy;}else rec.mesh.material=materialFor(rec);if(rec.mesh&&rec.geometry)paint(rec.mesh,rec.geometry,rec.mesh.material,triangleSalt(rec.clusterId));if(!rec.attached){scene.add(rec.mesh!);rec.attached=true;}};
 const disposeGeometry=(geometry:THREE.BufferGeometry)=>{
  disposeTriangleGeometry(geometry);
  for(const name of Object.keys(geometry.attributes))geometry.deleteAttribute(name);
  geometry.dispose();
 };
 const hideBatch=(batch:PageBatch)=>{if(batch.attached&&batch.mesh){scene.remove(batch.mesh);batch.attached=false;}};
 const disposeBatch=(batch:PageBatch)=>{hideBatch(batch);if(batch.geometry)disposeGeometry(batch.geometry);batch.geometry=undefined;batch.mesh=undefined;batch.attr=undefined;};
 const displayList=()=>shown.length?shown:desired;
 const rebuildBatches=()=>{
  for(const list of groups.values()){list.length=0;groupPool.push(list);}
  groups.clear();
  const display=displayList();
  for(let i=0;i<display.length;i++){const rec=display[i];if(!rec.array)continue;const key=rec.renderOrder;let list=groups.get(key);if(!list){list=groupPool.pop()??[];groups.set(key,list);}list.push(rec);}
  for(const [key,batch] of batches)if(!groups.has(key)){disposeBatch(batch);batches.delete(key);}
  for(const [key,recs] of groups){
   const first=recs[0];let signature=(2166136261^recs.length)>>>0;for(let i=0;i<recs.length;i++){signature=(Math.imul(signature^recs[i].id,16777619)^(recs[i].array?.length??0))>>>0;}
   let batch=batches.get(key);if(!batch){batch={key,index:new Uint32Array(0),signature:0,attached:false};batches.set(key,batch);}
   if(!batch.geometry){const geometry=new THREE.BufferGeometry();geometry.attributes={...first.attributes};geometry.boundingBox=new THREE.Box3();geometry.boundingSphere=new THREE.Sphere();batch.geometry=geometry;}
   if(batch.signature!==signature){
    let total=0;for(let i=0;i<recs.length;i++)total+=recs[i].array!.length;
    if(batch.index.length<total){batch.index=new Uint32Array(Math.max(total,batch.index.length<<1||total));batch.attr=undefined;}
    let offset=0;for(let i=0;i<recs.length;i++){const array=recs[i].array!;batch.index.set(array,offset);offset+=array.length;}
    if(!batch.attr||batch.attr.array.length!==total){batch.attr=new THREE.BufferAttribute(batch.index.subarray(0,total),1);batch.geometry.setIndex(batch.attr);}
    else{batch.attr.needsUpdate=true;}
    batch.geometry.setDrawRange(0,total);
    minPoint.fromArray(first.min);maxPoint.fromArray(first.max);
    for(let i=1;i<recs.length;i++){const rec=recs[i];minPoint.x=Math.min(minPoint.x,rec.min[0]);minPoint.y=Math.min(minPoint.y,rec.min[1]);minPoint.z=Math.min(minPoint.z,rec.min[2]);maxPoint.x=Math.max(maxPoint.x,rec.max[0]);maxPoint.y=Math.max(maxPoint.y,rec.max[1]);maxPoint.z=Math.max(maxPoint.z,rec.max[2]);}
    batch.geometry.boundingBox!.set(minPoint,maxPoint);batch.geometry.boundingBox!.getBoundingSphere(batch.geometry.boundingSphere!);
    batch.signature=signature;
   }
   if(!batch.mesh){const copy=new THREE.Mesh(batch.geometry,materialFor(first));copy.matrixAutoUpdate=false;copy.matrix.copy(first.matrix);copy.frustumCulled=false;copy.renderOrder=first.renderOrder;copy.userData.clusterId=String(key);copy.userData.lodRole='exact';batch.mesh=copy;}
   else batch.mesh.material=materialFor(first);
   paint(batch.mesh,batch.geometry,batch.mesh.material,triangleSalt(String(key)));
   if(!batch.attached){scene.add(batch.mesh);batch.attached=true;}
  }
 };
 const syncResident=()=>{
  const display=displayList();
  for(let i=0;i<attached.length;i++)attached[i].resident=false;
  for(let i=0;i<display.length;i++)if(display[i].array)display[i].resident=true;
  let write=0;
  for(let i=0;i<attached.length;i++){
   const rec=attached[i];
   if(!rec.resident){if(rec.attached)release(rec);evictions++;continue;}
   rec.resident=false;attached[write++]=rec;
  }
  attached.length=write;
  for(let i=0;i<display.length;i++){
   const rec=display[i];if(!rec.array)continue;
   if(rec.resident){rec.resident=false;attached.push(rec);}
   if(diagnostic==='beauty'){if(rec.attached)release(rec);}else attach(rec);
  }
  if(diagnostic==='beauty')rebuildBatches();else for(const batch of batches.values())hideBatch(batch);
 };
 return {setDiagnostic(mode){diagnostic=mode;paintBlend();syncResident();},id:'exact-cluster-pages',capabilities:{...baseCapabilities,hierarchy:true,eviction:true,unsupported:baseCapabilities.unsupported.filter(item=>item!=='bounded GPU eviction')},scene,async prepare(){},
  get overBudget(){return overBudget;},
  render(camera){overBudget=false;frame++;const selected=selectVisiblePages(roots,camera,{pixelError:resolvePixelError(context,camera,motion),viewport,frame,holdResident:true},shown);desired.length=0;for(let i=0;i<(selected.wanted?.length??0);i++)desired.push(selected.wanted![i]);const trimmed=trimToBudget(selected.shown,cap);overBudget=trimmed.overBudget;visible=selected.visible;selectedTriangles=selected.selectedTriangles;frustumRejected=selected.frustumRejected;lodLevel=selected.lodLevel;if(trimmed.shown!==shown){shown.length=0;shown.push(...trimmed.shown);}syncResident();},
  pendingUrls(){return collectPendingUrls(desired.length?desired:shown,pendingScratch);},
  pageUrls(){urlScratch.length=0;const seen=new Set<string>();for(const list of [shown,desired])for(let i=0;i<list.length;i++){const url=list[i].url;if(seen.has(url))continue;seen.add(url);urlScratch.push(url);}return urlScratch;},
  acceptPage(url,array){const recs=byUrl.get(url);if(!recs)return;if(!indexByUrl.has(url))indexByUrl.set(url,new THREE.BufferAttribute(array,1));for(let i=0;i<recs.length;i++){recs[i].array=array;recs[i].indexBytes=array.byteLength;}},
  dropPage(url){const recs=byUrl.get(url);if(!recs)return;indexByUrl.delete(url);for(let i=0;i<recs.length;i++){const rec=recs[i];rec.array=undefined;rec.indexBytes=rec.triangles*12;if(rec.geometry){disposeGeometry(rec.geometry);rec.geometry=undefined;}if(rec.attached&&rec.mesh){scene.remove(rec.mesh);rec.attached=false;}rec.mesh=undefined;}},
  syncResident,
  metrics(){metricsSeen.clear();let bytes=0;if(diagnostic==='beauty'){for(const batch of batches.values())if(batch.geometry)bytes+=geometryBytes(batch.geometry,metricsSeen);}else{for(const rec of attached)if(rec.geometry)bytes+=geometryBytes(rec.geometry,metricsSeen);}
   let draws=blendCopies.length,submitted=0;if(diagnostic==='beauty'){for(const batch of batches.values())if(batch.attached){draws++;submitted+=(batch.geometry?.drawRange.count??0)/3;}}else{for(let i=0;i<attached.length;i++)if(attached[i].attached){draws++;submitted+=attached[i].triangles;}}
   return {clusters:visible,selectedTriangles,residentPages:attached.length,pageEvictions:evictions,geometryAllocationBytes:bytes,frustumRejected,lodLevel,submittedTriangles:submitted,drawCalls:draws};},
  dispose(){diagnosticMaterials.forEach(m=>m.dispose());for(const batch of batches.values())disposeBatch(batch);batches.clear();groups.clear();groupPool.length=0;for(const rec of allPages){if(rec.attached)release(rec);if(rec.geometry)disposeGeometry(rec.geometry);rec.geometry=undefined;rec.mesh=undefined;}for(const copy of blendCopies)disposeTriangleGeometry(copy.userData.sourceGeometry as THREE.BufferGeometry);scene.clear();}};
};
export const DEFAULT_BACKENDS:BackendFactory[]=[referenceBackend,exactPagesBackend,threeLodBackend];
async function jsonResource(url:string,signal?:AbortSignal):Promise<{value:Record<string,unknown>;details:{url:string;status:number;contentType:string}}>{
 const response=await checked(url,signal),contentType=response.headers.get('content-type')??'';
 const details={url,status:response.status,contentType};
 if(!/^application\/(?:[\w.-]+\+)?json(?:;|$)/i.test(contentType))throw new EngineError('INVALID_JSON_RESPONSE',`${url}: JSON attendu, HTTP ${response.status}, type ${contentType||'absent'}`,details);
 let value:unknown;try{value=await response.json();}catch{throw new EngineError('INVALID_JSON_RESPONSE',`${url}: JSON invalide, HTTP ${response.status}, type ${contentType}`,details);}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new EngineError('INVALID_JSON_RESPONSE',`${url}: objet JSON attendu, HTTP ${response.status}, type ${contentType}`,details);
 return {value:value as Record<string,unknown>,details};
}
function disposeSource(source:THREE.Object3D){const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();for(const mesh of objects(source)){geometries.add(mesh.geometry);for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){materials.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);}}geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>{t.dispose();const image=t.source.data as {close?:()=>void};image?.close?.();});}
export async function createExplorer(canvas:HTMLCanvasElement,options:ExplorerOptions){
 const emit=(event:RuntimeEvent)=>{try{options.onEvent?.(event);}catch{/* Diagnostic observers cannot interrupt rendering. */}};
 const preparationStart=performance.now();const {signal}=options,scope=options.scope??DEFAULT_SCOPE;const progress=(phase:string,completed:number,total:number,message:string)=>{signal?.throwIfAborted();options.onPreparation?.({phase,completed,total,message});};
 progress('manifest',0,1,'Lecture du cache');
 const {manifestUrl}=options;const pointerResource=await jsonResource(manifestUrl,signal),pointer=pointerResource.value;if(typeof pointer.status!=='string'||typeof pointer.url!=='string'||!pointer.url)throw new EngineError('INVALID_POINTER',`${manifestUrl}: manifeste sans status/url valides, HTTP ${pointerResource.details.status}, type ${pointerResource.details.contentType}`,pointerResource.details);if(pointer.status!=='ready')throw new EngineError('CACHE_NOT_READY','The preparation pointer is not ready');if(pointer.scope!==undefined&&pointer.scope!==scope)throw new EngineError('SCOPE_MISMATCH',`Requested ${scope}, pointer contains ${pointer.scope}`,{requestedScope:scope,pointerScope:pointer.scope});
 const metadataUrl=new URL(pointer.url,new URL(manifestUrl,location.href)).href;const metadataResource=await jsonResource(metadataUrl,signal),value=metadataResource.value;if(!Array.isArray(value.primitives)||!Array.isArray(value.selectedNodes)||typeof value.selectedTriangles!=='number')throw new EngineError('INVALID_CACHE',`${metadataUrl}: schéma du cache invalide, HTTP ${metadataResource.details.status}, type ${metadataResource.details.contentType}`,metadataResource.details);const metadata=value as unknown as ClusterManifest;assertFormat(metadata.formatVersion??metadata.schema);assertCacheIdentity(metadata);if(metadata.schema!==1||metadata.status!=='ready')throw new EngineError('INVALID_CACHE','Unsupported Web Geometry cache');if(metadata.scope!==scope)throw new EngineError('SCOPE_MISMATCH',`Requested ${scope}, cache contains ${metadata.scope}`,{requestedScope:scope,cacheScope:metadata.scope});
 const base=new URL('.',new URL(pointer.url,new URL(manifestUrl,location.href))).href;
 let source:THREE.Object3D|undefined,renderer:THREE.WebGLRenderer|undefined,gpuDevice:GPUDevice|undefined,measurementTarget:THREE.WebGLRenderTarget|undefined,captureTarget:THREE.WebGLRenderTarget|undefined;const backends:RenderBackend[]=[];
 const disposeTargets=()=>{measurementTarget?.dispose();captureTarget?.dispose();measurementTarget=undefined;captureTarget=undefined;};
 try{
  progress('scene',0,1,`Chargement de ${metadata.selectedTriangles.toLocaleString()} triangles (${scope})`);
  const manager=new THREE.LoadingManager();manager.onProgress=(_url,loaded,total)=>{if(!signal?.aborted)options.onPreparation?.({phase:'resources',completed:loaded,total,message:`Ressource chargée : ${decodeURIComponent(_url.split('/').at(-1) ?? _url)}`});};
  // GLTFLoader has no AbortSignal in this Three version; dispose late results after loading settles.
  const gltf=await new GLTFLoader(manager).loadAsync(new URL('source.gltf',base).href);source=gltf.scene;signal?.throwIfAborted();source=replicateInstances(source,gltf.parser.associations as BackendContext['associations'],options.replicaCount??1);
  const pages=[...new Map(metadata.primitives.flatMap(p=>p.pages).map(p=>[p.url,p])).values()];
  const exactPages=pages.filter(page=>(page.role??'exact')!=='coarse');
  const preload=options.preload??'visible';
  const attachCap=options.maxResidentPages??Math.max(1024,exactPages.length*(options.replicaCount??1));
  const cacheCap=options.maxCachedPages??Math.max(8192,Math.min(attachCap,DEFAULT_CACHED_PAGES));
  const streamer=createPageStreamer(pages,base,signal,options.pageFetchWorkers??DEFAULT_PAGE_WORKERS,cacheCap,url=>{for(const b of backends)b.dropPage?.(url);});
  let loaded=0,pageBytesRead=0;
  const indices=new Map<string,Uint32Array>();
  if(preload==='all'){const all=await loadClusterPages(pages,base,signal,(completed,total)=>progress('pages',completed,total,'Lecture et vérification des pages exactes et LOD'),options.pageFetchWorkers??DEFAULT_PAGE_WORKERS);for(const [url,array] of all.indices)indices.set(url,array);loaded=all.loaded;pageBytesRead=all.pageBytesRead;}
  else progress('pages',0,pages.length,'Hiérarchie prête · pages à la demande');
  const capabilities=await detectCapabilities('webgl',canvas);if(!capabilities.renderer){emit({eventVersion:1,type:'fatal',audience:'blocking',recovered:false,code:'NO_WEBGL2',detail:capabilities.reason});throw new Error(capabilities.reason);}emit({eventVersion:1,type:'capability',audience:'diagnostic',recovered:true,code:'WEBGL2_BASELINE',detail:capabilities.reason});
  const wantsWebgpu=!options.backends||options.backends.includes(webgpuPagesBackend);
  try{if(wantsWebgpu){const gpu=options.gpu??(typeof navigator==='undefined'?undefined:navigator.gpu);if(gpu){const gpuCaps=await detectCapabilities('webgpu',canvas,{gpu});if(gpuCaps.renderer)emit({eventVersion:1,type:'capability',audience:'diagnostic',recovered:true,code:'WEBGPU_AVAILABLE',detail:gpuCaps.reason});if(gpuCaps.adapter){const features:GPUFeatureName[]=[];if(gpuCaps.adapter.features.has('indirect-first-instance'))features.push('indirect-first-instance');gpuDevice=await gpuCaps.adapter.requestDevice(features.length?{requiredFeatures:features}:undefined);}}}}catch{/* WebGPU stays optional; the WebGL2 backends remain the default path. */}
  renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,preserveDrawingBuffer:false});renderer.setPixelRatio(options.pixelRatio??DEFAULT_PIXEL_RATIO);renderer.setSize(options.width??DEFAULT_WIDTH,options.height??DEFAULT_HEIGHT,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  if(options.detail==='maximum'){const maximum=renderer.capabilities.getMaxAnisotropy();for(const mesh of objects(source))for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])for(const value of Object.values(material))if(value instanceof THREE.Texture){value.anisotropy=maximum;value.needsUpdate=true;}}
  const viewport:[number,number]=[options.width??DEFAULT_WIDTH,options.height??DEFAULT_HEIGHT];
  const context:BackendContext={source,metadata,indices,associations:gltf.parser.associations as BackendContext['associations'],signal,maxResidentPages:attachCap,maxCachedPages:cacheCap,pixelError:options.pixelError??0,lodAdaptive:options.lodAdaptive,clearColor:options.clearColor??DEFAULT_CLEAR_COLOR,onDiagnostic:options.onDiagnostic,viewport,gpuDevice};
  const factories=options.backends??(gpuDevice?[...DEFAULT_BACKENDS,webgpuPagesBackend]:DEFAULT_BACKENDS);
  for(const factory of factories){
   const backend=factory(context);if(backends.some(b=>b.id===backend.id))throw new Error('Duplicate backend id');
   try{await backend.prepare();backends.push(backend);}
   catch(error){
    backend.dispose();
    if(backend.id==='webgpu-page-raster'){emit({eventVersion:1,type:'fallback',audience:'diagnostic',recovered:true,code:'WEBGPU_UNAVAILABLE',detail:String(error)});continue;}
    throw error;
   }
  }
  if(preload!=='all')indices.clear();
  if(!backends.length)throw new Error('No backend');
  const bounds=new THREE.Box3();for(const mesh of objects(source))bounds.expandByObject(mesh);const center=bounds.getCenter(new THREE.Vector3()),radius=bounds.getSize(new THREE.Vector3()).length()/2;
  if(!Number.isFinite(radius)||radius<=0)throw new Error('Empty scene bounds');
  const framing=framingFromBounds(radius,canvas.width/canvas.height);
  const camera=new THREE.PerspectiveCamera(options.fov??DEFAULT_FOV,canvas.width/canvas.height,framing.near,framing.far);const homeOffset=new THREE.Vector3().fromArray(framing.offset);camera.position.copy(center).add(homeOffset);camera.lookAt(center);camera.updateMatrixWorld();
  let fallbackReason:string|null=null;const baseline=backends.find(b=>b.id==='three-webgl-reference')??backends[0];const optimized=backends.find(b=>b.id==='exact-cluster-pages')??backends.find(b=>b.id==='webgpu-page-raster')??baseline;let active=optimized,disposed=false,diagnostic:DiagnosticMode='beauty';const beautyMaterials=new Map<THREE.Mesh,THREE.Material|THREE.Material[]>(),overlays:THREE.Material[]=[],hostedControls:{dispose():void}[]=[];const ownedRenderer=renderer;let measuring=false;const capturePool=[new Uint8Array(0),new Uint8Array(0),new Uint8Array(0)];let captureSlot=0;
  const lookAtTarget=new THREE.Vector3();
  let comparisonLayout:ComparisonLayout=options.comparisonLayout??'single',comparisonPair:[string,string]=options.comparisonPair??[baseline.id,backends.find(b=>b.id==='exact-cluster-pages')?.id??backends[backends.length-1].id],wipe=.5,toggle:0|1=0;
  let pairTargetA:THREE.WebGLRenderTarget|undefined,pairTargetB:THREE.WebGLRenderTarget|undefined;const compositor=createComparisonCompositor(ownedRenderer);
  const metricsScratch:FrameMetrics={rafIntervalMs:null,cpuFrameMs:0,cpuSubmitMs:null,gpuMs:null,drawCalls:0,triangles:0,clusters:null,selectedTriangles:null,residentPages:null,geometryAllocationBytes:null,vramBytes:null,pageLoads:loaded,pageBytesRead};
  const profiler=new EngineProfiler();
  profiler.setMetadata(metadata);
  if(options.logInterval&&options.logInterval>0)profiler.startAutoLog(options.logInterval);
  const targetOptions={type:THREE.UnsignedByteType,colorSpace:THREE.SRGBColorSpace};
  const ensureTarget=(current:THREE.WebGLRenderTarget|undefined)=>current??new THREE.WebGLRenderTarget(canvas.width,canvas.height,targetOptions);
  const check=()=>{if(disposed)throw new Error('Explorer disposed');signal?.throwIfAborted();};
  const setPose=(pose:CameraPose)=>{camera.position.fromArray(pose.position);camera.fov=pose.fov;camera.near=pose.near;camera.far=pose.far;camera.lookAt(lookAtTarget.fromArray(pose.target));camera.updateProjectionMatrix();camera.updateMatrixWorld();};
  const fillMetrics=(backend:RenderBackend)=>{const backendMetrics=backend.metrics() as FrameMetrics;const stream=streamer.stats();metricsScratch.clusters=backendMetrics.clusters;metricsScratch.selectedTriangles=backendMetrics.selectedTriangles;metricsScratch.residentPages=backendMetrics.residentPages;metricsScratch.pageEvictions=backendMetrics.pageEvictions??null;metricsScratch.geometryAllocationBytes=backendMetrics.geometryAllocationBytes;metricsScratch.frustumRejected=backendMetrics.frustumRejected??null;metricsScratch.lodLevel=backendMetrics.lodLevel??null;metricsScratch.submittedTriangles=backendMetrics.submittedTriangles??null;metricsScratch.hizRejected=backendMetrics.hizRejected??null;metricsScratch.pageLoads=stream.loaded||loaded;metricsScratch.pageBytesRead=stream.bytesRead||pageBytesRead;metricsScratch.pagesRequested=stream.requested;metricsScratch.pagesLoading=stream.loading;metricsScratch.cacheHits=stream.hits;metricsScratch.cacheMisses=stream.misses;metricsScratch.cpuSubmitMs=backendMetrics.cpuSubmitMs??null;metricsScratch.gpuMs=backendMetrics.gpuMs??null;metricsScratch.vramBytes=backendMetrics.vramBytes??null;metricsScratch.drawCalls=typeof backendMetrics.drawCalls==='number'?backendMetrics.drawCalls:-1;};
  let streamingPromise:Promise<void>|null=null;const queuedFetch:string[]=[];
  const acceptCached=(backend:RenderBackend,missing:readonly string[])=>{
   let acceptedAny=false;
   for(let i=0;i<missing.length;i++){
    const url=missing[i],cached=streamer.get(url);
    if(cached){backend.acceptPage?.(url,cached);acceptedAny=true;}
   }
   if(acceptedAny)backend.syncResident?.();
   return acceptedAny;
  };
  const startFetch=(urls:string[])=>{
   if(!urls.length||measuring)return;
   streamingPromise=streamer.request(urls).then(()=>{
    for(const url of urls){
     const array=streamer.get(url);
     if(array)for(const b of backends)b.acceptPage?.(url,array);
    }
    for(const b of backends)b.syncResident?.();
   }).catch(()=>{/* Retried on next frame */}).finally(()=>{
    streamingPromise=null;
    if(queuedFetch.length&&!measuring){
     const next=queuedFetch.splice(0,queuedFetch.length).filter(url=>!streamer.has(url)&&!streamer.loading(url));
     if(next.length)startFetch(next);
    }
   });
  };
  const drawBackend=(backend:RenderBackend,target:THREE.WebGLRenderTarget|null)=>{
   backend.render(camera);
   let missing=backend.pendingUrls?.()??[];
   if(missing.length>0){
    if(acceptCached(backend,missing))missing=backend.pendingUrls?.()??[];
    const needFetch=missing.filter(url=>!streamer.has(url)&&!streamer.loading(url));
    if(needFetch.length>0){
     if(!measuring&&!streamingPromise)startFetch(needFetch);
     else if(!measuring&&streamingPromise)for(const url of needFetch)if(!queuedFetch.includes(url))queuedFetch.push(url);
    }
   }
   const visibleUrls=backend.pageUrls?.();
   if(visibleUrls)streamer.retain(visibleUrls);
   ownedRenderer.setRenderTarget(target);
   if(backend.overBudget&&backend!==baseline){if(measuring)throw new EngineError('PAGE_BUDGET','Visible pages exceed the resident budget; no incomplete surface is rendered');fallbackReason='Visible pages exceed resident budget';active=baseline;baseline.render(camera);ownedRenderer.render(baseline.scene,camera);emit({eventVersion:1,type:'fallback',audience:'diagnostic',recovered:true,code:'PAGE_BUDGET',detail:fallbackReason});return;}
   ownedRenderer.render(backend.scene,camera);
  };
  const render=(pose?:CameraPose):FrameMetrics=>{
   check();const start=performance.now();if(pose)setPose(pose);
   try{
    if(comparisonLayout==='single'||measuring)drawBackend(active,measuring?(measurementTarget=ensureTarget(measurementTarget)):null);
    else{
     const left=backends.find(b=>b.id===comparisonPair[0])??active,right=backends.find(b=>b.id===comparisonPair[1])??active;
     pairTargetA=ensureTarget(pairTargetA);pairTargetB=ensureTarget(pairTargetB);
     drawBackend(left,pairTargetA);drawBackend(right,pairTargetB);
     compositor.render(pairTargetA.texture,pairTargetB.texture,comparisonLayout,wipe,toggle);
    }
   }catch(error){
    if(measuring||diagnostic!=='beauty')throw error;
    if(ownedRenderer.getContext().isContextLost()){fallbackReason='Context lost: host must retain a stable preview and recreate the renderer';emit({eventVersion:1,type:'fatal',audience:'blocking',recovered:false,code:'CONTEXT_LOST',detail:fallbackReason});throw error;}
    if(active===baseline)throw error;
    fallbackReason=`Backend error: ${String(error)}`;active=baseline;
    try{active.render(camera);ownedRenderer.render(active.scene,camera);}
    catch(fatal){emit({eventVersion:1,type:'fatal',audience:'blocking',recovered:false,code:'BASELINE_FAILED',detail:String(fatal)});throw fatal;}
    emit({eventVersion:1,type:'fallback',audience:'diagnostic',recovered:true,code:'BACKEND_ERROR',detail:fallbackReason});
   }
   fillMetrics(active);metricsScratch.cpuFrameMs=performance.now()-start;if(metricsScratch.drawCalls<0)metricsScratch.drawCalls=ownedRenderer.info.render.calls;metricsScratch.triangles=metricsScratch.submittedTriangles??ownedRenderer.info.render.triangles;profiler.record(metricsScratch);return metricsScratch;
  };
  const presentationDiagnostics=new Set<string>(),visiblePresentationDiagnostics=new Set<string>();
  const logVisiblePresentation=()=>{if(visiblePresentationDiagnostics.has(active.id)||ownedRenderer.getRenderTarget()!==null)return;visiblePresentationDiagnostics.add(active.id);const pixel=new Uint8Array(4);try{const gl=ownedRenderer.getContext();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);options.onDiagnostic?.({phase:'visible-presentation',message:'Premier relevé du framebuffer WebGL visible',context:{engine:active.id,...presentationColorDiagnostic(pixel,1,1,options.clearColor??DEFAULT_CLEAR_COLOR,'default-webgl-framebuffer')}});}catch(error){options.onDiagnostic?.({phase:'visible-presentation',message:'Lecture du framebuffer WebGL visible indisponible',context:{engine:active.id,error:String(error),surface:'default-webgl-framebuffer'}});}};
  const capture=()=>{check();logVisiblePresentation();const previous=ownedRenderer.getRenderTarget();captureTarget=ensureTarget(captureTarget);try{ownedRenderer.setRenderTarget(captureTarget);active.render(camera);ownedRenderer.render(active.scene,camera);const size=canvas.width*canvas.height*4;captureSlot=(captureSlot+1)%3;if(capturePool[captureSlot].length!==size)capturePool[captureSlot]=new Uint8Array(size);const pixels=capturePool[captureSlot];ownedRenderer.readRenderTargetPixels(captureTarget,0,0,canvas.width,canvas.height,pixels);if(!presentationDiagnostics.has(active.id)){presentationDiagnostics.add(active.id);options.onDiagnostic?.({phase:'presentation-capture',message:'Premier relevé de la composition finale WebGL',context:{engine:active.id,...presentationColorDiagnostic(pixels,canvas.width,canvas.height,options.clearColor??DEFAULT_CLEAR_COLOR)}});}return pixels;}finally{ownedRenderer.setRenderTarget(previous);}};
  const dispose=()=>{if(disposed)return;disposed=true;profiler.dispose();hostedControls.splice(0).forEach(c=>{try{c.dispose();}catch{/* Hosted controls cannot block explorer teardown. */}});disposeTargets();pairTargetA?.dispose();pairTargetB?.dispose();compositor.dispose();streamer.dispose();overlays.forEach(m=>m.dispose());backends.forEach(b=>b.dispose());disposeSource(source!);ownedRenderer.dispose();ownedRenderer.forceContextLoss();try{gpuDevice?.destroy();}catch{/* Device may already be lost. */}};
  const flush=async()=>{check();if(streamingPromise)await streamingPromise;for(const backend of backends)await backend.flush?.();};
  const awaitPages=async()=>{check();if(streamingPromise)await streamingPromise;for(const backend of backends){backend.render(camera);const missing=backend.pendingUrls?.()??[];if(missing.length){await streamer.request(missing);for(const url of missing){const array=streamer.get(url);if(array)backend.acceptPage?.(url,array);}if(backend.syncResident)backend.syncResident();else backend.render(camera);}const urls=backend.pageUrls?.();if(urls)streamer.retain(urls);await backend.flush?.();}loaded=streamer.stats().loaded;pageBytesRead=streamer.stats().bytesRead;};
  progress('ready',1,1,'Explorateur prêt');
  if(typeof window!=='undefined'){
   (window as unknown as {__webGeometry:unknown}).__webGeometry={
    profiler,
    getReport:()=>profiler.getReport(),
    printReport:()=>profiler.printReport(),
    enableAutoLog:(sec=2)=>profiler.startAutoLog(sec),
    disableAutoLog:()=>profiler.stopAutoLog(),
   };
  }
  return {capabilities,get fallbackReason(){return fallbackReason;},applySafetyDecision(decision:SafetyDecision,optimizedId:string){check();if(!decision.enabled){active=baseline;fallbackReason=decision.reason;emit({eventVersion:1,type:'optimization',audience:'diagnostic',recovered:true,code:'BASELINE_SELECTED',detail:decision.reason});}else{const candidate=backends.find(b=>b.id===optimizedId);if(!candidate)throw new Error('Unknown optimized backend');active=candidate;fallbackReason=null;}},preparationMs:performance.now()-preparationStart,camera,center,bounds,metadata,backends,canvas,render,capture,dispose,setPose,awaitPages,flush,
   resize(width:number,height:number){check();if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw new Error("Invalid viewport size");ownedRenderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();viewport[0]=width;viewport[1]=height;measurementTarget?.setSize(width,height);captureTarget?.setSize(width,height);pairTargetA?.setSize(width,height);pairTargetB?.setSize(width,height);},
   select(id:string){check();if((diagnostic==='clusters'||diagnostic==='pages'||diagnostic==='lod'||diagnostic==='visibility'||diagnostic==='screen-error')&&id!=='exact-cluster-pages'&&id!=='three-lod'&&id!=='webgpu-page-raster')throw new Error('Reference has no clusters; switch to beauty first');const selected=backends.find(b=>b.id===id);if(!selected)throw new Error(`Unknown backend: ${id}`);active=selected;},
   setComparison(layout:ComparisonLayout,pair?:[string,string],nextWipe?:number,nextToggle?:0|1){check();comparisonLayout=layout;if(pair)comparisonPair=pair;if(nextWipe!==undefined)wipe=nextWipe;if(nextToggle!==undefined)toggle=nextToggle;},
   get comparison(){return {layout:comparisonLayout,pair:comparisonPair,wipe,toggle};},
   setPixelError(value:number){check();if(!Number.isFinite(value)||value<0)throw new Error('Invalid pixelError');context.pixelError=value;},
   pointsOfInterest():Array<PointOfInterest>{const home=this.homePose();const extras=(options.pointsOfInterest??[]).filter(point=>point&&typeof point.id==='string'&&typeof point.label==='string'&&point.pose);return [{id:'home',label:'Home',pose:home},...extras];},
   resetHome(){check();camera.position.copy(center).add(homeOffset);camera.lookAt(center);camera.updateMatrixWorld();},
   restoreAfterCampaign(id:string,saved:THREE.PerspectiveCamera){if(disposed)return;measuring=false;ownedRenderer.setRenderTarget(null);active=backends.find(b=>b.id===id)!;camera.copy(saved);},
   setMeasurementSurface(enabled:boolean){check();measuring=enabled;if(!enabled)ownedRenderer.setRenderTarget(null);},
   get backend(){return active.id;},
   get diagnostic(){return diagnostic;},
   diagnostics:DIAGNOSTICS,
   setDiagnostic(mode:DiagnosticMode){check();if(!DIAGNOSTICS[mode].available)throw new Error(DIAGNOSTICS[mode].reason);if((mode==='clusters'||mode==='pages'||mode==='lod'||mode==='visibility'||mode==='screen-error')&&active.id==='three-webgl-reference')throw new Error('Reference has no clusters');
    for(const [mesh,material] of beautyMaterials)mesh.material=material;overlays.splice(0).forEach(m=>m.dispose());
    for(const backend of backends){if(backend.setDiagnostic){backend.setDiagnostic(mode);continue;}backend.scene.traverse(o=>{if(!(o as THREE.Mesh).isMesh)return;const mesh=o as THREE.Mesh;if(!beautyMaterials.has(mesh))beautyMaterials.set(mesh,mesh.material);if(!mesh.userData.sourceGeometry)mesh.userData.sourceGeometry=mesh.geometry;mesh.material=beautyMaterials.get(mesh)!;mesh.geometry=mesh.userData.sourceGeometry as THREE.BufferGeometry;
     if(mode==='wireframe'){mesh.geometry=triangleGeometry(mesh.userData.sourceGeometry as THREE.BufferGeometry,triangleSalt(String(mesh.userData.clusterId??mesh.id)));const material=createTriangleDiagnosticMaterial(materialSide(mesh.material));overlays.push(material);mesh.material=material;return;}
     if(mode!=='beauty'){const originals=Array.isArray(mesh.material)?mesh.material:[mesh.material];mesh.material=originals.map(original=>{if(mode==='clusters'&&mesh.userData.clusterId){const basic=new THREE.MeshBasicMaterial({color:clusterColor(String(mesh.userData.clusterId),.75),side:original.side});overlays.push(basic);return basic;}const material=original.clone();overlays.push(material);return material;});if(mesh.material.length===1)mesh.material=mesh.material[0];}});}diagnostic=mode;
   },
   homePose():CameraPose{return {position:camera.position.toArray() as CameraPose['position'],target:center.toArray() as CameraPose['target'],fov:camera.fov,near:camera.near,far:camera.far};},
   flyControls(){const controls=new FlyControls(camera,canvas);controls.movementSpeed=radius/4;controls.rollSpeed=.4;controls.dragToLook=true;hostedControls.push(controls);return controls;},
   controls(){const controls=new OrbitControls(camera,canvas);controls.target.copy(center);controls.enableDamping=false;controls.update();hostedControls.push(controls);return controls;},
   profiler,
   getReport():TelemetryReport{return profiler.getReport();},
   printReport(){profiler.printReport();},
   enableAutoLog(intervalSeconds=2){return profiler.startAutoLog(intervalSeconds);},
   disableAutoLog(){profiler.stopAutoLog();},
  };
 }catch(error){disposeTargets();backends.forEach(b=>b.dispose());if(source)disposeSource(source);renderer?.dispose();try{gpuDevice?.destroy();}catch{/* Device may already be lost. */}throw error;}
}
export type Explorer=Awaited<ReturnType<typeof createExplorer>>;
/** Caller supplies immutable poses: every backend gets exactly the same trajectory. */
export async function runCameraPath(explorer:Explorer,path:readonly CameraPose[],options:{backendIds?:string[];warmup?:number;signal?:AbortSignal;onPreparation?:(event:PreparationProgress)=>void;onPreview?:(preview:StablePreview)=>void}={}){
 if(explorer.diagnostic!=='beauty')throw new Error('Campaign requires beauty mode');
 if(!path.length||path.length>6000)throw new Error('Path must contain 1..6000 poses');const warmup=options.warmup??4;if(!Number.isInteger(warmup)||warmup<0||warmup>600)throw new Error('Invalid warmup');
 const ids=options.backendIds??explorer.backends.map(b=>b.id);if(ids.length<2||new Set(ids).size!==ids.length||ids.some(id=>!explorer.backends.some(b=>b.id===id)))throw new Error('Select at least two unique available backends');
 const campaignSignal=options.signal??new AbortController().signal;
 const savedBackend=explorer.backend,savedCamera=explorer.camera.clone();explorer.setMeasurementSurface(true);
 try{
 const blocks:Array<{backend:string;frames:FrameMetrics[];cpu:ReturnType<typeof summarize>;cadence:ReturnType<typeof frameStatistics>}> = [],quality:Array<{backend:string;pose:number;foreground:number;repeat:ReturnType<typeof compareImages>;image:ReturnType<typeof compareImages>}> = [];
 const notify=(phase:string,completed:number,total:number,message:string)=>{campaignSignal.throwIfAborted();options.onPreparation?.({phase,completed,total,message});};
 // Exact A/A/candidate gate at every measured pose. No image capture during timed blocks.
 for(let i=0;i<path.length;i++){
  notify('verify',i,path.length,'Comparaison exacte des pixels');explorer.select(ids[0]);explorer.setPose(path[i]);const a=explorer.capture(),aa=explorer.capture();const repeat=compareImages(a,aa);let foreground=0;for(let pixel=0;pixel<a.length;pixel+=4)if(a[pixel]!==a[0]||a[pixel+1]!==a[1]||a[pixel+2]!==a[2])foreground++;
  if(i===0)options.onPreview?.({scope:explorer.metadata.scope,origin:'bottom-left',rgba:a.slice(),width:explorer.canvas.width,height:explorer.canvas.height,backend:ids[0]});
  for(const id of ids.slice(1)){explorer.select(id);if(explorer.backends.find(b=>b.id===id)?.flush)await explorer.backends.find(b=>b.id===id)!.flush!();const image=compareImages(a,explorer.capture());quality.push({backend:id,pose:i,foreground,repeat,image});const epsilon=explorer.backends.find(b=>b.id===id)?.capabilities.renderer.includes('WebGPU')?2:0;if(!foreground||repeat.differentPixels||image.maxChannelError>epsilon)return {status:'not-run' as const,reason:'Exact image gate failed; no timing campaign',quality,blocks};}
  await nextFrame(campaignSignal);
 }
 // Forward then reverse generalizes ABBA to N backends without favoring an endpoint.
 for(const id of [...ids,...[...ids].reverse()]){
  explorer.select(id);for(let i=0;i<warmup;i++){await nextFrame(campaignSignal);explorer.render(path[i%path.length]);}
  const frames:FrameMetrics[]=[];let previous:number|null=null;for(let i=0;i<path.length;i++){notify('measure',i,path.length,`Mesure : ${id}`);const raf=await nextFrame(campaignSignal);const frame={...explorer.render(path[i])};frame.rafIntervalMs=previous===null?null:raf-previous;previous=raf;frames.push(frame);}
  blocks.push({backend:id,frames,cpu:summarize(frames.map(f=>f.cpuFrameMs)),cadence:frameStatistics(frames.flatMap(f=>f.rafIntervalMs===null?[]:[f.rafIntervalMs]))});
 }
 return {status:'measured' as const,reason:'Exact resident cluster comparison only; no general performance verdict',quality,blocks};
 }finally{explorer.restoreAfterCampaign(savedBackend,savedCamera);}
}
export {createGpuPageCache,httpPageSource} from './gpuPages.ts';
export type {ResidentPage} from './gpuPages.ts';
export {threeLodBackend} from './threeLod.ts';
export {webgpuPagesBackend} from './webgpuPages.ts';
export {createPageStreamer} from './streamingPages.ts';
export type {ComparisonLayout} from './comparison.ts';
export {COMPARISON_LIBRARIES,LOD_QUALITY} from '../sdk-core/index.ts';
/** Public browser job adapter. A completed explorer is owned by the caller; cancel/fail after construct disposes it. */
export async function createExplorerJob(id:string,canvas:HTMLCanvasElement,options:ExplorerOptions){
 const {createJob}=await import('../sdk-core/index.ts');
 return createJob(id,({signal,progress})=>createExplorer(canvas,{...options,signal,onPreparation:event=>progress({...event})}),{signal:options.signal});
}

export {detectCapabilities} from './capabilities.ts';
