import {adaptivePixelError,lodScore, type ClusterManifest, type Tree} from '../sdk-core/index.ts';
import * as THREE from 'three';
import {OPEN_CONE,coneCullsPage,type NormalCone} from './pageCone.ts';
import {isTransmissive} from './visibilityBuffer.ts';

export type PageRec = {
 id:number;url:string;clusterId:string;array?:Uint32Array;triangles:number;indexBytes:number;
 min:number[];max:number[];role?:'exact'|'coarse';errorObject?:number;
 attributes:THREE.BufferGeometry['attributes'];
 material:THREE.Material|THREE.Material[];
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

/** Build exact-cluster page records and validate coverage. Shared by WebGL and WebGPU backends. */
export function collectClusterPages(source:THREE.Object3D,metadata:ClusterManifest,indices:Map<string,Uint32Array>,associations:Map<THREE.Object3D,{meshes?:number;primitives?:number}>,options:{allowMissing?:boolean}={}){
 const roots:Array<{tree:Tree;world:THREE.Matrix4;pages:PageRec[]}>=[],allPages:PageRec[]=[],blendCopies:THREE.Mesh[]=[];
 let order=0;
 for(const mesh of objects(source)){
  const association=associations.get(mesh),primitive=metadata.primitives.find(p=>p.mesh===association?.meshes&&p.primitive===(association?.primitives??0));
  if(!primitive)throw new Error(`Missing primitive association: ${mesh.name}`);
  if(primitive.pass==='shared-blend'||isTransmissive(mesh.material)){const copy=new THREE.Mesh(mesh.geometry,mesh.material);copy.matrixAutoUpdate=false;copy.matrix.copy(mesh.matrixWorld);copy.renderOrder=order++;blendCopies.push(copy);continue;}
  const sourceIndices=mesh.geometry.getIndex();if(!sourceIndices)throw new Error('Indexed source required');
  const src=sourceIndices.array as ArrayLike<number>;
  const ordered=(metadata.clusterStrategy??'exact-source-order')==='exact-source-order';
  const exactPages=primitive.pages.filter(page=>(page.role??'exact')!=='coarse');
  let sourceOffset=0;
  const pages=primitive.pages.map(page=>{const array=indices.get(page.url);if(!array&&!options.allowMissing&&indices.size)throw new Error('Missing page');
   if(array&&(page.role??'exact')!=='coarse'){if(ordered){for(let i=0;i<array.length;i++)if(array[i]!==src[sourceOffset++])throw new Error('Page/source index mismatch');}else sourceOffset+=array.length;}
   else if(!array&&(page.role??'exact')!=='coarse')sourceOffset+=page.count;
   const rec:PageRec={id:page.id,url:page.url,clusterId:`${primitive.mesh}/${primitive.primitive}/${page.id}`,array,triangles:page.count/3,indexBytes:array?.byteLength??page.bytes,min:page.min,max:page.max,role:page.role,attributes:mesh.geometry.attributes,material:mesh.material,matrix:mesh.matrixWorld,renderOrder:order,attached:false,seen:0};
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
  if(primitive.hierarchy){
   const world=mesh.matrixWorld.clone();
   roots.push({tree:primitive.hierarchy,world,pages});
   const referenced=new Set<number>();
   collectReferencedPages(primitive.hierarchy,referenced);
   for(let i=0;i<pages.length;i++){
    const rec=pages[i];
    if((rec.role??'exact')==='coarse')continue;
    if(referenced.has(i)||referenced.has(rec.id))continue;
    roots.push({tree:{min:rec.min,max:rec.max,page:0},world,pages:[rec]});
   }
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
const selectionScratch={frustum:new THREE.Frustum(),matrix:new THREE.Matrix4(),viewMatrix:new THREE.Matrix4(),box:new THREE.Box3(),corner:new THREE.Vector3(),viewMin:[Infinity,Infinity,Infinity] as [number,number,number],viewMax:[-Infinity,-Infinity,-Infinity] as [number,number,number],pixelScale:[1,1] as [number,number]};
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

function pageResident<T extends {array?:Uint32Array}>(rec:T,hold:boolean){return !hold||!!rec.array;}

/** CPU frustum + lodScore + cone cut. holdResident keeps a complete cover until every replacement page is loaded. */
export function selectVisiblePages<T extends {triangles:number;seen:number;min?:number[];max?:number[];cone?:NormalCone;material?:THREE.Material|THREE.Material[];array?:Uint32Array}>(
 roots:Array<{tree:Tree;world:THREE.Matrix4;pages:T[]}>,
 camera:THREE.PerspectiveCamera,
 options:{pixelError?:number;viewport?:[number,number];frame:number;holdResident?:boolean},
 into?:T[]
){
 const pixelError=options.pixelError??0,viewport=options.viewport,frame=options.frame,hold=!!options.holdResident;
 const {frustum,matrix,viewMatrix,box}=selectionScratch;
 camera.updateMatrixWorld();
 frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const width=viewport?.[0]??1,height=viewport?.[1]??1;
 selectionScratch.pixelScale[0]=width*Math.abs(camera.projectionMatrix.elements[0])/2;selectionScratch.pixelScale[1]=height*Math.abs(camera.projectionMatrix.elements[5])/2;
 const shown=into??[] as T[];shown.length=0;
 const wanted:T[]=[];
 let frustumRejected=0,lodLevel=0;
 const emit=(rec:T,world:THREE.Matrix4,fallbackMin:number[],fallbackMax:number[])=>{
  if(coneSkipsPage(rec,world,camera,fallbackMin,fallbackMax))return;
  rec.seen=frame;shown.push(rec);
 };
 const visit=(node:Tree,world:THREE.Matrix4,pages:T[],depth:number,collectWanted:boolean):boolean=>{
  box.min.fromArray(node.min);box.max.fromArray(node.max);box.applyMatrix4(world);if(!frustum.intersectsBox(box)){frustumRejected++;return true;}
  const wantCoarse=lodWantsCoarse(node,pixelError,viewMatrix,selectionScratch.pixelScale,camera.near);
  const coarseRecs=wantCoarse&&node.coarsePages?node.coarsePages.map(id=>pages[id]).filter((rec):rec is T=>!!rec):[];
  if(wantCoarse){
   if(collectWanted)for(let i=0;i<coarseRecs.length;i++)wanted.push(coarseRecs[i]);
   if(coarseRecs.length===node.coarsePages!.length&&coarseRecs.every(rec=>pageResident(rec,hold))){
    lodLevel=Math.max(lodLevel,depth);
    for(let i=0;i<coarseRecs.length;i++)emit(coarseRecs[i],world,node.min,node.max);
    return true;
   }
  }
  if(node.page!==undefined){
   const rec=pages[node.page];
   if(!rec||coneSkipsPage(rec,world,camera,node.min,node.max))return true;
   if(collectWanted&&!wantCoarse)wanted.push(rec);
   if(pageResident(rec,hold)){rec.seen=frame;shown.push(rec);return true;}
   return false;
  }
  const children=node.children;
  if(!children?.length)return true;
  const start=shown.length;
  let complete=true;
  for(let i=0;i<children.length;i++)complete=visit(children[i],world,pages,depth+1,collectWanted&&!wantCoarse)&&complete;
  if(hold&&!wantCoarse&&!complete&&node.coarsePages?.length){
   const fallback=node.coarsePages.map(id=>pages[id]).filter((rec):rec is T=>!!rec?.array);
   if(fallback.length===node.coarsePages.length){
    shown.length=start;
    lodLevel=Math.max(lodLevel,depth);
    for(let i=0;i<fallback.length;i++)emit(fallback[i],world,node.min,node.max);
    return true;
   }
  }
  return complete;
 };
 for(const root of roots){
  viewMatrix.multiplyMatrices(camera.matrixWorldInverse,root.world);
  visit(root.tree,root.world,root.pages,1,true);
 }
 let selectedTriangles=0,displayedTriangles=0;
 for(let i=0;i<wanted.length;i++)selectedTriangles+=wanted[i].triangles;
 for(let i=0;i<shown.length;i++)displayedTriangles+=shown[i].triangles;
 if(!wanted.length)selectedTriangles=displayedTriangles;
 return {shown,wanted,visible:wanted.length||shown.length,selectedTriangles,displayedTriangles,frustumRejected,lodLevel};
}
