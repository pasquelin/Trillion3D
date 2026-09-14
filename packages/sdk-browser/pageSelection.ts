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
  // La borne d'un nœud est projetée à chaque image : elle est validée une fois, ici.
  const bound=nodes[base+10];
  if(bound>=0)validateBand(bound,nodes,base+6);
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
  // L'erreur du groupe est projetée par le repli à chaque image : validée une fois, ici.
  validateBand(error[g],sphere,g*4);
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
 /** Table plate des clusters, construite à la première coupe et valable pour toutes les suivantes. */
 table?:ClusterCutTable;
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
/** Doubles qu'un cluster occupe dans la boîte plate, puis dans les deux bandes d'erreur. */
const BOX_VALUES=6,BAND_VALUES=10;
/**
 * Tout ce que la coupe lit par cluster, en tableaux typés rangés par rang de cluster.
 *
 * La boucle par image ne touche plus un seul objet JavaScript tant qu'un cluster n'est pas retenu :
 * boîte, bandes d'erreur et liens de groupe se lisent à la suite en mémoire. Les valeurs sont celles
 * que la projection lisait sur l'enregistrement, validées une fois ici ; l'arithmétique par image est
 * terme pour terme la même, donc la coupe sélectionnée est identique.
 */
export type ClusterCutTable={
 count:number;
 /** minX,minY,minZ,maxX,maxY,maxZ par cluster. */
 box:Float64Array;
 /** 1 quand le cluster a une boîte ; sans boîte il n'est jamais retenu. */
 boxed:Uint8Array;
 /** Erreur propre, sphère propre, erreur du remplaçant, sa sphère. Une bande sans erreur ou sans
  *  sphère porte l'infini : elle raffine toujours, exactement comme l'absence de valeur avant. */
 band:Float64Array;
 /** 1 quand rien ne remplace ce cluster : il fait partie de la couverture racine épinglée. */
 unreplaced:Uint8Array;
 /** Groupe qui remplace le cluster, groupe qui l'a produit, niveau de coupe ; -1 quand absent. */
 group:Int32Array;source:Int32Array;level:Int32Array;
};
/** Une bande projetable : erreur finie positive et sphère finie de rayon positif. */
function validateBand(error:number,sphere:ArrayLike<number>,offset:number){
 if(error===0||error===Infinity)return;
 if(!(error>0)||!Number.isFinite(error))throw new Error('Parametres de cluster invalides');
 const radius=sphere[offset+3];
 if(!Number.isFinite(sphere[offset])||!Number.isFinite(sphere[offset+1])||!Number.isFinite(sphere[offset+2])||!Number.isFinite(radius)||radius<0)throw new Error('Parametres de cluster invalides');
}
/** Écrit une bande : l'infini dit « pas d'erreur ou pas de sphère », donc « raffine toujours ». */
function writeBand(band:Float64Array,at:number,error:number|null|undefined,sphere:ArrayLike<number>|null|undefined){
 if(error===0){band[at]=0;return;}
 if(error==null||error===Infinity||!sphere||sphere.length<4){band[at]=Infinity;return;}
 validateBand(error,sphere,0);
 band[at]=error;band[at+1]=sphere[0];band[at+2]=sphere[1];band[at+3]=sphere[2];band[at+4]=sphere[3];
}
/** Table plate d'une primitive, construite une fois : rien de ce qu'elle porte ne change ensuite. */
export function clusterCutTable(pages:ReadonlyArray<ClusterCut&{min?:number[];max?:number[];level?:number}>):ClusterCutTable{
 const count=pages.length;
 const box=new Float64Array(count*BOX_VALUES),boxed=new Uint8Array(count),band=new Float64Array(count*BAND_VALUES);
 const unreplaced=new Uint8Array(count);
 const group=new Int32Array(count).fill(-1),source=new Int32Array(count).fill(-1),level=new Int32Array(count).fill(-1);
 for(let i=0;i<count;i++){
  const rec=pages[i];
  if(rec.min&&rec.max){
   boxed[i]=1;const at=i*BOX_VALUES;
   box[at]=rec.min[0];box[at+1]=rec.min[1];box[at+2]=rec.min[2];
   box[at+3]=rec.max[0];box[at+4]=rec.max[1];box[at+5]=rec.max[2];
  }
  const at=i*BAND_VALUES;
  writeBand(band,at,rec.lodError??0,rec.sphere);
  writeBand(band,at+5,typeof rec.parentError==='number'?rec.parentError:null,rec.parentSphere??rec.sphere);
  if(rec.parentError==null)unreplaced[i]=1;
  if(typeof rec.group==='number'&&rec.group>=0)group[i]=rec.group;
  if(typeof rec.source==='number'&&rec.source>=0)source[i]=rec.source;
  if(typeof rec.level==='number')level[i]=rec.level;
 }
 return {count,box,boxed,band,unreplaced,group,source,level};
}
/** Tampons de travail de la sélection, réutilisés d'une image à l'autre : la coupe n'alloue rien.
 *  Ils ne survivent pas à l'appel, et la sélection est synchrone : un seul appel les occupe à la fois. */
