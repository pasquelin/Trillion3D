import {adaptivePixelError,clusterErrorPixels,DAG_ERROR_MODEL,EngineError,maxStretch,pageCarriesClusterError,primitiveUsesClusterErrors, type ClusterManifest, type ClusterStructure, type CullingHierarchy, type Page, type Primitive, type StreamCatalogue} from '../sdk-core/index.ts';
import * as THREE from 'three';
import {OPEN_CONE,coneCullsPage,type NormalCone} from './pageCone.ts';
import {isTransmissive} from './visibilityBuffer.ts';

export type PageRec = {
 id:number;url:string;clusterId:string;array?:Uint32Array;triangles:number;indexBytes:number;
 min:number[];max:number[];role?:'exact'|'coarse';
 /** Flat DAG cut, copied from the page. Absent on caches without a per-cluster error. */
 level?:number;lodError?:number;sphere?:number[];parentError?:number|null;parentSphere?:number[]|null;
 /** Group that replaces this cluster, and group that produced it. */
 group?:number|null;source?:number|null;
 /** Streaming bundle that carries this cluster, and its byte offset inside it. Residency is a
  *  property of the bundle: one request makes dozens of clusters drawable at once. */
 streamUrl?:string;streamOffset?:number;
 attributes:THREE.BufferGeometry['attributes'];
 material:THREE.Material|THREE.Material[];
 transparent?:boolean;sourceMesh?:THREE.Mesh;sourceOrder?:number;
 matrix:THREE.Matrix4;renderOrder:number;
 geometry?:THREE.BufferGeometry;mesh?:THREE.Mesh;attached:boolean;seen:number;resident?:boolean;
 cone?:NormalCone;
 /** Rang de la clé de requête, posé une fois par `indexPageRequests` : dédoublonnage sans hachage. */
 requestIndex?:number;
 /** Rang de la clé de cluster dans le catalogue de l'hôte, posé une fois : résidence et épinglage sans
  *  hachage. L'hôte le pose, personne d'autre ne le lit. */
 keyIndex?:number;
};

function pageIsDoubleSided(material:THREE.Material|THREE.Material[]|undefined){
 if(!material)return false;
 const side=Array.isArray(material)?material[0]?.side:material.side;
 return side===THREE.DoubleSide;
}

function coneSkipsPage(rec:{cone?:NormalCone;min?:number[];max?:number[];material?:THREE.Material|THREE.Material[]},world:THREE.Matrix4,camera:THREE.PerspectiveCamera,fallbackMin:number[],fallbackMax:number[]){
 if(pageIsDoubleSided(rec.material))return false;
 const min=rec.min??fallbackMin,max=rec.max??fallbackMax;
 return coneCullsPage(rec.cone??OPEN_CONE,world,min,max,camera,rec.material);
}

/** Validate and unpack the flat culling hierarchy. Absent or malformed, the flat path scans pages. */
function cullingNodes(culling:CullingHierarchy|null|undefined,pageCount:number){
 if(!culling||!Array.isArray(culling.nodes)||culling.stride<15||culling.count<1)return undefined;
 if(culling.nodes.length!==culling.count*culling.stride)throw new Error('Hierarchie de culling incoherente');
 const nodes=Float64Array.from(culling.nodes);
 for(let node=0;node<culling.count;node++){
  const base=node*culling.stride,children=nodes[base+12];
  if(children>0){if(nodes[base+11]+children>culling.count)throw new Error('Hierarchie de culling incoherente');continue;}
  if(nodes[base+13]+nodes[base+14]>pageCount)throw new Error('Hierarchie de culling incoherente');
 }
 return {nodes,stride:culling.stride};
}

/** Only the fields a flat cut needs; a page without them keeps the hierarchy path.
 *  Always the same shape, so every page record stays one hidden class in the selection loop. */
const NO_CLUSTER_ERROR={level:undefined,lodError:undefined,sphere:undefined,parentError:undefined,parentSphere:undefined,group:undefined,source:undefined} as const;
function clusterErrorFields(page:Page):{level?:number;lodError?:number;sphere?:number[];parentError?:number|null;parentSphere?:number[]|null;group?:number|null;source?:number|null}{
 if(!pageCarriesClusterError(page))return NO_CLUSTER_ERROR;
 const parent=typeof page.parentError==='number'&&Number.isFinite(page.parentError)?page.parentError:null;
 if(parent!==null&&!(Array.isArray(page.parentSphere)&&page.parentSphere.length===4))throw new Error(`Page ${page.id}: parentError sans parentSphere`);
 if(parent!==null&&parent<page.lodError!)throw new Error(`Page ${page.id}: parentError sous lodError`);
 return {level:page.level,lodError:page.lodError,sphere:page.sphere,parentError:parent,parentSphere:parent===null?null:page.parentSphere,
  group:typeof page.group==='number'?page.group:null,source:typeof page.source==='number'?page.source:null};
}

