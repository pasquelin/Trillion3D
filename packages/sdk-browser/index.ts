import {replicateInstances} from './replicateInstances.ts';
export {replicateInstances} from './replicateInstances.ts';
import {acceptPageArray,collectClusterPages,collectPendingUrls,indexPagesByUrl,pageRequestUrl,RequestStamps,resolvePixelError,selectVisiblePages,type PageRec,type SelectionResult} from './pageSelection.ts';
import {DEFAULT_SCOPE,EngineError} from '../sdk-core/index.ts';
import {detectCapabilities} from './capabilities.ts';
import {checked,loadClusterPages} from './clusterPages.ts';
import {createPageStreamer} from './streamingPages.ts';
import {loadClusterManifest} from './manifestLoad.ts';
import {orderPendingUrls,pixelScaleOf,PRIORITY_PREFETCH,PRIORITY_VISIBLE} from './streamingPriority.ts';
import {createComparisonCompositor, type ComparisonLayout} from './comparison.ts';
import {threeLodBackend} from './threeLod.ts';
import {webgpuPagesBackend} from './webgpuPages.ts';
import {autonomousPagesBackend} from './autonomousPages.ts';
import {decodeGeometryPage} from './geometryPage.ts';
export {autonomousPagesBackend} from './autonomousPages.ts';
import {createTriangleDiagnosticMaterial,disposeTriangleGeometry,materialSide,triangleGeometry,triangleSalt} from './triangleDiagnostic.ts';
import {ClusterBatches} from './clusterBatches.ts';
import {EngineProfiler,type TelemetryReport} from './telemetry.ts';
export {EngineProfiler,type TelemetryReport} from './telemetry.ts';

import type {RuntimeEvent} from '../sdk-core/index.ts';
import {nextFrame} from './scheduling.ts';
import {awaitBackendPages} from './awaitBackendPages.ts';
import { FlyControls } from 'three/addons/controls/FlyControls.js';
import { frameStatistics, DIAGNOSTICS, type DiagnosticMode } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { compareImages, summarize } from '../sdk-core/index.ts';