const selectionScratch={frustum:new THREE.Frustum(),matrix:new THREE.Matrix4(),viewMatrix:new THREE.Matrix4(),pixelScale:[1,1] as [number,number],clip:new THREE.Matrix4(),planes:new Float64Array(24),stack:new Int32Array(4096)};
export type ClusterCut={lodError?:number;sphere?:number[];parentError?:number|null;parentSphere?:number[]|null;group?:number|null;source?:number|null};
/** Ce que la coupe exige d'un cluster : la contrainte de `selectVisiblePages`, nommée une fois. */
export type CutPage=ClusterCut&{triangles:number;seen:number;level?:number;min?:number[];max?:number[];cone?:NormalCone;material?:THREE.Material|THREE.Material[];array?:Uint32Array};
/** Ce que la sélection rend. Fourni par l'appelant, une image n'alloue même pas son résultat. */
export type SelectionResult<T>={shown:T[];wanted:T[];visible:number;selectedTriangles:number;displayedTriangles:number;frustumRejected:number;lodLevel:number;complete:boolean;pixelError:number};
/** Rounds of ancestor escalation before the pinned root cover takes over; mirrors the GPU kernel. */
const FLAT_ESCALATION_ROUNDS=3;
/**
 * Erreur écran d'une bande (erreur, sphère objet) dans le repère de `e`, sur des valeurs déjà
 * validées : l'arithmétique de `clusterErrorPixels`, terme pour terme, sans revalidation par image.
 */