/**
 * Group links of a primitive, flattened once and shared by every instance of it.
 *
 * `children` and `outputs` of a group cover the same surface, never both at once, so replacing one
 * by the other is always a complete swap. `sources` and `owners` say, for a cluster, which group
 * produced it and which group replaces it.
 */
export type ClusterStructureIndex={
 groupCount:number;
 childOffsets:Int32Array;children:Int32Array;
 outputOffsets:Int32Array;outputs:Int32Array;
 sources:Int32Array;owners:Int32Array;
 error:Float64Array;sphere:Float64Array;
 roots:readonly number[];
};
function structureIndex(structure:ClusterStructure|null|undefined,pageCount:number):ClusterStructureIndex|undefined{
 if(!structure||!Array.isArray(structure.groups)||!Array.isArray(structure.roots))return undefined;
 const groupCount=structure.groups.length;
 if(!groupCount)return undefined;
 const childOffsets=new Int32Array(groupCount+1),outputOffsets=new Int32Array(groupCount+1);
 for(let g=0;g<groupCount;g++){
  childOffsets[g+1]=childOffsets[g]+structure.groups[g].children.length;
  outputOffsets[g+1]=outputOffsets[g]+structure.groups[g].outputs.length;
 }
 const children=new Int32Array(childOffsets[groupCount]),outputs=new Int32Array(outputOffsets[groupCount]);
 const sources=new Int32Array(pageCount).fill(-1),owners=new Int32Array(pageCount).fill(-1);
 const error=new Float64Array(groupCount),sphere=new Float64Array(groupCount*4);
 for(let g=0;g<groupCount;g++){
  const group=structure.groups[g];
  if(!(group.error>=0)||!Array.isArray(group.sphere)||group.sphere.length!==4)throw new Error(`Groupe ${g} sans erreur ni bornes`);
  error[g]=group.error;for(let a=0;a<4;a++)sphere[g*4+a]=group.sphere[a];
  let at=childOffsets[g];
  for(const child of group.children){
   if(!(child>=0&&child<pageCount))throw new Error(`Groupe ${g} reference une page inconnue`);
   if(owners[child]>=0)throw new Error(`Page ${child} appartient a deux groupes`);
   owners[child]=g;children[at++]=child;
  }
  at=outputOffsets[g];
  for(const output of group.outputs){
   if(!(output>=0&&output<pageCount))throw new Error(`Groupe ${g} reference une page inconnue`);
   if(sources[output]>=0)throw new Error(`Page ${output} est produite par deux groupes`);
   sources[output]=g;outputs[at++]=output;
  }
 }
 for(const root of structure.roots)if(!(root>=0&&root<pageCount&&owners[root]<0))throw new Error('Racine de structure invalide');
 return {groupCount,childOffsets,children,outputOffsets,outputs,sources,owners,error,sphere,roots:structure.roots};
}
/** Bundle URL and offset of every page, or undefined when the cache predates streaming bundles. */
function streamPlacement(streams:StreamCatalogue|null|undefined,pages:readonly Page[]){
 if(!streams||!Array.isArray(streams.pages)||!streams.pages.length)return undefined;
 const placement=pages.map(page=>{
  if(typeof page.stream!=='number'||typeof page.streamOffset!=='number')return undefined;
  const bundle=streams.pages[page.stream];
  if(!bundle)throw new Error(`Page ${page.id} hors des paquets de streaming`);
  if(page.streamOffset+page.count*4>bundle.bytes)throw new Error(`Page ${page.id} depasse son paquet`);
  return {url:bundle.url,offset:page.streamOffset};
 });
 return placement.every(entry=>entry)?placement as Array<{url:string;offset:number}>:undefined;
}

function objects(source:THREE.Object3D){
 const meshes:THREE.Mesh[]=[];
 source.updateMatrixWorld(true);
 source.traverse(o=>{if((o as THREE.Mesh).isMesh)meshes.push(o as THREE.Mesh);});
 return meshes;
}

/**
 * One primitive instance as the selection sees it: its clusters, the world matrix that places them,
 * its flat culling hierarchy and its group links. There is no tree — every cluster carries its own
 * screen-error band, and the hierarchy is only a traversal accelerator.
 */
export type ClusterRoot<T>={
 world:THREE.Matrix4;pages:T[];
 culling?:{nodes:Float64Array;stride:number};worldBox?:THREE.Box3;
 stretch?:number;stretchKey?:Float64Array;
 structure?:ClusterStructureIndex;forced?:Uint8Array;forcedList?:number[];
};

