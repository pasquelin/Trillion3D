import {adaptivePixelError,clusterErrorPixels,lodScore,maxStretch,pageCarriesClusterError,primitiveUsesClusterErrors, type ClusterManifest, type CullingHierarchy, type Page, type Tree} from '../sdk-core/index.ts';
import * as THREE from 'three';
import {OPEN_CONE,coneCullsPage,type NormalCone} from './pageCone.ts';
import {isTransmissive} from './visibilityBuffer.ts';

export type PageRec = {
 id:number;url:string;clusterId:string;array?:Uint32Array;triangles:number;indexBytes:number;
 min:number[];max:number[];role?:'exact'|'coarse';errorObject?:number;
 /** Flat DAG cut, copied from the page. Absent on caches without a per-cluster error. */
 level?:number;lodError?:number;sphere?:number[];parentError?:number|null;parentSphere?:number[]|null;
 attributes:THREE.BufferGeometry['attributes'];
 material:THREE.Material|THREE.Material[];
 transparent?:boolean;sourceMesh?:THREE.Mesh;sourceOrder?:number;
 matrix:THREE.Matrix4;renderOrder:number;
 geometry?:THREE.BufferGeometry;mesh?:THREE.Mesh;attached:boolean;seen:number;resident?:boolean;
 cone?:NormalCone;
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
const NO_CLUSTER_ERROR={level:undefined,lodError:undefined,sphere:undefined,parentError:undefined,parentSphere:undefined} as const;
function clusterErrorFields(page:Page):{level?:number;lodError?:number;sphere?:number[];parentError?:number|null;parentSphere?:number[]|null}{
 if(!pageCarriesClusterError(page))return NO_CLUSTER_ERROR;
 const parent=typeof page.parentError==='number'&&Number.isFinite(page.parentError)?page.parentError:null;
 if(parent!==null&&!(Array.isArray(page.parentSphere)&&page.parentSphere.length===4))throw new Error(`Page ${page.id}: parentError sans parentSphere`);
 if(parent!==null&&parent<page.lodError!)throw new Error(`Page ${page.id}: parentError sous lodError`);
 return {level:page.level,lodError:page.lodError,sphere:page.sphere,parentError:parent,parentSphere:parent===null?null:page.parentSphere};
}

function objects(source:THREE.Object3D){
 const meshes:THREE.Mesh[]=[];
 source.updateMatrixWorld(true);
 source.traverse(o=>{if((o as THREE.Mesh).isMesh)meshes.push(o as THREE.Mesh);});
 return meshes;
}

function collectReferencedPages(node:Tree,into:Set<number>){
 if(node.page!==undefined)into.add(node.page);
 if(node.children)for(let i=0;i<node.children.length;i++)collectReferencedPages(node.children[i],into);
}

/** Keep transparent coarse replacements at their first source leaf, including multi-page replacements. */
export function sourcePageOrders(tree:Tree|null,pageCount:number):number[]{
 const order=Array.from({length:pageCount},(_,index)=>index);
 const visit=(node:Tree):number=>{
  let first=node.page===undefined?Infinity:(order[node.page]??Infinity);
  if(node.children)for(const child of node.children)first=Math.min(first,visit(child));
  if(Number.isFinite(first)&&node.coarsePages)for(let i=0;i<node.coarsePages.length;i++){
   const id=node.coarsePages[i];if(id<order.length)order[id]=first+i/(node.coarsePages.length+1);
  }
  return first;
 };
 if(tree)visit(tree);
 return order;
}

/** Build exact-cluster page records and validate coverage. Shared by WebGL and WebGPU backends. */
export function collectClusterPages(source:THREE.Object3D,metadata:ClusterManifest,indices:Map<string,Uint32Array>,associations:Map<THREE.Object3D,{meshes?:number;primitives?:number}>,options:{allowMissing?:boolean}={}){
 const roots:Array<{tree:Tree;world:THREE.Matrix4;pages:PageRec[];flat?:boolean;culling?:{nodes:Float64Array;stride:number};worldBox?:THREE.Box3;stretch?:number;stretchKey?:Float64Array}>=[],allPages:PageRec[]=[],blendCopies:THREE.Mesh[]=[];
 let order=0;
 for(const mesh of objects(source)){
  const association=associations.get(mesh),primitive=metadata.primitives.find(p=>p.mesh===association?.meshes&&p.primitive===(association?.primitives??0));
  if(!primitive)throw new Error(`Missing primitive association: ${mesh.name}`);
  if(primitive.pass==='shared-blend'||isTransmissive(mesh.material)){const copy=new THREE.Mesh(mesh.geometry,mesh.material);copy.matrixAutoUpdate=false;copy.matrix.copy(mesh.matrixWorld);copy.frustumCulled=mesh.frustumCulled;copy.renderOrder=order++;copy.userData.sourceMesh=mesh;blendCopies.push(copy);continue;}
  const sourceIndices=mesh.geometry.getIndex();if(!sourceIndices)throw new Error('Indexed source required');
  const src=sourceIndices.array as ArrayLike<number>;
  const ordered=(primitive.clusterStrategy??(primitive.pass==='clustered-blend'?'exact-source-order':metadata.clusterStrategy)??'exact-source-order')==='exact-source-order';
  const transparent=primitive.pass==='clustered-blend'||(Array.isArray(mesh.material)?mesh.material.some(material=>material.transparent):mesh.material.transparent);
  // A flat cut has no tree; transparent pages recover their draw order from the recorded source rank.
  const sourceOrder=!transparent?undefined
   :primitiveUsesClusterErrors(primitive)?primitive.pages.map((page,index)=>page.start??index)
   :sourcePageOrders(primitive.hierarchy,primitive.pages.length);
  const exactPages=primitive.pages.filter(page=>(page.role??'exact')!=='coarse');
  let sourceOffset=0;
  const pages=primitive.pages.map((page,pageIndex)=>{const array=indices.get(page.url);if(!array&&!options.allowMissing&&indices.size)throw new Error('Missing page');
   if(array&&(page.role??'exact')!=='coarse'){if(ordered){for(let i=0;i<array.length;i++)if(array[i]!==src[sourceOffset++])throw new Error('Page/source index mismatch');}else sourceOffset+=array.length;}
   else if(!array&&(page.role??'exact')!=='coarse')sourceOffset+=page.count;
   const cut=clusterErrorFields(page);
   const rec:PageRec={id:page.id,url:page.url,clusterId:`${primitive.mesh}/${primitive.primitive}/${page.id}`,array,triangles:page.count/3,indexBytes:array?.byteLength??page.bytes,min:page.min,max:page.max,role:page.role,
    level:cut.level,lodError:cut.lodError,sphere:cut.sphere,parentError:cut.parentError,parentSphere:cut.parentSphere,
    attributes:mesh.geometry.attributes,material:mesh.material,transparent,sourceMesh:mesh,sourceOrder:sourceOrder?.[pageIndex]??pageIndex,matrix:mesh.matrixWorld,renderOrder:order,attached:false,seen:0,cone:undefined,geometry:undefined,mesh:undefined,resident:false};
   allPages.push(rec);return rec;});
  order++;
  const complete=primitive.pages.every(page=>indices.has(page.url)||(page.role??'exact')==='coarse');
  if(complete&&sourceOffset!==sourceIndices.count)throw new Error('Incomplete cluster coverage');
  if(complete&&!ordered){
   const count=(arr:ArrayLike<number>)=>{const map=new Map<string,number>();for(let i=0;i<arr.length;i+=3){const key=`${arr[i]},${arr[i+1]},${arr[i+2]}`;map.set(key,(map.get(key)??0)+1);}return map;};
   const fromPages=count(exactPages.flatMap(page=>[...indices.get(page.url)!]));
   const fromSource=count(src);
   if(fromPages.size!==fromSource.size)throw new Error('Incomplete cluster coverage');
   for(const [key,n] of fromSource)if(fromPages.get(key)!==n)throw new Error('Page/source index mismatch');
  }
  if(primitiveUsesClusterErrors(primitive)){
   const culling=cullingNodes(primitive.culling,pages.length);
   const local=new THREE.Box3();
   if(culling)local.set(new THREE.Vector3(culling.nodes[0],culling.nodes[1],culling.nodes[2]),new THREE.Vector3(culling.nodes[3],culling.nodes[4],culling.nodes[5]));
   else for(const page of primitive.pages)local.union(new THREE.Box3(new THREE.Vector3(...page.min as [number,number,number]),new THREE.Vector3(...page.max as [number,number,number])));
   roots.push({tree:{min:local.min.toArray(),max:local.max.toArray(),page:0},world:mesh.matrixWorld,pages,flat:true,culling,worldBox:local.clone().applyMatrix4(mesh.matrixWorld)});
  }else if(primitive.hierarchy){
   const world=mesh.matrixWorld;
   roots.push({tree:primitive.hierarchy,world,pages});
   const referenced=new Set<number>();
   collectReferencedPages(primitive.hierarchy,referenced);
   for(let i=0;i<pages.length;i++){
    const rec=pages[i];
    if((rec.role??'exact')==='coarse')continue;
    if(referenced.has(i)||referenced.has(rec.id))continue;
    roots.push({tree:{min:rec.min,max:rec.max,page:0},world,pages:[rec]});
   }
  }else{
   const world=mesh.matrixWorld;
   for(const rec of pages)if((rec.role??'exact')==='exact')roots.push({tree:{min:rec.min,max:rec.max,page:0},world,pages:[rec]});
  }
 }
 return {roots,allPages,blendCopies,prepared:metadata.primitives.reduce((n,p)=>n+p.pages.length,0)};
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
export function trimToBudget<T extends {triangles:number}>(shown:T[],cap:number){
 let selectedTriangles=0;
 for(let i=0;i<shown.length;i++)selectedTriangles+=shown[i].triangles;
 if(shown.length<=cap)return {shown,overBudget:false,visible:shown.length,selectedTriangles};
 const kept=shown.slice().sort((a,b)=>a.triangles-b.triangles).slice(0,cap);
 selectedTriangles=0;for(let i=0;i<kept.length;i++)selectedTriangles+=kept[i].triangles;
 return {shown:kept,overBudget:true,visible:kept.length,selectedTriangles};
}
export function indexPagesByUrl<T extends {url:string}>(pages:readonly T[]){
 const byUrl=new Map<string,T[]>();
 for(let i=0;i<pages.length;i++){
  const rec=pages[i];let list=byUrl.get(rec.url);if(!list)byUrl.set(rec.url,list=[]);list.push(rec);
 }
 return byUrl;
}
export function collectPendingUrls<T extends {array?:Uint32Array;url:string}>(shown:readonly T[],into:string[]){
 into.length=0;
 for(let i=0;i<shown.length;i++)if(!shown[i].array)into.push(shown[i].url);
 return into;
}
const selectionScratch={frustum:new THREE.Frustum(),matrix:new THREE.Matrix4(),viewMatrix:new THREE.Matrix4(),box:new THREE.Box3(),corner:new THREE.Vector3(),viewMin:[Infinity,Infinity,Infinity] as [number,number,number],viewMax:[-Infinity,-Infinity,-Infinity] as [number,number,number],pixelScale:[1,1] as [number,number],clip:new THREE.Matrix4(),planes:new Float64Array(24),stack:new Int32Array(4096)};
export type ClusterCut={lodError?:number;sphere?:number[];parentError?:number|null;parentSphere?:number[]|null};
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
/**
 * One cut of the cluster DAG: a cluster is drawn when its own error already fits the budget and the
 * coarser cluster that would replace it does not. Errors are monotone along a chain and a root has
 * no replacement, so every surface point is covered by exactly one drawn cluster.
 */
export function clusterCutSelects(rec:ClusterCut,viewMatrix:THREE.Matrix4,pixelScale:readonly number[],near:number,pixelError:number){
 if(!rec.sphere)return true;
 const e=viewMatrix.elements;
 return cutSelects(rec,e,maxStretch(e),Math.max(pixelScale[0],pixelScale[1]),near,pixelError);
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
function lodWantsCoarse(node:Tree,pixelError:number,viewMatrix:THREE.Matrix4,pixelScale:[number,number],near:number){
 if(!node.coarsePages?.length||node.errorObject==null||!(pixelError>0))return false;
 const min=node.min,max=node.max,e=viewMatrix.elements;
 const cx=(min[0]+max[0])*0.5,cy=(min[1]+max[1])*0.5,cz=(min[2]+max[2])*0.5;
 const ex=(max[0]-min[0])*0.5,ey=(max[1]-min[1])*0.5,ez=(max[2]-min[2])*0.5;
 const wcx=e[0]*cx+e[4]*cy+e[8]*cz+e[12],wcy=e[1]*cx+e[5]*cy+e[9]*cz+e[13],wcz=e[2]*cx+e[6]*cy+e[10]*cz+e[14];
 const wex=Math.abs(e[0])*ex+Math.abs(e[4])*ey+Math.abs(e[8])*ez,wey=Math.abs(e[1])*ex+Math.abs(e[5])*ey+Math.abs(e[9])*ez,wez=Math.abs(e[2])*ex+Math.abs(e[6])*ey+Math.abs(e[10])*ez;
 const {viewMin,viewMax,pixelScale:scale}=selectionScratch;
 viewMin[0]=wcx-wex;viewMin[1]=wcy-wey;viewMin[2]=-wcz-wez;
 viewMax[0]=wcx+wex;viewMax[1]=wcy+wey;viewMax[2]=-wcz+wez;
 const errorScale=Math.hypot(e[0],e[1],e[2],e[4],e[5],e[6],e[8],e[9],e[10]);
 try{return lodScore(node.errorObject,errorScale,viewMin,viewMax,pixelScale??scale,'perspective',near)<=pixelError;}catch{return false;}
}

/** CPU frustum + lodScore + cone cut. holdResident keeps a complete cover until every replacement page is loaded. */
export function selectVisiblePages<T extends ClusterCut&{triangles:number;seen:number;level?:number;min?:number[];max?:number[];cone?:NormalCone;material?:THREE.Material|THREE.Material[];array?:Uint32Array}>(
 roots:Array<{tree:Tree;world:THREE.Matrix4;pages:T[];flat?:boolean;culling?:{nodes:Float64Array;stride:number};worldBox?:THREE.Box3;stretch?:number;stretchKey?:Float64Array}>,
 camera:THREE.PerspectiveCamera,
 options:{pixelError?:number;viewport?:[number,number];frame:number;holdResident?:boolean;isResident?:(page:T)=>boolean},
 into?:T[]
){
 const pixelError=options.pixelError??0,viewport=options.viewport,frame=options.frame,hold=!!options.holdResident;
 const pageResident=(rec:T)=>!hold||(options.isResident?options.isResident(rec):!!rec.array);
 const {frustum,matrix,viewMatrix,box}=selectionScratch;
 camera.updateMatrixWorld();
 frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const width=viewport?.[0]??1,height=viewport?.[1]??1;
 selectionScratch.pixelScale[0]=width*Math.abs(camera.projectionMatrix.elements[0])/2;selectionScratch.pixelScale[1]=height*Math.abs(camera.projectionMatrix.elements[5])/2;
 const shown=into??[] as T[];shown.length=0;
 const wanted:T[]=[];
 let frustumRejected=0,lodLevel=0,complete=true;
 const emit=(rec:T,world:THREE.Matrix4,fallbackMin:number[],fallbackMax:number[])=>{
  if(coneSkipsPage(rec,world,camera,fallbackMin,fallbackMax))return;
  rec.seen=frame;shown.push(rec);
 };
 const fallback=(node:Tree,world:THREE.Matrix4,pages:T[],depth:number,start:number)=>{
  if(!hold||!node.coarsePages?.length)return false;
  const recs=node.coarsePages.map(id=>pages[id]).filter((rec):rec is T=>!!rec&&pageResident(rec));
  if(recs.length!==node.coarsePages.length)return false;
  shown.length=start;lodLevel=Math.max(lodLevel,depth);
  for(const rec of recs)emit(rec,world,node.min,node.max);
  return true;
 };
 const visit=(node:Tree,world:THREE.Matrix4,pages:T[],depth:number,collectWanted:boolean):boolean=>{
  box.min.fromArray(node.min);box.max.fromArray(node.max);box.applyMatrix4(world);if(!frustum.intersectsBox(box)){frustumRejected++;return true;}
  const wantCoarse=lodWantsCoarse(node,pixelError,viewMatrix,selectionScratch.pixelScale,camera.near);
  const coarseRecs=wantCoarse&&node.coarsePages?node.coarsePages.map(id=>pages[id]).filter((rec):rec is T=>!!rec):[];
  if(wantCoarse){
   if(collectWanted)for(let i=0;i<coarseRecs.length;i++)wanted.push(coarseRecs[i]);
   if(coarseRecs.length===node.coarsePages!.length&&coarseRecs.every(pageResident)){
    lodLevel=Math.max(lodLevel,depth);
    for(let i=0;i<coarseRecs.length;i++)emit(coarseRecs[i],world,node.min,node.max);
    return true;
   }
  }
  if(node.page!==undefined){
   const rec=pages[node.page];
   if(!rec||coneSkipsPage(rec,world,camera,node.min,node.max))return true;
   if(collectWanted&&!wantCoarse)wanted.push(rec);
   if(pageResident(rec)){rec.seen=frame;shown.push(rec);return true;}
   return fallback(node,world,pages,depth,shown.length);
  }
  const children=node.children;
  if(!children?.length)return true;
  const start=shown.length;
  let complete=true;
  for(let i=0;i<children.length;i++)complete=visit(children[i],world,pages,depth+1,collectWanted&&!wantCoarse)&&complete;
  if(!complete&&fallback(node,world,pages,depth,start))return true;
  return complete;
 };
 /**
  * Flat cut: every cluster carries its own screen-error band, so no tree is walked for the LOD.
  * The culling hierarchy is only a traversal accelerator: a subtree is skipped when its box is out
  * of frustum, or when the largest replacement error it holds already fits the budget, in which case
  * no cluster below it can pass `parentError > pixelError`. Without a hierarchy the pages are scanned.
  * Frustum planes are taken in the primitive's own space, so no page box is ever transformed.
  */
 /**
  * Flat cut: every cluster carries its own screen-error band, so no tree is walked for the LOD.
  * The culling hierarchy is only a traversal accelerator: a subtree is skipped when its box is out
  * of frustum, or when the largest replacement error it holds already fits the budget, in which case
  * no cluster below it can pass `parentError > pixelError`. Without a hierarchy the pages are scanned.
  * Frustum planes are taken in the primitive's own space, so no page box is ever transformed.
  */
 const {clip,planes,stack}=selectionScratch;
 let flatWorld=roots[0]?.world??new THREE.Matrix4(),flatStretch=1,flatFocal=1;
 let flatElements:ArrayLike<number>=flatWorld.elements;
 let flatInside=false;
 const take=(rec:T)=>{
  if(!rec.min||!rec.max)return;
  if(!flatInside&&boxClip(planes,rec.min[0],rec.min[1],rec.min[2],rec.max[0],rec.max[1],rec.max[2])===0){frustumRejected++;return;}
  if(!cutSelects(rec,flatElements,flatStretch,flatFocal,camera.near,pixelError))return;
  if(rec.cone&&coneSkipsPage(rec,flatWorld,camera,rec.min,rec.max))return;
  wanted.push(rec);
  if(rec.level!==undefined&&rec.level>lodLevel)lodLevel=rec.level;
  if(pageResident(rec)){rec.seen=frame;shown.push(rec);}else complete=false;
 };
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
 const selectFlat=(root:{world:THREE.Matrix4;pages:T[];culling?:{nodes:Float64Array;stride:number};stretch?:number;stretchKey?:Float64Array})=>{
  const world=root.world,pages=root.pages,culling=root.culling;
  const e=viewMatrix.elements;
  flatWorld=world;flatElements=e;
  flatStretch=worldStretch(root)*cameraStretch;
  flatFocal=Math.max(selectionScratch.pixelScale[0],selectionScratch.pixelScale[1]);
  const near=camera.near;
  extractPlanes(clip.multiplyMatrices(camera.projectionMatrix,viewMatrix),planes);
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
    const clip=boxClip(planes,nodes[base],nodes[base+1],nodes[base+2],nodes[base+3],nodes[base+4],nodes[base+5]);
    if(clip===0){frustumRejected++;continue;}
    inside=clip===2;
   }
   const bound=nodes[base+10];
   if(bound>=0&&projectedClusterError(bound,nodes,base+6,e,flatStretch,flatFocal,near)<=pixelError)continue;
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
 for(const root of roots){
  // A whole instance out of frustum costs one box test, not one matrix setup.
  if(root.flat&&root.worldBox&&!frustum.intersectsBox(root.worldBox)){frustumRejected++;continue;}
  viewMatrix.multiplyMatrices(camera.matrixWorldInverse,root.world);
  if(root.flat){selectFlat(root);continue;}
  complete=visit(root.tree,root.world,root.pages,1,true)&&complete;
 }
 let selectedTriangles=0,displayedTriangles=0;
 for(let i=0;i<wanted.length;i++)selectedTriangles+=wanted[i].triangles;
 for(let i=0;i<shown.length;i++)displayedTriangles+=shown[i].triangles;
 if(!wanted.length)selectedTriangles=displayedTriangles;
 return {shown,wanted,visible:wanted.length||shown.length,selectedTriangles,displayedTriangles,frustumRejected,lodLevel,complete};
}

/** Camera-independent minimal complete cover. Shared page URLs may serve multiple instances.
 *  For a flat DAG root the cover is the set of clusters that have no replacement. */
export function rootCoverage<T extends {url:string;parentError?:number|null}>(roots:Array<{tree:Tree;pages:T[];flat?:boolean}>):T[]{
 const unique=new Map<string,T>();
 const visit=(node:Tree,pages:T[])=>{
  const ids=node.coarsePages?.length?node.coarsePages:node.page!==undefined?[node.page]:undefined;
  if(ids){for(const id of ids){const page=pages[id];if(!page)throw new Error('INVALID_ROOT_COVERAGE');unique.set(page.url,page);}return;}
  if(!node.children?.length)throw new Error('INVALID_ROOT_COVERAGE');
  for(const child of node.children)visit(child,pages);
 };
 for(const root of roots){
  if(root.flat){
   let found=0;
   for(const page of root.pages)if(page.parentError==null){unique.set(page.url,page);found++;}
   if(!found)throw new Error('INVALID_ROOT_COVERAGE');
   continue;
  }
  visit(root.tree,root.pages);
 }
 return [...unique.values()];
}