import type {AssetScope,PreparationProgress,CameraPose,StablePreview,FrameMetrics,BackendCapabilities,ClusterManifest} from '../sdk-core/index.ts';
export type {AssetScope,PreparationProgress,CameraPose,StablePreview,FrameMetrics,BackendCapabilities,ClusterManifest} from '../sdk-core/index.ts';
import type {RenderBackend,BackendContext,BackendFactory,BackendDiagnostic,ExplorerOptions,PointOfInterest} from './backendTypes.ts';
export type {RenderBackend,BackendContext,BackendFactory,BackendDiagnostic,ExplorerOptions,PointOfInterest} from './backendTypes.ts';
export type {DiagnosticDetail} from './backendTypes.ts';
import {createDiagnosticChannel} from './diagnosticChannel.ts';
import {SDK_BUILD_PROVENANCE} from './buildProvenance.ts';
export {createDiagnosticChannel} from './diagnosticChannel.ts';
export type {DiagnosticChannel,DiagnosticChannelOptions,DiagnosticObserver} from './diagnosticChannel.ts';
export type {SurfaceBuffer,SurfaceCapture} from './surfaceBuffer.ts';
import {installSceneLighting} from './sceneLighting.ts';
/** Perspective framing from a bounding-sphere radius. `near` scales with the asset; there is no absolute centimetre floor. */
export function framingFromBounds(radius:number,aspect:number){
 if(!Number.isFinite(radius)||radius<=0)throw new Error('Empty scene bounds');
 if(!Number.isFinite(aspect)||aspect<=0)throw new Error('Invalid aspect');
 const near=radius/10000,far=radius*20,scale=radius*1.9/Math.min(1,aspect),len=Math.hypot(.85,.65,1);
 return {near,far,offset:[.85*scale/len,.65*scale/len,1*scale/len] as [number,number,number]};
}
const DEFAULT_FOV=55,DEFAULT_PIXEL_RATIO=1,DEFAULT_WIDTH=960,DEFAULT_HEIGHT=540,DEFAULT_PAGE_WORKERS=32,PREFETCH_BATCH=64,PREFETCH_INTERVAL_MS=250,DEFAULT_CACHED_PAGES=16384,DEFAULT_CLEAR_COLOR=0x171d28;
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
function lighting(scene:THREE.Scene,clearColor:number,source:THREE.Object3D){return installSceneLighting(scene,source,clearColor);}
function objects(source:THREE.Object3D){const meshes:THREE.Mesh[]=[];source.updateMatrixWorld(true);source.traverse(o=>{if((o as THREE.Mesh).isMesh)meshes.push(o as THREE.Mesh);});return meshes;}
function geometryBytes(geometry:THREE.BufferGeometry,seen:Set<ArrayBufferView>){let bytes=0;const index=geometry.getIndex();if(index&&!seen.has(index.array)){seen.add(index.array);bytes+=index.array.byteLength;}for(const name in geometry.attributes){const attr=geometry.attributes[name];if(!attr||seen.has(attr.array))continue;seen.add(attr.array);bytes+=attr.array.byteLength;}return bytes;}
export const referenceBackend:BackendFactory=({source,sceneLighting,clearColor=DEFAULT_CLEAR_COLOR})=>{
 const scene=new THREE.Scene();const sceneLights=lighting(scene,clearColor,sceneLighting??source);let order=0,residentPages=0,allocationBytes=0,selectedTriangles=0;const seen=new Set<ArrayBufferView>();
 const copies:THREE.Mesh[]=[];const overlays:THREE.Material[]=[];
 for(const mesh of objects(source)){const copy=new THREE.Mesh(mesh.geometry,mesh.material);copy.matrixAutoUpdate=false;copy.matrix.copy(mesh.matrixWorld);copy.renderOrder=order++;copy.userData.sourceMesh=mesh;copy.userData.sourceGeometry=mesh.geometry;copy.userData.sourceMaterial=mesh.material;scene.add(copy);copies.push(copy);residentPages++;allocationBytes+=geometryBytes(mesh.geometry,seen);}
 const applyDiagnostic=(mode:DiagnosticMode)=>{overlays.splice(0).forEach(m=>m.dispose());for(const mesh of copies){const sourceGeometry=mesh.userData.sourceGeometry as THREE.BufferGeometry;const sourceMaterial=mesh.userData.sourceMaterial as THREE.Material|THREE.Material[];mesh.geometry=sourceGeometry;mesh.material=sourceMaterial;if(mode==='wireframe'){mesh.geometry=triangleGeometry(sourceGeometry,triangleSalt(String(mesh.id)));const material=createTriangleDiagnosticMaterial(materialSide(sourceMaterial));overlays.push(material);mesh.material=material;}}};
 return {id:'three-webgl-reference',capabilities:baseCapabilities,overBudget:false,scene,setDiagnostic:applyDiagnostic,async prepare(){},refreshSceneLighting:()=>sceneLights.refresh(),render(){source.updateMatrixWorld(true);sceneLights.update();selectedTriangles=0;for(const mesh of copies){mesh.matrix.copy((mesh.userData.sourceMesh as THREE.Mesh).matrixWorld);const index=mesh.geometry.getIndex();selectedTriangles+=(index?index.count:mesh.geometry.getAttribute('position').count)/3;}},metrics:()=>({clusters:null,selectedTriangles,residentPages:null,geometryAllocationBytes:allocationBytes,pagesDetached:null,frustumRejected:null,lodLevel:null,submittedTriangles:selectedTriangles}),dispose(){overlays.forEach(m=>m.dispose());for(const mesh of copies)disposeTriangleGeometry(mesh.userData.sourceGeometry as THREE.BufferGeometry);scene.clear();}};
};
export const exactPagesBackend:BackendFactory=(context)=>{
 const {source,metadata,indices,associations,maxResidentPages,viewport,clearColor=DEFAULT_CLEAR_COLOR}=context;
 const {roots,allPages,blendCopies,bootstrap,requestCount,prepared}=collectClusterPages(source,metadata,indices,associations);
 const cap=maxResidentPages??Math.max(1024,prepared),scene=new THREE.Scene();const sceneLights=lighting(scene,clearColor,context.sceneLighting??source);const shown:PageRec[]=[],desired:PageRec[]=[],attached:PageRec[]=[];
 const byUrl=indexPagesByUrl(allPages),pendingScratch:string[]=[],urlScratch:string[]=[],missingRoots:PageRec[]=[];
 const bundled=allPages.some(rec=>rec.streamUrl!==undefined),requestStamps=new RequestStamps(requestCount);
 /** Ajoute à `urlScratch` les clés de requête que ce passage n'a pas encore vues. */
 const markRequests=(list:readonly PageRec[])=>{for(let i=0;i<list.length;i++){const rec=list[i];if(requestStamps.first(rec.requestIndex))urlScratch.push(pageRequestUrl(rec));}};
 const prefetchScratch:string[]=[],prefetchShown:PageRec[]=[],pixelScaleScratch:number[]=[1,1];let lastCamera:THREE.PerspectiveCamera|undefined,lastPixelError=0;
 // Demande et résultat de la coupe, posés une fois : une image de rendu n'alloue rien du tout.
 const selectOptions={pixelError:0,viewport,frame:0,holdResident:true,pageBudget:cap,wanted:desired,result:undefined as SelectionResult<PageRec>|undefined};
 selectOptions.result={shown,wanted:desired,visible:0,selectedTriangles:0,displayedTriangles:0,frustumRejected:0,lodLevel:0,complete:true,pixelError:0};
 // Un tampon d'index résident par primitive : la coupe visible n'est plus qu'une liste de plages.
 const batches=new ClusterBatches(scene,allPages);
 for(const copy of blendCopies){copy.userData.sourceGeometry=copy.geometry;copy.userData.sourceMaterial=copy.material;scene.add(copy);}
 const indexByUrl=new Map<string,THREE.BufferAttribute>();
 for(const rec of allPages)if(rec.array&&!indexByUrl.has(rec.url))indexByUrl.set(rec.url,new THREE.BufferAttribute(rec.array,1));
 let visible=0,selectedTriangles=0,frame=0,pagesDetached=0,overBudget=false,frustumRejected=0,lodLevel=0,urlStamp=0,displayDetachments=0,diagnostic:DiagnosticMode='beauty';
 // Temps de la coupe seule : le seul poste que ce moteur choisit sur le processeur.
 let cpuSelectMs=0;
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
 const attach=(rec:PageRec)=>{if(!rec.array)return;if(!indexByUrl.has(rec.url))indexByUrl.set(rec.url,new THREE.BufferAttribute(rec.array,1));if(!rec.mesh){const geometry=new THREE.BufferGeometry();geometry.attributes={...rec.attributes};geometry.setIndex(indexByUrl.get(rec.url)!);minPoint.fromArray(rec.min);maxPoint.fromArray(rec.max);geometry.boundingBox=new THREE.Box3().set(minPoint,maxPoint);geometry.boundingSphere=new THREE.Sphere();geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);const copy=new THREE.Mesh(geometry,materialFor(rec));copy.matrixAutoUpdate=false;copy.matrix.copy(rec.matrix);copy.frustumCulled=false;copy.renderOrder=rec.renderOrder;copy.userData.clusterId=rec.clusterId;copy.userData.lodRole=rec.role??'exact';rec.geometry=geometry;rec.mesh=copy;}else rec.mesh.material=materialFor(rec);rec.mesh!.matrix.copy(rec.matrix);if(rec.mesh&&rec.geometry)paint(rec.mesh,rec.geometry,rec.mesh.material,triangleSalt(rec.clusterId));if(!rec.attached){scene.add(rec.mesh!);rec.attached=true;}};
 const disposeGeometry=(geometry:THREE.BufferGeometry)=>{
  disposeTriangleGeometry(geometry);
  for(const name of Object.keys(geometry.attributes))geometry.deleteAttribute(name);
  geometry.dispose();
 };
 const displayList=()=>shown.length?shown:desired;
 const syncResident=()=>{
  const display=displayList();
  // La coupe est parcourue une fois : marquage des pages résidentes, comptage des sorties, reconstruction
  // de la liste des pages affichées. Aucun balayage de l'ensemble des pages de la scène.
  for(let i=0;i<display.length;i++)if(display[i].array)display[i].resident=true;
  for(let i=0;i<attached.length;i++){
   const rec=attached[i];
   if(rec.resident)continue;
   if(rec.attached){release(rec);displayDetachments++;}
   pagesDetached++;
  }
  attached.length=0;
  for(let i=0;i<display.length;i++){
   const rec=display[i];if(!rec.array)continue;
   rec.resident=false;attached.push(rec);
   if(diagnostic==='beauty'){if(rec.attached)release(rec);}else attach(rec);
  }
  if(diagnostic==='beauty')batches.update(display);else batches.hideAll();
 };
 return {setDiagnostic(mode){diagnostic=mode;paintBlend();syncResident();},id:'exact-cluster-pages',capabilities:{...baseCapabilities,hierarchy:true,eviction:true,unsupported:baseCapabilities.unsupported.filter(item=>item!=='bounded GPU eviction')},scene,async prepare(){},
  get overBudget(){return overBudget;},
  refreshSceneLighting:()=>sceneLights.refresh(),
  render(camera){source.updateMatrixWorld(true);for(const copy of blendCopies)copy.matrix.copy((copy.userData.sourceMesh as THREE.Mesh).matrixWorld);sceneLights.update();overBudget=false;frame++;lastCamera=camera;lastPixelError=resolvePixelError(context,camera,motion);selectOptions.pixelError=lastPixelError;selectOptions.frame=frame;const selectStart=performance.now();const selected=selectVisiblePages(roots,camera,selectOptions,shown);cpuSelectMs=performance.now()-selectStart;
   // Truncating a DAG cut would punch holes: its clusters are a partition, not a priority list.
   // Selection already answered the budget with a coarser threshold, so the cover is kept whole and
   // only the flag is raised when even the coarsest cover exceeds the budget.
   overBudget=selected.shown.length>cap;visible=selected.visible;selectedTriangles=selected.selectedTriangles;frustumRejected=selected.frustumRejected;lodLevel=selected.lodLevel;syncResident();},
  pendingUrls(){
   // The root cover is requested first and never dropped: it is what the cut falls back on.
   missingRoots.length=0;
   for(let i=0;i<bootstrap.length;i++)if(!bootstrap[i].array)missingRoots.push(bootstrap[i]);
   if(missingRoots.length)return collectPendingUrls(missingRoots,pendingScratch,requestStamps);
   const waiting=desired.length?desired:shown;
   if(!lastCamera)return collectPendingUrls(waiting,pendingScratch,requestStamps);
   // Most costly absence first: what the viewer sees wrong the longest is fetched last, not first.
   return orderPendingUrls(waiting,lastCamera,pixelScaleOf(lastCamera,viewport,pixelScaleScratch),pendingScratch);
  },
  prefetchUrls(){
   prefetchScratch.length=0;
   if(!lastCamera||!bootstrap.length)return prefetchScratch;
   // A ring around the cut: what a twice-finer threshold would select. Asked for only when nothing
   // visible is missing, at a priority the visible cut always outranks.
   const ring=selectVisiblePages(roots,lastCamera,{pixelError:lastPixelError>0?lastPixelError*0.5:0.5,viewport,frame,holdResident:false},prefetchShown);
   return collectPendingUrls(ring.wanted?.length?ring.wanted:ring.shown,prefetchScratch);
  },
  pageUrls(){
   urlScratch.length=0;
   // A streaming bundle is shared between primitives and instances, so the per-primitive stamp table
   // of the batches cannot deduplicate it. Une estampille par rang de requête le fait sans table de
   // hachage ni allocation, sur une coupe qui compte des milliers de pages à chaque image.
   if(bundled){
    requestStamps.begin();
    markRequests(bootstrap);markRequests(shown);markRequests(desired);
    return urlScratch;
   }
   urlStamp++;batches.markUrls(bootstrap,urlStamp,urlScratch);batches.markUrls(shown,urlStamp,urlScratch);batches.markUrls(desired,urlStamp,urlScratch);return urlScratch;
  },
  // One request carries a whole bundle: every record it holds takes the view at its own offset, and
  // each of those views is what the batch writes into the primitive's index buffer.
  acceptPage(url,array){const recs=byUrl.get(url);if(!recs)return;acceptPageArray(recs,array);batches.acceptPage(recs,array);},
  dropPage(url){const recs=byUrl.get(url);if(!recs)return;batches.dropPage(recs);for(let i=0;i<recs.length;i++){const rec=recs[i];indexByUrl.delete(rec.url);rec.array=undefined;rec.indexBytes=rec.triangles*12;if(rec.geometry){disposeGeometry(rec.geometry);rec.geometry=undefined;}if(rec.attached&&rec.mesh){scene.remove(rec.mesh);rec.attached=false;}rec.mesh=undefined;}},
  syncResident,
  metrics(){const batched=batches.metrics;
   // Mode beauté : les compteurs viennent des lots, sans parcourir les géométries. Mode diagnostic :
   // une géométrie par page, on retombe sur le comptage détaillé.
   let bytes=batched.allocationBytes,draws=blendCopies.length+batched.drawCalls,submitted=batched.submittedTriangles;
   if(diagnostic!=='beauty'){metricsSeen.clear();bytes=0;submitted=0;draws=blendCopies.length;
    for(const rec of attached)if(rec.geometry)bytes+=geometryBytes(rec.geometry,metricsSeen);
    for(let i=0;i<attached.length;i++)if(attached[i].attached){draws++;submitted+=attached[i].triangles;}}
   const transparentSubmittedTriangles=blendCopies.reduce((sum,copy)=>sum+(copy.geometry.getIndex()?.count??copy.geometry.getAttribute('position').count)/3,0);
   return {cpuSelectMs,clusters:visible,selectedTriangles,residentPages:attached.length,pagesDetached,geometryAllocationBytes:bytes,frustumRejected,lodLevel,submittedTriangles:submitted,totalSubmittedTriangles:submitted+transparentSubmittedTriangles,transparentMeshes:blendCopies.length,transparentSubmittedTriangles,transparentDrawCalls:blendCopies.length,drawCalls:draws,batchRebuilds:batched.pageRangeWrites,batchIndexBytesUpdated:batched.indexBytesWritten,displayDetachments:displayDetachments+batched.detachments,pageRangeWrites:batched.pageRangeWrites,subDraws:batched.subDraws};},
  dispose(){diagnosticMaterials.forEach(m=>m.dispose());batches.dispose();for(const rec of allPages){if(rec.attached)release(rec);if(rec.geometry)disposeGeometry(rec.geometry);rec.geometry=undefined;rec.mesh=undefined;}for(const copy of blendCopies)disposeTriangleGeometry(copy.userData.sourceGeometry as THREE.BufferGeometry);scene.clear();}};
};
export const DEFAULT_BACKENDS:BackendFactory[]=[referenceBackend,exactPagesBackend,threeLodBackend];
function disposeSource(source:THREE.Object3D){const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();for(const mesh of objects(source)){geometries.add(mesh.geometry);for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){materials.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);}}geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>{t.dispose();const image=t.source.data as {close?:()=>void};image?.close?.();});}
export async function createExplorer(canvas:HTMLCanvasElement,options:ExplorerOptions){
 const diagnosticChannel=createDiagnosticChannel(options.onDiagnostic,{detail:options.diagnosticDetail??(options.onDiagnostic?'trace':'summary')});
 const emit=(event:RuntimeEvent)=>{try{options.onEvent?.(event);}catch{/* Diagnostic observers cannot interrupt rendering. */}};
 const diagnose=(phase:string,message:string,context:Record<string,unknown>={})=>diagnosticChannel.emit({phase,message,context});
 const preparationStart=performance.now();const {signal}=options,scope=options.scope??DEFAULT_SCOPE;const progress=(phase:string,completed:number,total:number,message:string)=>{signal?.throwIfAborted();options.onPreparation?.({phase,completed,total,message});diagnose('preparation',message,{kind:'preparation',phase,completed,total,scope});};
 progress('manifest',0,1,'Lecture du cache');
 const {manifestUrl}=options;let pointer:Record<string,unknown>;let metadataUrl:string;let metadata:ClusterManifest;let loadedBase:string;
 try{
  const loaded=await loadClusterManifest(manifestUrl,scope,signal);
  ({pointer,metadata,metadataUrl}=loaded);loadedBase=loaded.base;
  diagnose('manifest','Manifeste lu',{kind:'preparation',phase:'manifest',scope,manifestUrl,metadataUrl,...loaded.timing});
 }catch(error){diagnose('error','Manifest or cache preparation failed',{kind:'error',phase:'manifest',error:String(error),scope,manifestUrl});diagnosticChannel.flushSync();diagnosticChannel.close();throw error;}
 const autonomous=options.autonomousGeometry===true;
 if(autonomous&&(!metadata.autonomousScene||options.backends))throw new EngineError('AUTONOMOUS_SCENE_UNAVAILABLE','Autonomous geometry requires a prepared static scene and the autonomous backend');
 const base=loadedBase;
 const sceneFile=autonomous?metadata.autonomousScene!:'source.gltf';
 let sceneLightingSource:THREE.Object3D|undefined,source:THREE.Object3D|undefined,renderer:THREE.WebGLRenderer|undefined,gpuDevice:GPUDevice|undefined,measurementTarget:THREE.WebGLRenderTarget|undefined;const backends:RenderBackend[]=[];
 const disposeTargets=()=>{measurementTarget?.dispose();measurementTarget=undefined;};
 try{
  progress('scene',0,1,`Chargement de ${metadata.selectedTriangles.toLocaleString()} triangles (${scope})`);
  const manager=new THREE.LoadingManager();manager.onProgress=(_url,loaded,total)=>{if(!signal?.aborted){const message=`Ressource chargée : ${decodeURIComponent(_url.split('/').at(-1) ?? _url)}`;options.onPreparation?.({phase:'resources',completed:loaded,total,message});diagnose('preparation',message,{kind:'preparation',phase:'resources',completed:loaded,total,resource:_url,scope});}};
  // GLTFLoader has no AbortSignal in this Three version; dispose late results after loading settles.
  const gltf=await new GLTFLoader(manager).loadAsync(new URL(sceneFile,base).href);source=gltf.scene;sceneLightingSource=options.sceneLighting??source;signal?.throwIfAborted();
  let preparedBounds:THREE.Box3|undefined;
  if(autonomous){preparedBounds=new THREE.Box3();for(const mesh of objects(source)){
   const association=(gltf.parser.associations as BackendContext['associations']).get(mesh);
   const primitive=metadata.primitives.find(item=>item.mesh===association?.meshes&&item.primitive===(association?.primitives??0));
   if(!primitive)throw new EngineError('AUTONOMOUS_ASSOCIATION_MISSING','Prepared scene primitive has no geometry pages');
   for(const page of primitive.pages)if((page.role??'exact')==='exact')preparedBounds.union(new THREE.Box3(new THREE.Vector3().fromArray(page.min),new THREE.Vector3().fromArray(page.max)).applyMatrix4(mesh.matrixWorld));
  }}
  source=replicateInstances(source,gltf.parser.associations as BackendContext['associations'],options.replicaCount??1,preparedBounds);
  const pages=[...new Map(metadata.primitives.flatMap(p=>p.pages).map(p=>[p.url,p])).values()];
  const geometryPages=[...new Map(metadata.primitives.flatMap(p=>p.pages).filter(page=>!!page.geometry).map(page=>[page.geometry!.url,page.geometry!])).values()];
  const geometryUrls=new Set(geometryPages.map(page=>page.url));
  const pageIdByUrl=new Map([...pages.map(page=>[page.url,page.id] as const),...metadata.primitives.flatMap(p=>p.pages).filter(page=>!!page.geometry).map(page=>[page.geometry!.url,page.id] as const)]);
  const exactPages=pages.filter(page=>(page.role??'exact')!=='coarse');
  const preload=options.preload??'visible';
  // A cluster DAG cuts far below its exact page count, but the cut moves every frame: the resident
  // set must be a superset of it or the cache thrashes. Twice the expected cut, floored at 32768.
  const bundles=[...new Map(metadata.primitives.flatMap(p=>p.streams?.pages??[]).map(bundle=>[bundle.url,bundle])).values()];
  const dagPages=bundles.length>0;
  const attachCap=options.maxResidentPages??(dagPages?Math.max(32768,exactPages.length*2*(options.replicaCount??1)):Math.max(1024,exactPages.length*(options.replicaCount??1)));
  const cacheCap=options.maxCachedPages??(dagPages?Math.max(8192,bundles.length*2):Math.max(8192,Math.min(attachCap,DEFAULT_CACHED_PAGES)));
  const streamer=createPageStreamer([...pages,...geometryPages,...bundles],base,signal,options.pageFetchWorkers??DEFAULT_PAGE_WORKERS,cacheCap,url=>{for(const b of backends)b.dropPage?.(url);},options.maxPageTransferBytes,diagnosticChannel.detail==='trace'&&diagnosticChannel.enabled?diagnosticChannel.emit:undefined,options.maxCachedBytes);
  let loaded=0,pageBytesRead=0;
  const indices=new Map<string,Uint32Array>();
  if(preload==='all'&&!autonomous){const all=await loadClusterPages(pages,base,signal,(completed,total)=>progress('pages',completed,total,'Lecture et vérification des pages exactes et LOD'),options.pageFetchWorkers??DEFAULT_PAGE_WORKERS);for(const [url,array] of all.indices)indices.set(url,array);loaded=all.loaded;pageBytesRead=all.pageBytesRead;}
  else progress('pages',0,pages.length,'Hiérarchie prête · pages à la demande');
  const capabilities=await detectCapabilities('webgl',canvas);if(!capabilities.renderer){emit({eventVersion:1,type:'fatal',audience:'blocking',recovered:false,code:'NO_WEBGL2',detail:capabilities.reason});diagnose('error','WebGL2 capability check failed',{kind:'error',code:'NO_WEBGL2',reason:capabilities.reason,scope});throw new Error(capabilities.reason);}emit({eventVersion:1,type:'capability',audience:'diagnostic',recovered:true,code:'WEBGL2_BASELINE',detail:capabilities.reason});diagnose('capability','WebGL2 capability detected',{kind:'capability',backend:'webgl',reason:capabilities.reason,scope});
  const wantsWebgpu=!autonomous&&(!options.backends||options.backends.includes(webgpuPagesBackend));
  try{if(wantsWebgpu){const gpu=options.gpu??(typeof navigator==='undefined'?undefined:navigator.gpu);if(gpu){const gpuCaps=await detectCapabilities('webgpu',canvas,{gpu});if(gpuCaps.renderer){emit({eventVersion:1,type:'capability',audience:'diagnostic',recovered:true,code:'WEBGPU_AVAILABLE',detail:gpuCaps.reason});diagnose('capability','WebGPU capability detected',{kind:'capability',backend:'webgpu',reason:gpuCaps.reason,scope});}if(gpuCaps.adapter){const features:GPUFeatureName[]=[];if(gpuCaps.adapter.features.has('indirect-first-instance'))features.push('indirect-first-instance');if(gpuCaps.adapter.features.has('timestamp-query'))features.push('timestamp-query');const adapterLimits=gpuCaps.adapter.limits;const requiredLimits:Record<string,number>={};for(const name of ['maxTextureArrayLayers','maxStorageBufferBindingSize','maxBufferSize'] as const){const value=(adapterLimits as unknown as Record<string,number|undefined>)[name];if(typeof value==='number'&&Number.isFinite(value))requiredLimits[name]=value;}gpuDevice=await gpuCaps.adapter.requestDevice({requiredFeatures:features,requiredLimits});}}}}catch(error){diagnose('fallback','WebGPU setup unavailable; WebGL path retained',{kind:'fallback',backend:'webgpu',error:String(error),scope});/* WebGPU stays optional; the WebGL2 backends remain the default path. */}
  const directGpu=!!gpuDevice&&options.backends?.length===1&&options.backends[0]===webgpuPagesBackend;
  if(!directGpu){
  renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,preserveDrawingBuffer:false});renderer.setPixelRatio(options.pixelRatio??DEFAULT_PIXEL_RATIO);renderer.setSize(options.width??DEFAULT_WIDTH,options.height??DEFAULT_HEIGHT,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  }else{
   canvas.width=Math.floor((options.width??DEFAULT_WIDTH)*(options.pixelRatio??DEFAULT_PIXEL_RATIO));
   canvas.height=Math.floor((options.height??DEFAULT_HEIGHT)*(options.pixelRatio??DEFAULT_PIXEL_RATIO));
  }
  diagnose('configuration','Active explorer configuration',{kind:'configuration',scope,detail:diagnosticChannel.detail,backendMode:autonomous?'autonomous-webgl':directGpu?'webgpu-direct':'webgl-composed',limits:{maxResidentPages:attachCap,maxCachedPages:cacheCap,pageFetchWorkers:options.pageFetchWorkers??DEFAULT_PAGE_WORKERS,maxFrameAllocationBytes:options.maxFrameAllocationBytes??null},pageCatalogue:(autonomous?geometryPages:pages).map(page=>({url:page.url,bytes:page.bytes})),provenance:{sdk:SDK_BUILD_PROVENANCE,manifestUrl,metadataUrl,formatVersion:metadata.formatVersion??metadata.schema,schema:metadata.schema,compilerVersion:metadata.compilerVersion??null,sourceGltfUrl:new URL(sceneFile,base).href}});
  if(options.detail==='maximum'&&renderer){const maximum=renderer.capabilities.getMaxAnisotropy();for(const mesh of objects(source))for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])for(const value of Object.values(material))if(value instanceof THREE.Texture){value.anisotropy=maximum;value.needsUpdate=true;}}
  const viewport:[number,number]=[canvas.width,canvas.height];
  const context:BackendContext={source,metadata,indices,readPage:url=>streamer.read(url),readGeometryPage:url=>streamer.readBytes(url),associations:gltf.parser.associations as BackendContext['associations'],signal,maxResidentPages:attachCap,maxCachedPages:cacheCap,pixelError:options.pixelError??0,lodAdaptive:options.lodAdaptive,clearColor:options.clearColor??DEFAULT_CLEAR_COLOR,onDiagnostic:diagnosticChannel.enabled?diagnosticChannel.emit:undefined,diagnosticDetail:diagnosticChannel.detail,viewport,gpuDevice,gpuCanvas:directGpu?canvas:undefined,maxFrameAllocationBytes:options.maxFrameAllocationBytes,maxTextureTransferBytesPerFrame:options.maxTextureTransferBytesPerFrame,sceneLighting:sceneLightingSource};
  const factories=autonomous?[autonomousPagesBackend]:options.backends??(gpuDevice?[...DEFAULT_BACKENDS,webgpuPagesBackend]:DEFAULT_BACKENDS);
  for(const factory of factories){
   const backend=factory(context);if(backends.some(b=>b.id===backend.id))throw new Error('Duplicate backend id');
   diagnose('backend-preparation-start','Backend preparation started',{kind:'preparation',backend:backend.id,scope});
   try{await backend.prepare();backends.push(backend);diagnose('backend-preparation-complete','Backend preparation completed',{kind:'preparation',backend:backend.id,scope});}
   catch(error){
    diagnose('backend-preparation-error','Backend preparation failed',{kind:'error',backend:backend.id,error:String(error),scope});
    backend.dispose();
    if(backend.id==='webgpu-page-raster'&&!directGpu){emit({eventVersion:1,type:'fallback',audience:'diagnostic',recovered:true,code:'WEBGPU_UNAVAILABLE',detail:String(error)});diagnose('fallback','WebGPU backend unavailable; continue with other backends',{kind:'fallback',backend:backend.id,error:String(error),scope});continue;}
    throw error;
   }
  }
  if(preload!=='all')indices.clear();
  if(!backends.length)throw new Error('No backend');
  const bounds=new THREE.Box3();for(const mesh of objects(source)){
   if(!autonomous){bounds.expandByObject(mesh);continue;}
   const association=(gltf.parser.associations as BackendContext['associations']).get(mesh);
   const primitive=metadata.primitives.find(item=>item.mesh===association?.meshes&&item.primitive===(association?.primitives??0));
   if(!primitive)continue;
   for(const page of primitive.pages)if((page.role??'exact')==='exact')bounds.union(new THREE.Box3(new THREE.Vector3().fromArray(page.min),new THREE.Vector3().fromArray(page.max)).applyMatrix4(mesh.matrixWorld));
  }const center=bounds.getCenter(new THREE.Vector3()),radius=bounds.getSize(new THREE.Vector3()).length()/2;
  if(!Number.isFinite(radius)||radius<=0)throw new Error('Empty scene bounds');
  const framing=framingFromBounds(radius,canvas.width/canvas.height);
  const camera=new THREE.PerspectiveCamera(options.fov??DEFAULT_FOV,canvas.width/canvas.height,framing.near,framing.far);const homeOffset=new THREE.Vector3().fromArray(framing.offset);camera.position.copy(center).add(homeOffset);camera.lookAt(center);camera.updateMatrixWorld();
  let fallbackReason:string|null=null;const baseline=backends.find(b=>b.id==='three-webgl-reference')??backends[0];const optimized=backends.find(b=>b.id==='exact-cluster-pages')??backends.find(b=>b.id==='webgpu-page-raster')??baseline;let active=optimized,disposed=false,diagnostic:DiagnosticMode='beauty';const beautyMaterials=new Map<THREE.Mesh,THREE.Material|THREE.Material[]>(),overlays:THREE.Material[]=[],hostedControls:{dispose():void}[]=[];const ownedRenderer=renderer!;let capturingSurface=false,measuring=false;const capturePool=[new Uint8Array(0),new Uint8Array(0),new Uint8Array(0)];let captureSlot=0;
  const lookAtTarget=new THREE.Vector3().copy(center);let hostFrame=0;
  let comparisonLayout:ComparisonLayout=options.comparisonLayout??'single',comparisonPair:[string,string]=options.comparisonPair??[baseline.id,backends.find(b=>b.id==='exact-cluster-pages')?.id??backends[backends.length-1].id],wipe=.5,toggle:0|1=0;
  if(directGpu&&comparisonLayout!=='single')throw new Error('SINGLE_BACKEND_COMPARISON');
  let pairTargetA:THREE.WebGLRenderTarget|undefined,pairTargetB:THREE.WebGLRenderTarget|undefined;const compositor=directGpu?undefined:createComparisonCompositor(ownedRenderer);
  const metricsScratch:FrameMetrics={rafIntervalMs:null,cpuFrameMs:0,cpuSelectMs:null,cpuSubmitMs:null,gpuMs:null,drawCalls:0,triangles:0,clusters:null,selectedTriangles:null,residentPages:null,geometryAllocationBytes:null,vramBytes:null,pageLoads:loaded,pageBytesRead,pagesDetached:null,cacheEvictions:null,gpuPassMs:null,gpuFrameMs:null};
  const profiler=new EngineProfiler();
  profiler.setMetadata(metadata);
  if(options.logInterval&&options.logInterval>0)profiler.startAutoLog(options.logInterval);
  const targetOptions={type:THREE.UnsignedByteType,colorSpace:THREE.SRGBColorSpace};
  const ensureTarget=(current:THREE.WebGLRenderTarget|undefined)=>current??new THREE.WebGLRenderTarget(canvas.width,canvas.height,targetOptions);
  const check=()=>{if(disposed)throw new Error('Explorer disposed');if(capturingSurface)throw new Error('SURFACE_CAPTURE_BUSY');signal?.throwIfAborted();};
  const setPose=(pose:CameraPose)=>{camera.position.fromArray(pose.position);camera.fov=pose.fov;camera.near=pose.near;camera.far=pose.far;camera.lookAt(lookAtTarget.fromArray(pose.target));camera.updateProjectionMatrix();camera.updateMatrixWorld();};
  const fillMetrics=(backend:RenderBackend)=>{const backendMetrics=backend.metrics() as FrameMetrics;const stream=streamer.stats();metricsScratch.coverageReady=backendMetrics.coverageReady??null;metricsScratch.coverageBudgetLimited=backendMetrics.coverageBudgetLimited??null;metricsScratch.streamingError=streamingError;metricsScratch.clusters=backendMetrics.clusters;metricsScratch.selectedTriangles=backendMetrics.selectedTriangles;metricsScratch.residentPages=backendMetrics.residentPages;metricsScratch.pagesDetached=backendMetrics.pagesDetached??null;metricsScratch.cacheEvictions=backendMetrics.cacheEvictions??stream.evictions;metricsScratch.geometryAllocationBytes=backendMetrics.geometryAllocationBytes;metricsScratch.frustumRejected=backendMetrics.frustumRejected??null;metricsScratch.lodLevel=backendMetrics.lodLevel??null;metricsScratch.submittedTriangles=backendMetrics.submittedTriangles??null;metricsScratch.transparentMeshes=backendMetrics.transparentMeshes??null;metricsScratch.transparentFrustumRejected=backendMetrics.transparentFrustumRejected??null;metricsScratch.transparentDrawCalls=backendMetrics.transparentDrawCalls??null;metricsScratch.transparentSubmittedTriangles=backendMetrics.transparentSubmittedTriangles??null;metricsScratch.totalSubmittedTriangles=backendMetrics.totalSubmittedTriangles??(backendMetrics.submittedTriangles==null?null:backendMetrics.submittedTriangles+(backendMetrics.transparentSubmittedTriangles??0));metricsScratch.pageLoads=stream.loaded||loaded;metricsScratch.pageBytesRead=stream.bytesRead||pageBytesRead;metricsScratch.pagesRequested=stream.requested;metricsScratch.pagesLoading=stream.loading;metricsScratch.cacheHits=stream.hits;metricsScratch.cacheMisses=stream.misses;metricsScratch.cpuSelectMs=backendMetrics.cpuSelectMs??null;metricsScratch.cpuSubmitMs=backendMetrics.cpuSubmitMs??null;metricsScratch.gpuMs=backendMetrics.gpuMs??null;metricsScratch.gpuPassMs=backendMetrics.gpuPassMs??null;metricsScratch.gpuFrameMs=backendMetrics.gpuFrameMs??null;metricsScratch.vramBytes=backendMetrics.vramBytes??null;metricsScratch.drawCalls=typeof backendMetrics.drawCalls==='number'?backendMetrics.drawCalls:-1;metricsScratch.textureUploaded=backendMetrics.textureUploaded??null;metricsScratch.texturePending=backendMetrics.texturePending??null;metricsScratch.textureSkipped=backendMetrics.textureSkipped??null;};
  let streamingError:string|null=null,lastPrefetch=0;
  let streamingPromise:Promise<void>|null=null,backgroundFetchController:AbortController|undefined;const queuedFetch:string[]=[];const decodeFailures=new Set<string>();
  const acceptCached=(backend:RenderBackend,missing:readonly string[])=>{
   let acceptedAny=false;
   for(let i=0;i<missing.length;i++){
    const url=missing[i];if(geometryUrls.has(url))continue;const cached=streamer.get(url);
    if(cached){backend.acceptPage?.(url,cached);acceptedAny=true;}
   }
   if(acceptedAny)backend.syncResident?.();
   return acceptedAny;
  };
  const startFetch=(urls:string[],priority=PRIORITY_VISIBLE)=>{
   if(!urls.length||measuring)return;
   const controller=new AbortController();backgroundFetchController=controller;
   streamingPromise=streamer.request(urls,{signal:controller.signal,priority}).then(async()=>{
    for(const url of urls){
     if(geometryUrls.has(url)){const bytes=streamer.getBytes(url);if(bytes){try{const decoded=await decodeGeometryPage(bytes);for(const b of backends)b.acceptGeometryPage?.(url,decoded);}catch(error){decodeFailures.add(url);throw error;}}continue;}
     const array=streamer.get(url);if(array)for(const b of backends)b.acceptPage?.(url,array);
    }
    for(const b of backends)b.syncResident?.();
    }).catch(error=>{
    if(disposed||signal?.aborted||controller.signal.aborted)return;
    const detail=String(error);
    if(streamingError!==detail){streamingError=detail;const recovered=active.metrics().coverageReady===true;emit(recovered?{eventVersion:1,type:'fallback',audience:'diagnostic',recovered:true,code:'PAGE_STREAM_FAILED',detail}:{eventVersion:1,type:'fatal',audience:'blocking',recovered:false,code:'PAGE_STREAM_FAILED',detail});diagnose('coverage-streaming-failed','Échec du chargement des pages ; couverture GPU de secours conservée si disponible',{kind:'error',version:1,error:detail,failedPages:streamer.stats().failed,maxAttemptsPerPage:3,coverageReady:active.metrics().coverageReady??null,recovered,scope});}
   }).finally(()=>{
    if(backgroundFetchController===controller)backgroundFetchController=undefined;
    streamingPromise=null;
    if(queuedFetch.length&&!measuring){
     const next=queuedFetch.splice(0,queuedFetch.length).filter(url=>(geometryUrls.has(url)||!streamer.has(url))&&!streamer.loading(url)&&!streamer.failed(url)&&!decodeFailures.has(url));
     if(next.length)startFetch(next);
    }
   });
  };
  const drawBackend=(backend:RenderBackend,target:THREE.WebGLRenderTarget|null)=>{
   backend.render(camera);
   let missing=backend.pendingUrls?.()??[];
   if(missing.length>0){
    if(acceptCached(backend,missing))missing=backend.pendingUrls?.()??[];
    const needFetch=missing.filter(url=>(geometryUrls.has(url)||!streamer.has(url))&&!streamer.loading(url)&&!streamer.failed(url)&&!decodeFailures.has(url));
    if(needFetch.length>0){
     if(!measuring&&!streamingPromise)startFetch(needFetch);
     else if(!measuring&&streamingPromise){for(const url of needFetch)if(!queuedFetch.includes(url))queuedFetch.push(url);backgroundFetchController?.abort(new DOMException('Camera request superseded','AbortError'));}
    }
   }
   else if(!measuring&&!streamingPromise&&!queuedFetch.length&&performance.now()-lastPrefetch>PREFETCH_INTERVAL_MS&&streamer.stats().loading===0){
    // The network is idle and nothing visible is missing: pull the ring around the cut ahead of the
    // camera, at a priority any visible request outranks. A second selection pass costs as much as
    // the first, so it runs on a timer, never on every frame.
    lastPrefetch=performance.now();
    const ring=backend.prefetchUrls?.();
    if(ring&&ring.length){
     const cold=ring.filter(url=>!streamer.has(url)&&!streamer.loading(url)&&!streamer.failed(url)).slice(0,PREFETCH_BATCH);
     if(cold.length)startFetch(cold,PRIORITY_PREFETCH);
    }
   }
   const visibleUrls=backend.pageUrls?.();
   if(visibleUrls)streamer.retain(visibleUrls);
   if(directGpu){if(backend.overBudget)throw new EngineError('PAGE_BUDGET','Visible pages exceed the resident budget');return;}
   ownedRenderer.setRenderTarget(target);
   if(backend.overBudget&&backend!==baseline){if(measuring)throw new EngineError('PAGE_BUDGET','Visible pages exceed the resident budget; no incomplete surface is rendered');fallbackReason='Visible pages exceed resident budget';active=baseline;baseline.render(camera);ownedRenderer.render(baseline.scene,camera);emit({eventVersion:1,type:'fallback',audience:'diagnostic',recovered:true,code:'PAGE_BUDGET',detail:fallbackReason});diagnose('fallback','Visible pages exceed resident budget',{kind:'fallback',reason:fallbackReason,from:backend.id,to:baseline.id,scope});return;}
   ownedRenderer.render(backend.scene,camera);
  };
  const render=(pose?:CameraPose):FrameMetrics=>{
   check();const frameNumber=++hostFrame;const start=performance.now();if(pose)setPose(pose);
   try{
    if(comparisonLayout==='single'||measuring)drawBackend(active,measuring&&!directGpu?(measurementTarget=ensureTarget(measurementTarget)):null);
    else{
     const left=backends.find(b=>b.id===comparisonPair[0])??active,right=backends.find(b=>b.id===comparisonPair[1])??active;
     pairTargetA=ensureTarget(pairTargetA);pairTargetB=ensureTarget(pairTargetB);
     drawBackend(left,pairTargetA);drawBackend(right,pairTargetB);
     compositor!.render(pairTargetA.texture,pairTargetB.texture,comparisonLayout,wipe,toggle);
    }
   }catch(error){
    if(measuring||diagnostic!=='beauty')throw error;
    if(ownedRenderer?.getContext().isContextLost()){fallbackReason='Context lost: host must retain a stable preview and recreate the renderer';emit({eventVersion:1,type:'fatal',audience:'blocking',recovered:false,code:'CONTEXT_LOST',detail:fallbackReason});diagnose('error','WebGL context lost',{kind:'error',error:String(error),code:'CONTEXT_LOST',backend:active.id,scope});throw error;}
    if(active===baseline)throw error;
    fallbackReason=`Backend error: ${String(error)}`;active=baseline;
    try{active.render(camera);ownedRenderer.render(active.scene,camera);}
    catch(fatal){emit({eventVersion:1,type:'fatal',audience:'blocking',recovered:false,code:'BASELINE_FAILED',detail:String(fatal)});diagnose('error','Baseline backend failed after fallback',{kind:'error',error:String(fatal),code:'BASELINE_FAILED',scope});throw fatal;}
    emit({eventVersion:1,type:'fallback',audience:'diagnostic',recovered:true,code:'BACKEND_ERROR',detail:fallbackReason});diagnose('fallback','Active backend failed; baseline rendered',{kind:'fallback',error:String(error),from:active.id,to:baseline.id,scope});
   }
   fillMetrics(active);const frameEnd=performance.now();metricsScratch.cpuFrameMs=frameEnd-start;if(metricsScratch.drawCalls<0)metricsScratch.drawCalls=ownedRenderer?.info.render.calls??0;metricsScratch.triangles=metricsScratch.totalSubmittedTriangles??ownedRenderer?.info.render.triangles??0;profiler.record(metricsScratch);
   // Snapshot construction and enqueueing happen after cpuFrameMs is closed;
   // the channel defers all observer work to a later microtask.
   if(diagnosticChannel.enabled&&diagnosticChannel.detail==='trace'){
    const pendingUrls=[...(active.pendingUrls?.()??[])],protectedOrRequestedPageIds=[...new Set([...pendingUrls,...(active.pageUrls?.()??[])].map(url=>pageIdByUrl.get(url)??url))],stream=streamer.stats(),backendReport=active.metrics();
    diagnose('frame','Rendered frame',{kind:'frame',nature:measuring?'measurement':'beauty',timingScope:'host-render',scope,frame:frameNumber,backend:active.id,camera:{position:camera.position.toArray(),target:lookAtTarget.toArray(),fov:camera.fov,near:camera.near,far:camera.far},timestamp:Date.now(),metrics:{...metricsScratch},selection:{clusters:metricsScratch.clusters,selectedTriangles:metricsScratch.selectedTriangles,frustumRejected:metricsScratch.frustumRejected,lodLevel:metricsScratch.lodLevel},display:{protectedOrRequestedPageIds,selectedTriangles:metricsScratch.selectedTriangles,submittedTriangles:metricsScratch.submittedTriangles},cache:{residentPages:metricsScratch.residentPages,cacheResident:stream.resident,cacheEvictions:stream.evictions,reason:'cache-eviction-is-separate-from-display-detachment'},reportedDrawStats:{drawCalls:metricsScratch.drawCalls,submittedTriangles:metricsScratch.submittedTriangles,geometryAllocationBytes:metricsScratch.geometryAllocationBytes,batchRebuilds:backendReport.batchRebuilds??null,batchIndexBytesUpdated:backendReport.batchIndexBytesUpdated??null,displayDetachments:backendReport.displayDetachments??null}});
   }
   return metricsScratch;
  };
  const presentationDiagnostics=new Set<string>(),visiblePresentationDiagnostics=new Set<string>();
  const logVisiblePresentation=()=>{if(visiblePresentationDiagnostics.has(active.id)||ownedRenderer.getRenderTarget()!==null)return;visiblePresentationDiagnostics.add(active.id);const pixel=new Uint8Array(4);try{const gl=ownedRenderer.getContext();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);diagnose('visible-presentation','Premier relevé du framebuffer WebGL visible',{kind:'presentation',engine:active.id,...presentationColorDiagnostic(pixel,1,1,options.clearColor??DEFAULT_CLEAR_COLOR,'default-webgl-framebuffer')});}catch(error){diagnose('visible-presentation','Lecture du framebuffer WebGL visible indisponible',{kind:'error',engine:active.id,error:String(error),surface:'default-webgl-framebuffer'});}};
  const capture=()=>{check();if(directGpu&&active.capture)return active.capture();logVisiblePresentation();const previous=ownedRenderer.getRenderTarget();try{ownedRenderer.setRenderTarget(null);active.render(camera);ownedRenderer.render(active.scene,camera);const size=canvas.width*canvas.height*4;captureSlot=(captureSlot+1)%3;if(capturePool[captureSlot].length!==size)capturePool[captureSlot]=new Uint8Array(size);const pixels=capturePool[captureSlot];const gl=ownedRenderer.getContext();gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(!presentationDiagnostics.has(active.id)){presentationDiagnostics.add(active.id);diagnose('presentation-capture','Premier relevé de la composition finale WebGL',{kind:'presentation',engine:active.id,...presentationColorDiagnostic(pixels,canvas.width,canvas.height,options.clearColor??DEFAULT_CLEAR_COLOR,'default-webgl-framebuffer')});}return pixels;}finally{ownedRenderer.setRenderTarget(previous);}};
  const dispose=()=>{if(disposed)return;diagnose('dispose-start','Explorer disposal started',{kind:'lifecycle',scope,backend:active.id});diagnosticChannel.flushSync();disposed=true;profiler.dispose();hostedControls.splice(0).forEach(c=>{try{c.dispose();}catch{/* Hosted controls cannot block explorer teardown. */}});disposeTargets();pairTargetA?.dispose();pairTargetB?.dispose();compositor?.dispose();streamer.dispose();overlays.forEach(m=>m.dispose());backends.forEach(b=>b.dispose());disposeSource(source!);ownedRenderer?.dispose();ownedRenderer?.forceContextLoss();try{gpuDevice?.destroy();}catch{/* Device may already be lost. */}diagnose('dispose-complete','Explorer disposal completed',{kind:'lifecycle',scope});diagnosticChannel.flushSync();diagnosticChannel.close();};
  const flush=async()=>{check();if(streamingPromise)await streamingPromise;for(const backend of backends)await backend.flush?.();await diagnosticChannel.flush();};
  const awaitPages=async()=>{
   check();if(streamingPromise)await streamingPromise;
   for(const backend of backends){
    await awaitBackendPages(backend,camera,async missing=>{
     await streamer.request(missing);
     for(const url of missing){
      if(geometryUrls.has(url)){
       const bytes=streamer.getBytes(url);if(bytes)backend.acceptGeometryPage?.(url,await decodeGeometryPage(bytes));
      }else{
       const array=streamer.get(url);if(array)backend.acceptPage?.(url,array);
      }
     }
    });
    const urls=backend.pageUrls?.();if(urls)streamer.retain(urls);
   }
   loaded=streamer.stats().loaded;pageBytesRead=streamer.stats().bytesRead;
  };
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
  return {capabilities,get fallbackReason(){return fallbackReason;},preparationMs:performance.now()-preparationStart,camera,center,bounds,metadata,backends,canvas,render,capture,dispose,setPose,awaitPages,flush,
   addInstance(id:string,transform:THREE.Matrix4){check();if(!active.addInstance)throw new EngineError('UNSUPPORTED_SCENE_UPDATE',`${active.id} does not support instance insertion`);active.addInstance(id,transform);},
   updateInstance(id:string,transform:THREE.Matrix4){check();if(!active.updateInstance)throw new EngineError('UNSUPPORTED_SCENE_UPDATE',`${active.id} does not support instance transforms`);active.updateInstance(id,transform);},
   removeInstance(id:string){check();if(!active.removeInstance)throw new EngineError('UNSUPPORTED_SCENE_UPDATE',`${active.id} does not support instance removal`);active.removeInstance(id);},
   updateMaterial(primitive:string,material:THREE.Material){check();if(!active.updateMaterial)throw new EngineError('UNSUPPORTED_SCENE_UPDATE',`${active.id} does not support material updates`);active.updateMaterial(primitive,material);},
   replaceGeometryPage(url:string,data:import('./geometryPage.ts').DecodedGeometryPage){check();if(!active.replaceGeometryPage)throw new EngineError('UNSUPPORTED_SCENE_UPDATE',`${active.id} does not support geometry page updates`);active.replaceGeometryPage(url,data);active.syncResident?.();},
   async renderViews(poses:readonly CameraPose[]){check();const views:StablePreview[]=[];for(const pose of poses){render(pose);await flush();views.push({scope,origin:'bottom-left',rgba:capture().slice(),width:canvas.width,height:canvas.height,backend:active.id});}return views;},
   refreshSceneLighting(){check();for(const backend of backends)backend.refreshSceneLighting?.();},
   async captureSurfaceView(pose:CameraPose,size:{width:number;height:number;signal?:AbortSignal}){check();if(!active.captureSurfaceView)throw new Error('SURFACE_CAPTURE_UNSUPPORTED');const view=camera.clone();view.position.fromArray(pose.position);view.fov=pose.fov;view.near=pose.near;view.far=pose.far;view.aspect=size.width/size.height;view.lookAt(new THREE.Vector3().fromArray(pose.target));view.updateProjectionMatrix();view.updateMatrixWorld();capturingSurface=true;try{return await active.captureSurfaceView(view,size);}finally{capturingSurface=false;}},
   resize(width:number,height:number){check();if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)throw new Error("Invalid viewport size");if(directGpu){canvas.width=Math.floor(width*(options.pixelRatio??DEFAULT_PIXEL_RATIO));canvas.height=Math.floor(height*(options.pixelRatio??DEFAULT_PIXEL_RATIO));}else ownedRenderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();viewport[0]=canvas.width;viewport[1]=canvas.height;measurementTarget?.setSize(width,height);pairTargetA?.setSize(width,height);pairTargetB?.setSize(width,height);},
   select(id:string){check();if((diagnostic==='clusters'||diagnostic==='pages'||diagnostic==='lod'||diagnostic==='visibility'||diagnostic==='screen-error')&&id!=='exact-cluster-pages'&&id!=='three-lod'&&id!=='webgpu-page-raster')throw new Error('Reference has no clusters; switch to beauty first');const selected=backends.find(b=>b.id===id);if(!selected)throw new Error(`Unknown backend: ${id}`);active=selected;},
   setComparison(layout:ComparisonLayout,pair?:[string,string],nextWipe?:number,nextToggle?:0|1){check();if(directGpu&&layout!=='single')throw new Error('SINGLE_BACKEND_COMPARISON');comparisonLayout=layout;if(pair)comparisonPair=pair;if(nextWipe!==undefined)wipe=nextWipe;if(nextToggle!==undefined)toggle=nextToggle;},
   get comparison(){return {layout:comparisonLayout,pair:comparisonPair,wipe,toggle};},
   setPixelError(value:number){check();if(!Number.isFinite(value)||value<0)throw new Error('Invalid pixelError');context.pixelError=value;},
   pointsOfInterest():Array<PointOfInterest>{const home=this.homePose();const extras=(options.pointsOfInterest??[]).filter(point=>point&&typeof point.id==='string'&&typeof point.label==='string'&&point.pose);return [{id:'home',label:'Home',pose:home},...extras];},
   resetHome(){check();camera.position.copy(center).add(homeOffset);lookAtTarget.copy(center);camera.lookAt(center);camera.updateMatrixWorld();},
   restoreAfterCampaign(id:string,saved:THREE.PerspectiveCamera){if(disposed)return;measuring=false;ownedRenderer?.setRenderTarget(null);active=backends.find(b=>b.id===id)!;camera.copy(saved);lookAtTarget.copy(center);},
   setMeasurementSurface(enabled:boolean){check();measuring=enabled;if(!enabled)ownedRenderer?.setRenderTarget(null);},
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
 }catch(error){diagnose('error','Explorer preparation failed',{kind:'error',error:String(error),scope,manifestUrl});disposeTargets();backends.forEach(b=>b.dispose());if(source)disposeSource(source);renderer?.dispose();try{gpuDevice?.destroy();}catch{/* Device may already be lost. */}diagnosticChannel.flushSync();diagnosticChannel.close();throw error;}
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
  notify('verify',i,path.length,'Comparaison exacte des pixels');explorer.select(ids[0]);explorer.setPose(path[i]);await explorer.awaitPages();explorer.render();await explorer.flush();const a=explorer.capture();explorer.render();await explorer.flush();const aa=explorer.capture();const repeat=compareImages(a,aa);let foreground=0;for(let pixel=0;pixel<a.length;pixel+=4)if(a[pixel]!==a[0]||a[pixel+1]!==a[1]||a[pixel+2]!==a[2])foreground++;
  if(i===0)options.onPreview?.({scope:explorer.metadata.scope,origin:'bottom-left',rgba:a.slice(),width:explorer.canvas.width,height:explorer.canvas.height,backend:ids[0]});
  for(const id of ids.slice(1)){explorer.select(id);await explorer.awaitPages();explorer.render();await explorer.flush();const image=compareImages(a,explorer.capture());quality.push({backend:id,pose:i,foreground,repeat,image});const epsilon=explorer.backends.find(b=>b.id===id)?.capabilities.renderer.includes('WebGPU')?2:0;if(!foreground||repeat.differentPixels||image.maxChannelError>epsilon)return {status:'not-run' as const,reason:'Exact image gate failed; no timing campaign',quality,blocks};}
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