/** Build exact-cluster page records and validate coverage. Shared by WebGL and WebGPU backends. */
export function collectClusterPages(source:THREE.Object3D,metadata:ClusterManifest,indices:Map<string,Uint32Array>,associations:Map<THREE.Object3D,{meshes?:number;primitives?:number}>,options:{allowMissing?:boolean}={}){
 const roots:Array<ClusterRoot<PageRec>>=[],allPages:PageRec[]=[],blendCopies:THREE.Mesh[]=[],bootstrap:PageRec[]=[];
 const structures=new Map<Primitive,ClusterStructureIndex|undefined>();
 let order=0;
 for(const mesh of objects(source)){
  const association=associations.get(mesh),primitive=metadata.primitives.find(p=>p.mesh===association?.meshes&&p.primitive===(association?.primitives??0));
  if(!primitive)throw new Error(`Missing primitive association: ${mesh.name}`);
  if(primitive.pass==='shared-blend'||isTransmissive(mesh.material)){const copy=new THREE.Mesh(mesh.geometry,mesh.material);copy.matrixAutoUpdate=false;copy.matrix.copy(mesh.matrixWorld);copy.frustumCulled=mesh.frustumCulled;copy.renderOrder=order++;copy.userData.sourceMesh=mesh;blendCopies.push(copy);continue;}
  const sourceIndices=mesh.geometry.getIndex();if(!sourceIndices)throw new Error('Indexed source required');
  const src=sourceIndices.array as ArrayLike<number>;
  const transparent=primitive.pass==='clustered-blend'||(Array.isArray(mesh.material)?mesh.material.some(material=>material.transparent):mesh.material.transparent);
  // A flat cut has no tree; transparent pages recover their draw order from the recorded source rank.
  const sourceOrder=transparent?primitive.pages.map((page,index)=>page.start??index):undefined;
  const exactPages=primitive.pages.filter(page=>(page.role??'exact')!=='coarse');
  const placement=streamPlacement(primitive.streams,primitive.pages);
  let sourceOffset=0;
  const pages=primitive.pages.map((page,pageIndex)=>{const array=indices.get(page.url);if(!array&&!options.allowMissing&&indices.size)throw new Error('Missing page');
   if(array&&(page.role??'exact')!=='coarse')sourceOffset+=array.length;
   else if(!array&&(page.role??'exact')!=='coarse')sourceOffset+=page.count;
   const cut=clusterErrorFields(page);
   const placed=placement?.[pageIndex];
   const rec:PageRec={id:page.id,url:page.url,clusterId:`${primitive.mesh}/${primitive.primitive}/${page.id}`,array,triangles:page.count/3,indexBytes:array?.byteLength??page.bytes,min:page.min,max:page.max,role:page.role,
    level:cut.level,lodError:cut.lodError,sphere:cut.sphere,parentError:cut.parentError,parentSphere:cut.parentSphere,group:cut.group,source:cut.source,
    streamUrl:placed?.url,streamOffset:placed?.offset,
    attributes:mesh.geometry.attributes,material:mesh.material,transparent,sourceMesh:mesh,sourceOrder:sourceOrder?.[pageIndex]??pageIndex,matrix:mesh.matrixWorld,renderOrder:order,attached:false,seen:0,cone:undefined,geometry:undefined,mesh:undefined,resident:false};
   allPages.push(rec);return rec;});
  order++;
  const complete=primitive.pages.every(page=>indices.has(page.url)||(page.role??'exact')==='coarse');
  if(complete&&sourceOffset!==sourceIndices.count)throw new Error('Incomplete cluster coverage');
  // The DAG reorders triangles, so coverage is a multiset identity, never an order identity.
  if(complete){
   const count=(arr:ArrayLike<number>)=>{const map=new Map<string,number>();for(let i=0;i<arr.length;i+=3){const key=`${arr[i]},${arr[i+1]},${arr[i+2]}`;map.set(key,(map.get(key)??0)+1);}return map;};
   const fromPages=count(exactPages.flatMap(page=>[...indices.get(page.url)!]));
   const fromSource=count(src);
   if(fromPages.size!==fromSource.size)throw new Error('Incomplete cluster coverage');
   for(const [key,n] of fromSource)if(fromPages.get(key)!==n)throw new Error('Page/source index mismatch');
  }
  if(!primitiveUsesClusterErrors(primitive))throw new EngineError('STALE_CACHE',`Primitive ${primitive.mesh}/${primitive.primitive}: clusters without a DAG error band; recompile with ${DAG_ERROR_MODEL}`,{mesh:primitive.mesh,primitive:primitive.primitive,expected:DAG_ERROR_MODEL});
  if(!structures.has(primitive))structures.set(primitive,structureIndex(primitive.structure,primitive.pages.length));
  const structure=structures.get(primitive);
  const culling=cullingNodes(primitive.culling,pages.length);
  const local=new THREE.Box3();
  if(culling)local.set(new THREE.Vector3(culling.nodes[0],culling.nodes[1],culling.nodes[2]),new THREE.Vector3(culling.nodes[3],culling.nodes[4],culling.nodes[5]));
  else for(const page of primitive.pages)local.union(new THREE.Box3(new THREE.Vector3(...page.min as [number,number,number]),new THREE.Vector3(...page.max as [number,number,number])));
  roots.push({world:mesh.matrixWorld,pages,culling,worldBox:local.clone().applyMatrix4(mesh.matrixWorld),
   structure,forced:structure?new Uint8Array(structure.groupCount):undefined,forcedList:structure?[]:undefined});
  // The clusters nothing replaces are the coarsest complete cover; they stay resident so the cut
  // always has something to fall back on.
  if(structure)for(const root of structure.roots)bootstrap.push(pages[root]);
 }
 return {roots,allPages,blendCopies,bootstrap,requestCount:indexPageRequests(allPages),prepared:metadata.primitives.reduce((n,p)=>n+p.pages.length,0)};
}