function projectSphere(error:number,sphere:ArrayLike<number>,offset:number,e:ArrayLike<number>,stretch:number,focal:number,near:number){
 if(error===0)return 0;
 if(error===Infinity)return Infinity;
 const cx=sphere[offset],cy=sphere[offset+1],cz=sphere[offset+2];
 const vx=e[0]*cx+e[4]*cy+e[8]*cz+e[12];
 const vy=e[1]*cx+e[5]*cy+e[9]*cz+e[13];
 const vz=e[2]*cx+e[6]*cy+e[10]*cz+e[14];
 const distance=Math.sqrt(vx*vx+vy*vy+vz*vz)-sphere[offset+3]*stretch;
 if(!(distance>near))return Infinity;
 return (error*stretch*focal)/distance;
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
/**
 * État de la coupe en cours, tenu dans un seul objet de module : les étapes de la sélection sont des
 * fonctions de module, plus des fermetures recréées à chaque image. La sélection est synchrone et ne
 * se réentre pas, donc un exemplaire suffit.
 */
const NO_PAGES:CutPage[]=[];
const EMPTY_TABLE:ClusterCutTable={count:0,box:new Float64Array(0),boxed:new Uint8Array(0),band:new Float64Array(0),unreplaced:new Uint8Array(0),group:new Int32Array(0),source:new Int32Array(0),level:new Int32Array(0)};
const cut={
 pages:[] as ReadonlyArray<CutPage>,table:EMPTY_TABLE,
 world:IDENTITY_WORLD,elements:IDENTITY_WORLD.elements as ArrayLike<number>,
 stretch:1,focal:1,near:1,pixelError:0,frame:0,
 hold:false,rootFallback:false,isResident:undefined as ((page:CutPage)=>boolean)|undefined,
 camera:null as unknown as THREE.PerspectiveCamera,
 shown:[] as CutPage[],wanted:[] as CutPage[],
 structure:undefined as ClusterStructureIndex|undefined,forced:undefined as Uint8Array|undefined,forcedList:undefined as number[]|undefined,
 inside:false,useForcing:false,missing:false,short:false,
 frustumRejected:0,lodLevel:0,complete:true,
 /** Rangs retenus par la passe demandée de cette primitive, puis file du repli par groupe. */
 queue:new Int32Array(256),queued:0,
 /** Pile du marquage « groupe grossier ». */
 force:new Int32Array(64),
};
function grow(array:Int32Array,needed:number){
 let size=array.length||1;
 while(size<needed)size*=2;
 const next=new Int32Array(size);next.set(array);return next;
}
function resident(rec:CutPage){return !cut.hold||(cut.isResident?cut.isResident(rec):!!rec.array);}
function cutSelectsAt(index:number,pixelError:number){
 const band=cut.table.band,at=index*BAND_VALUES,e=cut.elements,stretch=cut.stretch,focal=cut.focal,near=cut.near;
 if(projectSphere(band[at],band,at+1,e,stretch,focal,near)>pixelError)return false;
 return projectSphere(band[at+5],band,at+6,e,stretch,focal,near)>pixelError;
}
/**
 * Is this cluster the chosen representation of its region?
 *
 * A group is "coarse" when its own simplification already fits the budget, or when residency
 * forced it to be. A cluster is drawn when the group that produced it is coarse and the group that
 * replaces it is not, so each region is covered by exactly one cluster whatever the forcing.
 */
function drawnUnderForcing(index:number){
 const table=cut.table,forced=cut.forced as Uint8Array,band=table.band,at=index*BAND_VALUES;
 const e=cut.elements,stretch=cut.stretch,focal=cut.focal,near=cut.near,pixelError=cut.pixelError;
 const source=table.source[index];
 if(source>=0&&!forced[source]&&projectSphere(band[at],band,at+1,e,stretch,focal,near)>pixelError)return false;
 const own=table.group[index];
 if(own<0)return true;
 if(forced[own])return false;
 return projectSphere(band[at+5],band,at+6,e,stretch,focal,near)>pixelError;
}
/** Make a group coarse, and with it every group that produced one of its children: a coarse group
 *  only means something if everything finer below it is coarse too, or the surface is drawn twice.
 *  Groups already coarse through their own error stop the walk. */
function forceCoarse(start:number){
 const structure=cut.structure as ClusterStructureIndex,forced=cut.forced as Uint8Array,list=cut.forcedList as number[];
 const e=cut.elements,stretch=cut.stretch,focal=cut.focal,near=cut.near,pixelError=cut.pixelError;
 let top=0;cut.force[top++]=start;
 while(top>0){
  const group=cut.force[--top];
  if(forced[group])continue;
  forced[group]=1;list.push(group);
  for(let i=structure.childOffsets[group];i<structure.childOffsets[group+1];i++){
   const producer=structure.sources[structure.children[i]];
   if(producer<0||forced[producer])continue;
   if(projectSphere(structure.error[producer],structure.sphere,producer*4,e,stretch,focal,near)<=pixelError)continue;
   if(top>=cut.force.length)cut.force=grow(cut.force,top+1);
   cut.force[top++]=producer;
  }
 }
}
function flatVisible(index:number){
 const table=cut.table;
 if(!table.boxed[index])return false;
 const at=index*BOX_VALUES,box=table.box;
 return boxClip(selectionScratch.planes,box[at],box[at+1],box[at+2],box[at+3],box[at+4],box[at+5])!==0;
}
function flatConeKeeps(index:number){
 const rec=cut.pages[index];
 return !rec.cone||!coneSkipsPage(rec,cut.world,cut.camera,rec.min as number[],rec.max as number[]);
}
/**
 * `wanted` is the cut the camera asks for and drives streaming; `shown` is what can actually be
 * drawn right now. The residency pass rebuilds `shown` alone, so a coarse fallback never hides the
 * finer clusters that still have to be fetched.
 *
 * `complete` says the wanted cut is fully resident, which is what the WebGL backend watches. Under
 * `rootFallback` the caller asks the opposite question — does the published cut have a hole? — so
 * a cluster still in flight is recorded in `missing` and only a gap left after the repair is
 * reported as incomplete.
 */
function take(index:number){
 const table=cut.table;
 if(!table.boxed[index])return;
 const at=index*BOX_VALUES,box=table.box;
 if(!cut.inside&&boxClip(selectionScratch.planes,box[at],box[at+1],box[at+2],box[at+3],box[at+4],box[at+5])===0){cut.frustumRejected++;return;}
 if(!(cut.useForcing?drawnUnderForcing(index):cutSelectsAt(index,cut.pixelError)))return;
 const rec=cut.pages[index];
 if(rec.cone&&coneSkipsPage(rec,cut.world,cut.camera,rec.min as number[],rec.max as number[]))return;
 if(!cut.useForcing){
  cut.wanted.push(rec);
  if(cut.queued>=cut.queue.length)cut.queue=grow(cut.queue,cut.queued+1);
  cut.queue[cut.queued++]=index;
  const level=table.level[index];
  if(level>cut.lodLevel)cut.lodLevel=level;
  if(!resident(rec)){cut.missing=true;if(!cut.rootFallback)cut.complete=false;return;}
 }else if(!resident(rec)){
  // Nothing coarser covers this region; the pinned root cover is the last resort, taken by the caller.
  cut.short=true;
  if(!cut.rootFallback)cut.complete=false;
  return;
 }
 rec.seen=cut.frame;cut.shown.push(rec);
}
/**
 * Last resort for one primitive: draw the clusters no other cluster replaces. They are the pinned
 * bootstrap cover, so this always terminates on a complete cut. Returns false only when a root is
 * itself missing, which is the one case a caller may legitimately report as an incomplete frame.
 */
function rootCoverInto(start:number){
 const table=cut.table,pages=cut.pages,shown=cut.shown;
 shown.length=start;
 let whole=true;
 for(let index=0;index<table.count;index++){
  if(!table.unreplaced[index]||!flatVisible(index)||!flatConeKeeps(index))continue;
  const rec=pages[index];
  if(!resident(rec)){whole=false;continue;}
  rec.seen=cut.frame;shown.push(rec);
 }
 return whole;
}
/**
 * Repair without a group structure. A wanted cluster is still loading: raise this primitive's
 * budget to the replacement band of every missing cluster — which is exactly the band of the
 * cluster that replaces it, so the coarser cover is selected in its place — and repeat while the
 * replacement is itself missing. When nothing resident covers the gap, the primitive falls back to
 * its pinned root clusters, which are never replaced and are always resident, so the published cut
 * never has a hole. Same algorithm and same number of rounds as the WebGPU kernel.
 */
function repairFlat(start:number){
 const table=cut.table,pages=cut.pages,band=table.band;
 const e=cut.elements,stretch=cut.stretch,focal=cut.focal,near=cut.near;
 let threshold=cut.pixelError,hard=false;
 for(let round=0;round<=FLAT_ESCALATION_ROUNDS;round++){
  let raised=false;
  for(let index=0;index<table.count;index++){
   if(resident(pages[index])||!flatVisible(index))continue;
   if(!cutSelectsAt(index,threshold)||!flatConeKeeps(index))continue;
   const at=index*BAND_VALUES;
   const parent=projectSphere(band[at+5],band,at+6,e,stretch,focal,near);
   if(parent>0&&Number.isFinite(parent)){if(parent>threshold){threshold=parent;raised=true;}}
   else hard=true;
  }
  if(!raised)break;
  if(round===FLAT_ESCALATION_ROUNDS)hard=true;
 }
 cut.shown.length=start;
 if(!hard)for(let index=0;index<table.count;index++){
  if(!flatVisible(index)||!cutSelectsAt(index,threshold)||!flatConeKeeps(index))continue;
  const rec=pages[index];
  if(!resident(rec)){hard=true;break;}
  rec.seen=cut.frame;cut.shown.push(rec);
 }
 if(!hard)return;
 if(!rootCoverInto(start))cut.complete=false;
}
/**
 * The cut: every cluster carries its own screen-error band, so nothing walks a tree for the LOD.
 * The culling hierarchy is only a traversal accelerator: a subtree is skipped when its box is out
 * of frustum, or when the largest replacement error it holds already fits the budget, in which case
 * no cluster below it can pass `parentError > pixelError`. Without a hierarchy the pages are scanned.
 * Frustum planes are taken in the primitive's own space, so no page box is ever transformed.
 */
function traverse(culling?:{nodes:Float64Array;stride:number}){
 cut.inside=false;
 const table=cut.table;
 if(!culling){for(let index=0;index<table.count;index++)take(index);return;}
 const {nodes,stride}=culling,stack=selectionScratch.stack,planes=selectionScratch.planes;
 const e=cut.elements,stretch=cut.stretch,focal=cut.focal,near=cut.near,pixelError=cut.pixelError;
 // Stack entries carry the "already fully inside the frustum" flag in their low bit.
 let top=0;stack[top++]=0;
 while(top>0){
  const entry=stack[--top];
  const base=(entry>>1)*stride;
  let inside=(entry&1)===1;
  if(!inside){
   const clipped=boxClip(planes,nodes[base],nodes[base+1],nodes[base+2],nodes[base+3],nodes[base+4],nodes[base+5]);
   if(clipped===0){cut.frustumRejected++;continue;}
   inside=clipped===2;
  }
  const bound=nodes[base+10];
  if(bound>=0&&projectSphere(bound,nodes,base+6,e,stretch,focal,near)<=pixelError)continue;
  const children=nodes[base+12];
  if(children>0){
   const first=nodes[base+11];
   if(top+children>stack.length)throw new Error('Pile de culling trop petite');
   const flag=inside?1:0;
   for(let child=0;child<children;child++)stack[top++]=((first+child)<<1)|flag;
   continue;
  }
  cut.inside=inside;
  const firstPage=nodes[base+13],count=nodes[base+14];
  for(let i=0;i<count;i++)take(firstPage+i);
 }
}
// The stretch of a world matrix rarely changes; recomputing it needs an arccosine, comparing it
// needs nine numbers. The camera's own stretch (1 unless it is scaled) bounds the product.
function worldStretch(root:{world:THREE.Matrix4;stretch?:number;stretchKey?:Float64Array}){
 const m=root.world.elements,key=root.stretchKey;
 if(key&&key[0]===m[0]&&key[1]===m[1]&&key[2]===m[2]&&key[3]===m[4]&&key[4]===m[5]&&key[5]===m[6]&&key[6]===m[8]&&key[7]===m[9]&&key[8]===m[10])return root.stretch as number;
 const next=key??(root.stretchKey=new Float64Array(9));
 next[0]=m[0];next[1]=m[1];next[2]=m[2];next[3]=m[4];next[4]=m[5];next[5]=m[6];next[6]=m[8];next[7]=m[9];next[8]=m[10];
 return root.stretch=maxStretch(m);
}
function selectFlat(root:ClusterRoot<CutPage>,cameraStretch:number){
 const {clip,viewMatrix}=selectionScratch;
 const pages=root.pages;
 cut.pages=pages;
 cut.table=root.table??(root.table=clusterCutTable(pages));
 cut.world=root.world;cut.elements=viewMatrix.elements;
 cut.stretch=worldStretch(root)*cameraStretch;
 cut.focal=Math.max(selectionScratch.pixelScale[0],selectionScratch.pixelScale[1]);
 if(!Number.isFinite(cut.stretch)||cut.stretch<0||!Number.isFinite(cut.focal)||cut.focal<=0||!Number.isFinite(cut.near)||cut.near<=0)throw new Error('Parametres de cluster invalides');
 extractPlanes(clip.multiplyMatrices(cut.camera.projectionMatrix,viewMatrix),selectionScratch.planes);
 cut.structure=root.structure;cut.forced=root.forced;cut.forcedList=root.forcedList;
 // Bornes atteignables : la passe demandée retient au plus un rang par cluster, le repli en pousse
 // au plus un de plus par cluster produit. Dimensionnées ici, les files ne grandissent plus ensuite.
 const needed=cut.table.count*2+1;
 if(cut.queue.length<needed)cut.queue=grow(cut.queue,needed);
 if(cut.structure&&cut.force.length<cut.structure.groupCount+1)cut.force=grow(cut.force,cut.structure.groupCount+1);
 if(cut.forced&&cut.forcedList){for(let i=0;i<cut.forcedList.length;i++)cut.forced[cut.forcedList[i]]=0;cut.forcedList.length=0;}
 const startShown=cut.shown.length;
 cut.useForcing=false;cut.missing=false;cut.queued=0;
 traverse(root.culling);
 if(!cut.hold)return;
 if(!cut.structure||!cut.forced||!cut.forcedList){
  // No group structure published: the only repair is the threshold escalation, and it is only run
  // when the caller asked for a hole-free cut.
  if(cut.rootFallback&&cut.missing)repairFlat(startShown);
  return;
 }
 // Residency fallback: a chosen cluster that is not loaded makes its whole group step back to the
 // coarse representation that group produced, recursively, until something resident covers the
 // region. The roots are pinned, so the walk always terminates on a complete cover.
 let top=cut.queued;
 cut.useForcing=true;
 let forcedAny=false;
 while(top>0){
  const index=cut.queue[--top];
  const rec=pages[index];
  if(resident(rec))continue;
  if(!drawnUnderForcing(index))continue;
  const own=cut.table.group[index];
  if(own<0)continue;
  if(cut.forced[own])continue;
  forceCoarse(own);forcedAny=true;
  const structure=cut.structure;
  for(let i=structure.outputOffsets[own];i<structure.outputOffsets[own+1];i++){
   if(top>=cut.queue.length)cut.queue=grow(cut.queue,top+1);
   cut.queue[top++]=structure.outputs[i];
  }
 }
 if(!forcedAny){
  // Nothing could step back: what is missing has no resident replacement below the roots, so the
  // primitive publishes its pinned root cover rather than a cut with a hole.
  if(cut.rootFallback&&cut.missing&&!rootCoverInto(startShown))cut.complete=false;
  cut.useForcing=false;return;
 }
 cut.shown.length=startShown;cut.short=false;
 traverse(root.culling);
 cut.useForcing=false;
 // A group walk that still leaves a region uncovered ends on the same pinned root cover.
 if(cut.rootFallback&&cut.short&&!rootCoverInto(startShown))cut.complete=false;
}
function sweep(roots:ReadonlyArray<ClusterRoot<CutPage>>,cameraStretch:number){
 const {frustum,viewMatrix}=selectionScratch;
 cut.shown.length=0;cut.wanted.length=0;cut.frustumRejected=0;cut.lodLevel=0;cut.complete=true;
 for(let i=0;i<roots.length;i++){
  const root=roots[i];
  // A whole instance out of frustum costs one box test, not one matrix setup.
  if(root.worldBox&&!frustum.intersectsBox(root.worldBox)){cut.frustumRejected++;continue;}
  viewMatrix.multiplyMatrices(cut.camera.matrixWorldInverse,root.world);
  selectFlat(root,cameraStretch);
 }
}
/** CPU cut: frustum, per-cluster screen-error band and normal cone.
 *  `holdResident` keeps a complete cover until every replacement cluster is loaded. */
export function selectVisiblePages<T extends CutPage>(
 roots:ReadonlyArray<ClusterRoot<T>>,
 camera:THREE.PerspectiveCamera,
 options:{pixelError?:number;viewport?:[number,number];frame:number;holdResident?:boolean;isResident?:(page:T)=>boolean;rootFallback?:boolean;pageBudget?:number;wanted?:T[];result?:SelectionResult<T>},
 into?:T[]
):SelectionResult<T>{
 const viewport=options.viewport;
 const {frustum,matrix}=selectionScratch;
 camera.updateMatrixWorld();
 frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const width=viewport?.[0]??1,height=viewport?.[1]??1;
 selectionScratch.pixelScale[0]=width*Math.abs(camera.projectionMatrix.elements[0])/2;selectionScratch.pixelScale[1]=height*Math.abs(camera.projectionMatrix.elements[5])/2;
 const shown=into??[] as T[];
 // La coupe demandée est rendue à l'appelant : il fournit son propre tableau pour qu'une image n'en alloue aucun.
 const wanted=options.wanted??[] as T[];
 cut.shown=shown as CutPage[];cut.wanted=wanted as CutPage[];
 cut.camera=camera;cut.near=camera.near;cut.frame=options.frame;
 cut.hold=!!options.holdResident;
 // Threshold escalation towards the resident ancestor. Asked for by the WebGPU backend, which needs
 // the published cut to describe what it can draw; it is also the only repair available on a cache
 // that publishes no group structure.
 cut.rootFallback=cut.hold&&!!options.rootFallback;
 cut.isResident=options.isResident as ((page:CutPage)=>boolean)|undefined;
 cut.pixelError=options.pixelError??0;
 // A cut wider than the page budget is answered with a coarser cut, never with dropped clusters:
 // dropping would punch holes, a coarser threshold only lowers detail everywhere at once.
 const budget=options.pageBudget&&options.pageBudget>0?options.pageBudget:0;
 const flat=roots as ReadonlyArray<ClusterRoot<CutPage>>;
 const cameraStretch=maxStretch(camera.matrixWorldInverse.elements);
 sweep(flat,cameraStretch);
 for(let attempt=0;budget&&shown.length>budget&&attempt<16;attempt++){
  cut.pixelError=cut.pixelError>0?cut.pixelError*2:1;
  sweep(flat,cameraStretch);
 }
 let selectedTriangles=0,displayedTriangles=0;
 for(let i=0;i<wanted.length;i++)selectedTriangles+=wanted[i].triangles;
 for(let i=0;i<shown.length;i++)displayedTriangles+=shown[i].triangles;
 if(!wanted.length)selectedTriangles=displayedTriangles;
 const result=options.result??{shown,wanted,visible:0,selectedTriangles:0,displayedTriangles:0,frustumRejected:0,lodLevel:0,complete:true,pixelError:0};
 result.shown=shown;result.wanted=wanted;result.visible=wanted.length||shown.length;
 result.selectedTriangles=selectedTriangles;result.displayedTriangles=displayedTriangles;
 result.frustumRejected=cut.frustumRejected;result.lodLevel=cut.lodLevel;result.complete=cut.complete;result.pixelError=cut.pixelError;
 cut.pages=NO_PAGES;cut.table=EMPTY_TABLE;cut.structure=undefined;cut.forced=undefined;cut.forcedList=undefined;cut.isResident=undefined;
 return result;
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