export function resolvePixelError(context:{pixelError?:number;lodAdaptive?:boolean},camera:THREE.PerspectiveCamera,motion:{last?:THREE.Vector3;lastMs?:number}){
 const base=context.pixelError??0;
 const now=typeof performance!=='undefined'?performance.now():0;
 let speed=0;
 if(motion.last&&motion.lastMs!=null){
  const dt=Math.max((now-motion.lastMs)/1000,1e-4);
  speed=camera.position.distanceTo(motion.last)/dt;
 }
 if(!motion.last)motion.last=new THREE.Vector3();
 motion.last.copy(camera.position);motion.lastMs=now;
 if(!context.lodAdaptive||!(base>0))return base;
 return adaptivePixelError(base,speed,Math.max(camera.far*0.05,1));
}
/** The request key of a record: its streaming bundle when the cache has one, its own page otherwise. */
export function pageRequestUrl<T extends {url:string;streamUrl?:string}>(rec:T){return rec.streamUrl??rec.url;}
/** Numérote les clés de requête distinctes une fois pour toutes ; renvoie leur nombre. */
function indexPageRequests<T extends {url:string;streamUrl?:string;requestIndex?:number}>(pages:readonly T[]){
 const byKey=new Map<string,number>();
 for(let i=0;i<pages.length;i++){
  const key=pageRequestUrl(pages[i]);let rank=byKey.get(key);
  if(rank===undefined){rank=byKey.size;byKey.set(key,rank);}
  pages[i].requestIndex=rank;
 }
 return byKey.size;
}
/**
 * Dédoublonnage des clés de requête sans table de hachage : une estampille par rang, réutilisée d'une
 * image à l'autre. Une coupe de quinze mille pages est parcourue sans allouer ni hacher.
 */
export class RequestStamps{
 private stamps:Int32Array;
 private current=0;
 constructor(count:number){this.stamps=new Int32Array(Math.max(0,count));}
 /** Ouvre un passage : tout ce qui a été vu avant est oublié. */
 begin(){this.current++;}
 /** Vrai la première fois que ce rang est vu depuis `begin()`. Un rang inconnu n'est jamais filtré. */
 first(index:number|undefined){
  if(index===undefined||index<0||index>=this.stamps.length)return true;
  if(this.stamps[index]===this.current)return false;
  this.stamps[index]=this.current;return true;
 }
}
export function indexPagesByUrl<T extends {url:string;streamUrl?:string}>(pages:readonly T[]){
 const byUrl=new Map<string,T[]>();
 for(let i=0;i<pages.length;i++){
  const rec=pages[i],key=pageRequestUrl(rec);let list=byUrl.get(key);if(!list)byUrl.set(key,list=[]);list.push(rec);
 }
 return byUrl;
}
export function collectPendingUrls<T extends {array?:Uint32Array;url:string;streamUrl?:string;requestIndex?:number}>(shown:readonly T[],into:string[],stamps?:RequestStamps){
 into.length=0;
 if(stamps)stamps.begin();
 const seen=stamps?undefined:new Set<string>();
 for(let i=0;i<shown.length;i++){
  const rec=shown[i];
  if(rec.array)continue;
  const key=pageRequestUrl(rec);
  if(stamps){if(!stamps.first(rec.requestIndex))continue;}
  else{if(seen!.has(key))continue;seen!.add(key);}
  into.push(key);
 }
 return into;
}
/** Hand a loaded page or bundle to every record that shares it; a bundled record gets a view at its
 *  own offset, so one request makes dozens of clusters drawable. */
export function acceptPageArray<T extends {array?:Uint32Array;indexBytes:number;triangles:number;streamOffset?:number}>(recs:readonly T[],array:Uint32Array){
 for(let i=0;i<recs.length;i++){
  const rec=recs[i],offset=rec.streamOffset;
  const view=offset===undefined?array:array.subarray(offset/4,offset/4+rec.triangles*3);
  rec.array=view;rec.indexBytes=view.byteLength;
 }
}
const IDENTITY_WORLD=new THREE.Matrix4();
/** Tampons de travail de la sélection, réutilisés d'une image à l'autre : la coupe n'alloue rien.
 *  Ils ne survivent pas à l'appel, et la sélection est synchrone : un seul appel les occupe à la fois. */
const fallbackScratch:unknown[]=[],forceScratch:number[]=[];
const selectionScratch={frustum:new THREE.Frustum(),matrix:new THREE.Matrix4(),viewMatrix:new THREE.Matrix4(),box:new THREE.Box3(),corner:new THREE.Vector3(),viewMin:[Infinity,Infinity,Infinity] as [number,number,number],viewMax:[-Infinity,-Infinity,-Infinity] as [number,number,number],pixelScale:[1,1] as [number,number],clip:new THREE.Matrix4(),planes:new Float64Array(24),stack:new Int32Array(4096)};
export type ClusterCut={lodError?:number;sphere?:number[];parentError?:number|null;parentSphere?:number[]|null;group?:number|null;source?:number|null};
/** Rounds of ancestor escalation before the pinned root cover takes over; mirrors the GPU kernel. */
const FLAT_ESCALATION_ROUNDS=3;
/** Projected screen error of one (error, object-space sphere) pair, in the frame given by `e`. */
function projectedClusterError(error:number|null|undefined,sphere:ArrayLike<number>|null|undefined,offset:number,e:ArrayLike<number>,stretch:number,focal:number,near:number){
 // Exact geometry and clusters with no replacement need no projection at all, which is most of them.
 if(error===0)return 0;
 if(error==null||error===Infinity)return Infinity;
 if(!sphere)return Infinity;
 const cx=sphere[offset],cy=sphere[offset+1],cz=sphere[offset+2];
 const vx=e[0]*cx+e[4]*cy+e[8]*cz+e[12];
 const vy=e[1]*cx+e[5]*cy+e[9]*cz+e[13];
 const vz=e[2]*cx+e[6]*cy+e[10]*cz+e[14];
 return clusterErrorPixels(error,stretch,vx,vy,vz,sphere[offset+3],focal,near);
}
function cutSelects(rec:ClusterCut,e:ArrayLike<number>,stretch:number,focal:number,near:number,pixelError:number){
 if(projectedClusterError(rec.lodError??0,rec.sphere,0,e,stretch,focal,near)>pixelError)return false;
 return projectedClusterError(rec.parentError,rec.parentSphere??rec.sphere,0,e,stretch,focal,near)>pixelError;
}
/** Six frustum planes of `clip`, inward-facing, unnormalised: a point is inside when every ax+by+cz+d >= 0.
 *  Taken in the space `clip` maps from, so the caller never transforms a box. Allocation free. */
function extractPlanes(clip:THREE.Matrix4,planes:Float64Array){
 const m=clip.elements;
 const x0=m[0],x1=m[4],x2=m[8],x3=m[12];
 const y0=m[1],y1=m[5],y2=m[9],y3=m[13];
 const z0=m[2],z1=m[6],z2=m[10],z3=m[14];
 const w0=m[3],w1=m[7],w2=m[11],w3=m[15];
 planes[0]=w0+x0;planes[1]=w1+x1;planes[2]=w2+x2;planes[3]=w3+x3;
 planes[4]=w0-x0;planes[5]=w1-x1;planes[6]=w2-x2;planes[7]=w3-x3;
 planes[8]=w0+y0;planes[9]=w1+y1;planes[10]=w2+y2;planes[11]=w3+y3;
 planes[12]=w0-y0;planes[13]=w1-y1;planes[14]=w2-y2;planes[15]=w3-y3;
 planes[16]=w0+z0;planes[17]=w1+z1;planes[18]=w2+z2;planes[19]=w3+z3;
 planes[20]=w0-z0;planes[21]=w1-z1;planes[22]=w2-z2;planes[23]=w3-z3;
}
/** Axis-aligned box against the six planes: 0 outside, 1 straddling, 2 fully inside.
 *  A subtree that is fully inside spares every box below it a test. */
function boxClip(planes:Float64Array,minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number){
 let inside=2;
 for(let p=0;p<24;p+=4){
  const a=planes[p],b=planes[p+1],c=planes[p+2],d=planes[p+3];
  if(a*(a>0?maxX:minX)+b*(b>0?maxY:minY)+c*(c>0?maxZ:minZ)+d<0)return 0;
  if(inside===2&&a*(a>0?minX:maxX)+b*(b>0?minY:maxY)+c*(c>0?minZ:maxZ)+d<0)inside=1;
 }
 return inside;
}
/** CPU cut: frustum, per-cluster screen-error band and normal cone.
 *  `holdResident` keeps a complete cover until every replacement cluster is loaded. */
export function selectVisiblePages<T extends ClusterCut&{triangles:number;seen:number;level?:number;min?:number[];max?:number[];cone?:NormalCone;material?:THREE.Material|THREE.Material[];array?:Uint32Array}>(
 roots:ReadonlyArray<ClusterRoot<T>>,
 camera:THREE.PerspectiveCamera,
 options:{pixelError?:number;viewport?:[number,number];frame:number;holdResident?:boolean;isResident?:(page:T)=>boolean;rootFallback?:boolean;pageBudget?:number;wanted?:T[]},
 into?:T[]
){
 const viewport=options.viewport,frame=options.frame,hold=!!options.holdResident;
 // Threshold escalation towards the resident ancestor. Asked for by the WebGPU backend, which needs
 // the published cut to describe what it can draw; it is also the only repair available on a cache
 // that publishes no group structure.
 const rootFallback=hold&&!!options.rootFallback;
 // A cut wider than the page budget is answered with a coarser cut, never with dropped clusters:
 // dropping would punch holes, a coarser threshold only lowers detail everywhere at once.
 const budget=options.pageBudget&&options.pageBudget>0?options.pageBudget:0;
 let pixelError=options.pixelError??0;
 const pageResident=(rec:T)=>!hold||(options.isResident?options.isResident(rec):!!rec.array);
 const {frustum,matrix,viewMatrix}=selectionScratch;
 camera.updateMatrixWorld();
 frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const width=viewport?.[0]??1,height=viewport?.[1]??1;
 selectionScratch.pixelScale[0]=width*Math.abs(camera.projectionMatrix.elements[0])/2;selectionScratch.pixelScale[1]=height*Math.abs(camera.projectionMatrix.elements[5])/2;
 const shown=into??[] as T[];shown.length=0;
 // La coupe demandée est rendue à l'appelant : il fournit son propre tableau pour qu'une image n'en alloue aucun.
 const wanted=options.wanted??[] as T[];
 let frustumRejected=0,lodLevel=0,complete=true;
 /**
  * The cut: every cluster carries its own screen-error band, so nothing walks a tree for the LOD.
  * The culling hierarchy is only a traversal accelerator: a subtree is skipped when its box is out
  * of frustum, or when the largest replacement error it holds already fits the budget, in which case
  * no cluster below it can pass `parentError > pixelError`. Without a hierarchy the pages are scanned.
  * Frustum planes are taken in the primitive's own space, so no page box is ever transformed.
  */
 const {clip,planes,stack}=selectionScratch;
 let flatWorld=roots[0]?.world??IDENTITY_WORLD,flatStretch=1,flatFocal=1;
 let flatElements:ArrayLike<number>=flatWorld.elements;
 let flatStructure:ClusterStructureIndex|undefined;
 let flatForced:Uint8Array|undefined;
 let flatForcedList:number[]|undefined;
 // The stretch of a world matrix rarely changes; recomputing it needs an arccosine, comparing it
 // needs nine numbers. The camera's own stretch (1 unless it is scaled) bounds the product.
 const cameraStretch=maxStretch(camera.matrixWorldInverse.elements);
 const worldStretch=(root:{world:THREE.Matrix4;stretch?:number;stretchKey?:Float64Array})=>{
  const m=root.world.elements,key=root.stretchKey;
  if(key&&key[0]===m[0]&&key[1]===m[1]&&key[2]===m[2]&&key[3]===m[4]&&key[4]===m[5]&&key[5]===m[6]&&key[6]===m[8]&&key[7]===m[9]&&key[8]===m[10])return root.stretch as number;
  const next=key??(root.stretchKey=new Float64Array(9));
  next[0]=m[0];next[1]=m[1];next[2]=m[2];next[3]=m[4];next[4]=m[5];next[5]=m[6];next[6]=m[8];next[7]=m[9];next[8]=m[10];
  return root.stretch=maxStretch(m);
 };
 /**
  * Is this cluster the chosen representation of its region?
  *
  * A group is "coarse" when its own simplification already fits the budget, or when residency
  * forced it to be. A cluster is drawn when the group that produced it is coarse and the group that
  * replaces it is not, so each region is covered by exactly one cluster whatever the forcing.
  */
 const drawnUnderForcing=(rec:T)=>{
  const forced=flatForced as Uint8Array,source=rec.source;
  if(source!=null&&source>=0&&!forced[source]&&projectedClusterError(rec.lodError??0,rec.sphere,0,flatElements,flatStretch,flatFocal,camera.near)>pixelError)return false;
  const own=rec.group;
  if(own==null||own<0)return true;
  if(forced[own])return false;
  return projectedClusterError(rec.parentError,rec.parentSphere??rec.sphere,0,flatElements,flatStretch,flatFocal,camera.near)>pixelError;
 };
 /** Make a group coarse, and with it every group that produced one of its children: a coarse group
  *  only means something if everything finer below it is coarse too, or the surface is drawn twice.
  *  Groups already coarse through their own error stop the walk. */
 const forceCoarse=(start:number)=>{
  const structure=flatStructure as ClusterStructureIndex,forced=flatForced as Uint8Array,list=flatForcedList as number[];
  const pending=forceScratch;pending.length=0;pending.push(start);
  while(pending.length){
   const group=pending.pop() as number;
   if(forced[group])continue;
   forced[group]=1;list.push(group);
   for(let i=structure.childOffsets[group];i<structure.childOffsets[group+1];i++){
    const producer=structure.sources[structure.children[i]];
    if(producer<0||forced[producer])continue;
    if(projectedClusterError(structure.error[producer],structure.sphere,producer*4,flatElements,flatStretch,flatFocal,camera.near)<=pixelError)continue;
    pending.push(producer);
   }
  }
 };
 let flatInside=false,flatUseForcing=false,flatMissing=false,flatShort=false;
 /**
  * `wanted` is the cut the camera asks for and drives streaming; `shown` is what can actually be
  * drawn right now. The residency pass rebuilds `shown` alone, so a coarse fallback never hides the
  * finer clusters that still have to be fetched.
  *
  * `complete` says the wanted cut is fully resident, which is what the WebGL backend watches. Under
  * `rootFallback` the caller asks the opposite question — does the published cut have a hole? — so
  * a cluster still in flight is recorded in `flatMissing` and only a gap left after the repair is
  * reported as incomplete.
  */
 const take=(rec:T)=>{
  if(!rec.min||!rec.max)return;
  if(!flatInside&&boxClip(planes,rec.min[0],rec.min[1],rec.min[2],rec.max[0],rec.max[1],rec.max[2])===0){frustumRejected++;return;}
  if(!(flatUseForcing?drawnUnderForcing(rec):cutSelects(rec,flatElements,flatStretch,flatFocal,camera.near,pixelError)))return;
  if(rec.cone&&coneSkipsPage(rec,flatWorld,camera,rec.min,rec.max))return;
  if(!flatUseForcing){
   wanted.push(rec);
   if(rec.level!==undefined&&rec.level>lodLevel)lodLevel=rec.level;
   if(!pageResident(rec)){flatMissing=true;if(!rootFallback)complete=false;return;}
  }else if(!pageResident(rec)){
   // Nothing coarser covers this region; the pinned root cover is the last resort, taken by the caller.
   flatShort=true;
   if(!rootFallback)complete=false;
   return;
  }
  rec.seen=frame;shown.push(rec);
 };
 const flatVisible=(rec:T)=>!!rec.min&&!!rec.max&&boxClip(planes,rec.min[0],rec.min[1],rec.min[2],rec.max[0],rec.max[1],rec.max[2])!==0;
 const flatConeKeeps=(rec:T)=>!rec.cone||!coneSkipsPage(rec,flatWorld,camera,rec.min!,rec.max!);
 /**
  * Last resort for one primitive: draw the clusters no other cluster replaces. They are the pinned
  * bootstrap cover, so this always terminates on a complete cut. Returns false only when a root is
  * itself missing, which is the one case a caller may legitimately report as an incomplete frame.
  */
 const rootCoverInto=(pages:T[],start:number)=>{
  shown.length=start;
  let whole=true;
  for(let i=0;i<pages.length;i++){
   const rec=pages[i];
   if(rec.parentError!=null||!flatVisible(rec)||!flatConeKeeps(rec))continue;
   if(!pageResident(rec)){whole=false;continue;}
   rec.seen=frame;shown.push(rec);
  }
  return whole;
 };
 /**
  * Repair without a group structure. A wanted cluster is still loading: raise this primitive's
  * budget to the replacement band of every missing cluster — which is exactly the band of the
  * cluster that replaces it, so the coarser cover is selected in its place — and repeat while the
  * replacement is itself missing. When nothing resident covers the gap, the primitive falls back to
  * its pinned root clusters, which are never replaced and are always resident, so the published cut
  * never has a hole. Same algorithm and same number of rounds as the WebGPU kernel.
  */
 const repairFlat=(pages:T[],start:number)=>{
  const near=camera.near;
  let threshold=pixelError,hard=false;
  for(let round=0;round<=FLAT_ESCALATION_ROUNDS;round++){
   let raised=false;
   for(let i=0;i<pages.length;i++){
    const rec=pages[i];
    if(pageResident(rec)||!flatVisible(rec))continue;
    if(!cutSelects(rec,flatElements,flatStretch,flatFocal,near,threshold)||!flatConeKeeps(rec))continue;
    const parent=projectedClusterError(rec.parentError,rec.parentSphere??rec.sphere,0,flatElements,flatStretch,flatFocal,near);
    if(parent>0&&Number.isFinite(parent)){if(parent>threshold){threshold=parent;raised=true;}}
    else hard=true;
   }
   if(!raised)break;
   if(round===FLAT_ESCALATION_ROUNDS)hard=true;
  }
  shown.length=start;
  if(!hard)for(let i=0;i<pages.length;i++){
   const rec=pages[i];
   if(!flatVisible(rec)||!cutSelects(rec,flatElements,flatStretch,flatFocal,near,threshold)||!flatConeKeeps(rec))continue;
   if(!pageResident(rec)){hard=true;break;}
   rec.seen=frame;shown.push(rec);
  }
  if(!hard)return;
  if(!rootCoverInto(pages,start))complete=false;
 };
 const traverse=(pages:T[],culling?:{nodes:Float64Array;stride:number})=>{
  flatInside=false;
  if(!culling){for(let i=0;i<pages.length;i++)take(pages[i]);return;}
  const {nodes,stride}=culling;
  // Stack entries carry the "already fully inside the frustum" flag in their low bit.
  let top=0;stack[top++]=0;
  while(top>0){
   const entry=stack[--top];
   const base=(entry>>1)*stride;
   let inside=(entry&1)===1;
   if(!inside){
    const clipped=boxClip(planes,nodes[base],nodes[base+1],nodes[base+2],nodes[base+3],nodes[base+4],nodes[base+5]);
    if(clipped===0){frustumRejected++;continue;}
    inside=clipped===2;
   }
   const bound=nodes[base+10];
   if(bound>=0&&projectedClusterError(bound,nodes,base+6,flatElements,flatStretch,flatFocal,camera.near)<=pixelError)continue;
   const children=nodes[base+12];
   if(children>0){
    const first=nodes[base+11];
    if(top+children>stack.length)throw new Error('Pile de culling trop petite');
    const flag=inside?1:0;
    for(let child=0;child<children;child++)stack[top++]=((first+child)<<1)|flag;
    continue;
   }
   flatInside=inside;
   const firstPage=nodes[base+13],count=nodes[base+14];
   for(let i=0;i<count;i++)take(pages[firstPage+i]);
  }
 };
 const fallbackQueue=fallbackScratch as T[];
 const selectFlat=(root:ClusterRoot<T>)=>{
  const pages=root.pages;
  flatWorld=root.world;flatElements=viewMatrix.elements;
  flatStretch=worldStretch(root)*cameraStretch;
  flatFocal=Math.max(selectionScratch.pixelScale[0],selectionScratch.pixelScale[1]);
  extractPlanes(clip.multiplyMatrices(camera.projectionMatrix,viewMatrix),planes);
  flatStructure=root.structure;flatForced=root.forced;flatForcedList=root.forcedList;
  if(flatForced&&flatForcedList){for(let i=0;i<flatForcedList.length;i++)flatForced[flatForcedList[i]]=0;flatForcedList.length=0;}
  const startWanted=wanted.length,startShown=shown.length;
  flatUseForcing=false;flatMissing=false;
  traverse(pages,root.culling);
  if(!hold)return;
  if(!flatStructure||!flatForced||!flatForcedList){
   // No group structure published: the only repair is the threshold escalation, and it is only run
   // when the caller asked for a hole-free cut.
   if(rootFallback&&flatMissing)repairFlat(pages,startShown);
   return;
  }
  // Residency fallback: a chosen cluster that is not loaded makes its whole group step back to the
  // coarse representation that group produced, recursively, until something resident covers the
  // region. The roots are pinned, so the walk always terminates on a complete cover.
  fallbackQueue.length=0;
  for(let i=startWanted;i<wanted.length;i++)fallbackQueue.push(wanted[i]);
  flatUseForcing=true;
  let forcedAny=false;
  while(fallbackQueue.length){
   const rec=fallbackQueue.pop() as T;
   if(pageResident(rec))continue;
   if(!drawnUnderForcing(rec))continue;
   const own=rec.group;
   if(own==null||own<0)continue;
   if(flatForced[own])continue;
   forceCoarse(own);forcedAny=true;
   for(let i=flatStructure.outputOffsets[own];i<flatStructure.outputOffsets[own+1];i++)fallbackQueue.push(pages[flatStructure.outputs[i]]);
  }
  if(!forcedAny){
   // Nothing could step back: what is missing has no resident replacement below the roots, so the
   // primitive publishes its pinned root cover rather than a cut with a hole.
   if(rootFallback&&flatMissing&&!rootCoverInto(pages,startShown))complete=false;
   flatUseForcing=false;return;
  }
  shown.length=startShown;flatShort=false;
  traverse(pages,root.culling);
  flatUseForcing=false;
  // A group walk that still leaves a region uncovered ends on the same pinned root cover.
  if(rootFallback&&flatShort&&!rootCoverInto(pages,startShown))complete=false;
 };
 const sweep=()=>{
  shown.length=0;wanted.length=0;frustumRejected=0;lodLevel=0;complete=true;
  for(const root of roots){
   // A whole instance out of frustum costs one box test, not one matrix setup.
   if(root.worldBox&&!frustum.intersectsBox(root.worldBox)){frustumRejected++;continue;}
   viewMatrix.multiplyMatrices(camera.matrixWorldInverse,root.world);
   selectFlat(root);
  }
 };
 sweep();
 for(let attempt=0;budget&&shown.length>budget&&attempt<16;attempt++){
  pixelError=pixelError>0?pixelError*2:1;
  sweep();
 }
 let selectedTriangles=0,displayedTriangles=0;
 for(let i=0;i<wanted.length;i++)selectedTriangles+=wanted[i].triangles;
 for(let i=0;i<shown.length;i++)displayedTriangles+=shown[i].triangles;
 if(!wanted.length)selectedTriangles=displayedTriangles;
 return {shown,wanted,visible:wanted.length||shown.length,selectedTriangles,displayedTriangles,frustumRejected,lodLevel,complete,pixelError};
}

/** Camera-independent minimal complete cover. Shared page URLs may serve multiple instances.
 *  The cover is the set of clusters no other cluster replaces. */
export function rootCoverage<T extends {url:string;parentError?:number|null}>(roots:ReadonlyArray<{pages:T[]}>):T[]{
 const unique=new Map<string,T>();
 for(const root of roots){
  let found=0;
  for(const page of root.pages)if(page.parentError==null){unique.set(page.url,page);found++;}
  if(!found)throw new Error('INVALID_ROOT_COVERAGE');
 }
 return [...unique.values()];
}
