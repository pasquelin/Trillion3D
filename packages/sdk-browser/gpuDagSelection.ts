/**
 * GPU cut of a cluster DAG (`errorModel: dag-group-qem-v1`).
 *
 * Every cluster carries its own screen-error band, so nothing walks a tree. One thread per cluster
 * evaluates `parentErrorPx > pixelError >= lodErrorPx` with the same projection as
 * `clusterErrorPixels`; one thread per culling node turns the primitive's flat hierarchy into an
 * early reject (out of frustum, or a subtree whose largest replacement error already fits the
 * budget). Rejection there is a pure accelerator: a node's box contains every cluster box below it
 * and its `maxParentError` bounds every `parentError` below it, so the selected set is identical
 * with or without the hierarchy.
 */
import * as THREE from 'three';
import {maxStretch} from '../sdk-core/index.ts';
import {OPEN_CONE,coneCullsPage,type NormalCone} from './pageCone.ts';
import {
 PAGE_CONE_FLOATS,SELECTION_NONE as NONE,SELECTION_UNIFORM_BYTES as UNIFORM_BYTES,SELECTION_WORKGROUP as WORKGROUP,
 copySelectionUniforms,leafCone,sameSelectionUniforms,
 type GpuCut,type GpuSelection,type SelectionResult,type SelectionUniforms,
} from './gpuSelection.ts';

const CLUSTER_FLOATS=16,DAG_NODE_FLOATS=16,FRAME_VEC4=7,CULL_STRIDE=15;
const CLUSTER_ROOT=1,CLUSTER_NEVER=2;
/** Rounds of ancestor escalation before the pinned root cover takes over. */
const DAG_ESCALATION_ROUNDS=3;

export type DagCluster={
 url:string;lodError?:number;parentError?:number|null;sphere?:number[];parentSphere?:number[]|null;level?:number;
 min?:number[];max?:number[];cone?:NormalCone;material?:THREE.Material|THREE.Material[];
};
export type DagRoot={world:THREE.Matrix4;pages:DagCluster[];flat?:boolean;culling?:{nodes:Float64Array;stride:number}};
export type PackedDag={
 kind:'dag';
 clusters:Float32Array;nodes:Float32Array;pageCones:Float32Array;worlds:Float32Array;worldStretch:Float32Array;
 nodeCount:number;worldCount:number;pageCount:number;rootCount:number;pageUrls:string[];
};

/** True when `collectClusterPages` produced only flat roots, i.e. every cluster carries its own band. */
export function rootsAreFlat(roots:ReadonlyArray<{flat?:boolean}>){return roots.length>0&&roots.every(root=>!!root.flat);}

function writeSphere(target:Float32Array,at:number,sphere:ArrayLike<number>|null|undefined){
 const ok=!!sphere&&sphere.length>=4;
 target[at]=ok?sphere![0]:0;target[at+1]=ok?sphere![1]:0;target[at+2]=ok?sphere![2]:0;target[at+3]=ok?sphere![3]:0;
}

/** Pack the cluster bands, their cone/box records and the per-primitive culling nodes. */
export function packDagSelection(roots:readonly DagRoot[]):PackedDag{
 const pageUrls:string[]=[];
 let clusterCount=0,nodeCount=0;
 for(const root of roots){
  clusterCount+=root.pages.length;
  if(root.culling)nodeCount+=root.culling.nodes.length/root.culling.stride;
 }
 const clusters=new Float32Array(Math.max(1,clusterCount)*CLUSTER_FLOATS),clusterInts=new Uint32Array(clusters.buffer);
 const nodes=new Float32Array(Math.max(1,nodeCount)*DAG_NODE_FLOATS),nodeInts=new Uint32Array(nodes.buffer);
 const pageCones=new Float32Array(Math.max(1,clusterCount)*PAGE_CONE_FLOATS);
 const worldSlots=Math.max(1,roots.length);
 const worlds=new Float32Array(worldSlots*16),worldStretch=new Float32Array(worldSlots);
 let cluster=0,node=0,rootClusters=0;
 for(let w=0;w<roots.length;w++){
  const root=roots[w],pageBase=cluster,nodeBase=node,culling=root.culling;
  worlds.set(root.world.elements,w*16);
  worldStretch[w]=maxStretch(root.world.elements);
  const owner=culling?new Uint32Array(root.pages.length).fill(NONE):undefined;
  if(culling){
   if(culling.stride<CULL_STRIDE)throw new Error('GPU_DAG_CULLING_STRIDE');
   const count=culling.nodes.length/culling.stride;
   for(let n=0;n<count;n++){
    const src=n*culling.stride,dst=(nodeBase+n)*DAG_NODE_FLOATS;
    nodes[dst]=culling.nodes[src];nodes[dst+1]=culling.nodes[src+1];nodes[dst+2]=culling.nodes[src+2];nodes[dst+3]=0;
    nodes[dst+4]=culling.nodes[src+3];nodes[dst+5]=culling.nodes[src+4];nodes[dst+6]=culling.nodes[src+5];
    nodes[dst+7]=culling.nodes[src+10];
    nodes[dst+8]=culling.nodes[src+6];nodes[dst+9]=culling.nodes[src+7];nodes[dst+10]=culling.nodes[src+8];nodes[dst+11]=culling.nodes[src+9];
    nodeInts[dst+12]=w;nodeInts[dst+13]=pageBase+culling.nodes[src+13];nodeInts[dst+14]=culling.nodes[src+14];nodeInts[dst+15]=culling.nodes[src+12];
    if(!culling.nodes[src+12]){
     const first=culling.nodes[src+13],pages=culling.nodes[src+14];
     for(let i=0;i<pages&&first+i<owner!.length;i++)owner![first+i]=nodeBase+n;
    }
   }
   node+=count;
  }
  for(let i=0;i<root.pages.length;i++){
   const rec=root.pages[i],dst=cluster*CLUSTER_FLOATS;
   pageUrls.push(rec.url);
   writeSphere(clusters,dst,rec.sphere);
   writeSphere(clusters,dst+4,rec.parentSphere??rec.sphere);
   const parent=typeof rec.parentError==='number'&&Number.isFinite(rec.parentError)?rec.parentError:-1;
   clusters[dst+8]=rec.lodError??0;clusters[dst+9]=parent;
   clusterInts[dst+10]=w;clusterInts[dst+11]=rec.level??0;
   clusterInts[dst+12]=owner?owner[i]:NONE;
   // A cluster that no culling leaf owns is unreachable for the CPU cut too; never select it.
   clusterInts[dst+13]=(parent<0?CLUSTER_ROOT:0)|(owner&&owner[i]===NONE?CLUSTER_NEVER:0);
   clusterInts[dst+14]=0;clusterInts[dst+15]=0;
   if(parent<0)rootClusters++;
   const cone=leafCone(rec),base=cluster*PAGE_CONE_FLOATS,hasBox=rec.min&&rec.max?1:0;
   pageCones[base]=cone.axis[0];pageCones[base+1]=cone.axis[1];pageCones[base+2]=cone.axis[2];pageCones[base+3]=cone.angle;
   pageCones[base+4]=hasBox?rec.min![0]:0;pageCones[base+5]=hasBox?rec.min![1]:0;pageCones[base+6]=hasBox?rec.min![2]:0;pageCones[base+7]=hasBox;
   pageCones[base+8]=hasBox?rec.max![0]:0;pageCones[base+9]=hasBox?rec.max![1]:0;pageCones[base+10]=hasBox?rec.max![2]:0;pageCones[base+11]=0;
   cluster++;
  }
 }
 return {kind:'dag',clusters,nodes,pageCones,worlds,worldStretch,nodeCount,worldCount:roots.length,pageCount:clusterCount,rootCount:rootClusters,pageUrls};
}

export const DAG_SELECTION_SHADER=`struct Cluster{sphere:vec4f,parentSphere:vec4f,lodError:f32,parentError:f32,worldIndex:u32,level:u32,nodeIndex:u32,flags:u32,pad0:u32,pad1:u32,}
struct CullNode{minimum:vec3f,pad0:f32,maximum:vec3f,maxParentError:f32,sphere:vec4f,worldIndex:u32,firstPage:u32,pageCount:u32,childCount:u32,}
struct Uniforms{planes:array<vec4f,6>,view:mat4x4f,pixelScale:vec2f,pixelError:f32,near:f32,clusterCount:u32,nodeCount:u32,worldCount:u32,residentCut:u32,cameraWorld:vec3f,cameraStretch:f32,}
struct Output{count:atomic<u32>,frustumRejected:atomic<u32>,lodLevel:atomic<u32>,overflow:atomic<u32>,pages:array<u32>,}
struct PageCone{cone:vec4f,minimum:vec3f,hasBox:f32,maximum:vec3f,resident:f32,}
@group(0) @binding(0) var<storage, read> clusters:array<Cluster>;
@group(0) @binding(1) var<storage, read> nodes:array<CullNode>;
@group(0) @binding(2) var<uniform> uni:Uniforms;
@group(0) @binding(3) var<storage, read_write> flags:array<u32>;
@group(0) @binding(4) var<storage, read_write> out:Output;
@group(0) @binding(5) var<storage, read_write> work:array<atomic<u32>>;
@group(0) @binding(6) var<storage, read> worlds:array<mat4x4f>;
@group(0) @binding(7) var<storage, read_write> frames:array<vec4f>;
@group(0) @binding(8) var<storage, read> pageCones:array<PageCone>;
/** A WGSL const-expression may not be infinite, so the unreachable band uses the largest f32:
 *  every comparison below behaves exactly as the CPU cut's Infinity for any finite threshold. */
const INF:f32=3.4e38;
const FRAME:u32=7u;
/** Same projection as clusterErrorPixels: error x stretch x focal over the distance to the sphere. */
fn projected(error:f32,sphere:vec4f,e:mat4x4f,stretch:f32,focal:f32)->f32{
 if(error==0.0){return 0.0;}
 if(!(error>0.0)){return INF;}
 let v=(e*vec4f(sphere.xyz,1.0)).xyz;
 let distance=length(v)-sphere.w*stretch;
 if(!(distance>uni.near)){return INF;}
 return (error*stretch*focal)/distance;
}
/** Frustum planes live in the primitive's own space, so no box is ever transformed. */
fn outsideFrustum(base:u32,bmin:vec3f,bmax:vec3f)->bool{
 for(var i=0u;i<6u;i++){
  let plane=frames[base+i];
  let px=select(bmin.x,bmax.x,plane.x>0.0);let py=select(bmin.y,bmax.y,plane.y>0.0);let pz=select(bmin.z,bmax.z,plane.z>0.0);
  if(dot(plane.xyz,vec3f(px,py,pz))+plane.w<0.0){return true;}
 }
 return false;
}
fn inverseTranspose3(m:mat3x3f,v:vec3f)->vec3f{
 let a=m[0];let b=m[1];let c=m[2];
 let det=dot(a,cross(b,c));
 if(abs(det)<1e-20){return v;}
 return (1.0/det)*(mat3x3f(cross(b,c),cross(c,a),cross(a,b))*v);
}
fn isConformal(m:mat3x3f)->bool{
 let lx2=dot(m[0],m[0]);let ly2=dot(m[1],m[1]);let lz2=dot(m[2],m[2]);
 let maxl=max(lx2,max(ly2,lz2));let minl=min(lx2,min(ly2,lz2));
 if(maxl>minl*1.0001+1e-12){return false;}
 let eps=maxl*1e-4+1e-12;
 return abs(dot(m[0],m[1]))<=eps&&abs(dot(m[0],m[2]))<=eps&&abs(dot(m[1],m[2]))<=eps;
}
fn coneRejectsBox(cone:vec4f,bmin:vec3f,bmax:vec3f,world:mat4x4f)->bool{
 if(cone.w>=1.57079632679){return false;}
 let m=mat3x3f(world[0].xyz,world[1].xyz,world[2].xyz);
 if(!isConformal(m)){return false;}
 let c=0.5*(bmin+bmax);let e=0.5*(bmax-bmin);
 let center=(world*vec4f(c,1.0)).xyz;
 let we=abs(world[0].xyz)*e.x+abs(world[1].xyz)*e.y+abs(world[2].xyz)*e.z;
 let toCam=uni.cameraWorld-center;
 let dist=length(toCam);
 if(dist==0.0){return false;}
 let view=toCam/dist;
 let axis=inverseTranspose3(m,cone.xyz);
 let al=length(axis);
 if(!(al>0.0)){return false;}
 let axisWorld=axis/al;
 let radius=length(we);
 if(dist<=radius){return false;}
 let spread=asin(clamp(radius/dist,0.0,1.0));
 let d=dot(axisWorld,view);
 return d<-sin(cone.w+spread)&&(cone.w+spread)<1.57079632679;
}
fn coneRejects(index:u32,cluster:Cluster)->bool{
 let rec=pageCones[index];
 if(rec.hasBox==0.0){return false;}
 return coneRejectsBox(rec.cone,rec.minimum,rec.maximum,worlds[cluster.worldIndex]);
}
fn visible(index:u32,cluster:Cluster)->bool{
 if((cluster.flags&2u)!=0u){return false;}
 if(cluster.nodeIndex!=0xffffffffu&&flags[cluster.nodeIndex]!=0u){return false;}
 let rec=pageCones[index];
 return !outsideFrustum(cluster.worldIndex*FRAME,rec.minimum,rec.maximum);
}
fn selects(cluster:Cluster,e:mat4x4f,stretch:f32,focal:f32,threshold:f32)->bool{
 if(projected(cluster.lodError,cluster.sphere,e,stretch,focal)>threshold){return false;}
 return projected(cluster.parentError,cluster.parentSphere,e,stretch,focal)>threshold;
}
fn focalPixels()->f32{return max(uni.pixelScale.x,uni.pixelScale.y);}
fn stretchOf(world:u32)->f32{return frames[world*FRAME+6u].x*uni.cameraStretch;}
fn emitOne(page:u32){
 let cap=arrayLength(&out.pages);
 let slot=atomicAdd(&out.count,1u);
 if(slot>=cap){atomicStore(&out.overflow,1u);return;}
 out.pages[slot]=page;
}
/** Raise the primitive's threshold to the replacement band, or demand the pinned cover. */
fn escalate(world:u32,parentPixels:f32){
 if(parentPixels>0.0&&parentPixels<INF){atomicMax(&work[world],bitcast<u32>(parentPixels));}
 else{atomicOr(&work[uni.worldCount+world],1u);}
}
@compute @workgroup_size(64)
fn dagReset(@builtin(global_invocation_id) id:vec3u){
 let w=id.x;
 if(w==0u){atomicStore(&out.count,0u);atomicStore(&out.frustumRejected,0u);atomicStore(&out.lodLevel,0u);atomicStore(&out.overflow,0u);}
 if(w>=uni.worldCount){return;}
 atomicStore(&work[w],bitcast<u32>(max(uni.pixelError,0.0)));
 atomicStore(&work[uni.worldCount+w],0u);
}
@compute @workgroup_size(64)
fn dagPlanes(@builtin(global_invocation_id) id:vec3u){
 let w=id.x;if(w>=uni.worldCount){return;}
 let t=transpose(worlds[w]);let base=w*FRAME;
 for(var i=0u;i<6u;i++){frames[base+i]=t*uni.planes[i];}
}
@compute @workgroup_size(64)
fn dagNodes(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.nodeCount){return;}
 let node=nodes[i];let base=node.worldIndex*FRAME;
 if(outsideFrustum(base,node.minimum,node.maximum)){flags[i]=1u;return;}
 if(node.maxParentError>=0.0){
  let e=uni.view*worlds[node.worldIndex];
  if(projected(node.maxParentError,node.sphere,e,stretchOf(node.worldIndex),focalPixels())<=uni.pixelError){flags[i]=2u;return;}
 }
 flags[i]=0u;
}
@compute @workgroup_size(64)
fn dagWanted(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.clusterCount){return;}
 let cluster=clusters[i];
 if(!visible(i,cluster)){atomicAdd(&out.frustumRejected,1u);return;}
 let w=cluster.worldIndex;
 let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,uni.pixelError)){return;}
 if(coneRejects(i,cluster)){return;}
 atomicMax(&out.lodLevel,cluster.level);
 emitOne(i);
 if(uni.residentCut==0u||pageCones[i].resident!=0.0){return;}
 escalate(w,projected(cluster.parentError,cluster.parentSphere,e,stretch,focal));
}
@compute @workgroup_size(64)
fn dagEscalate(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.clusterCount||uni.residentCut==0u){return;}
 if(pageCones[i].resident!=0.0){return;}
 let cluster=clusters[i];
 if(!visible(i,cluster)){return;}
 let w=cluster.worldIndex;
 let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,bitcast<f32>(atomicLoad(&work[w])))){return;}
 if(coneRejects(i,cluster)){return;}
 escalate(w,projected(cluster.parentError,cluster.parentSphere,e,stretch,focal));
}
@compute @workgroup_size(64)
fn dagCheck(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.clusterCount||uni.residentCut==0u){return;}
 if(pageCones[i].resident!=0.0){return;}
 let cluster=clusters[i];
 if(!visible(i,cluster)){return;}
 let w=cluster.worldIndex;
 let e=uni.view*worlds[w];let stretch=stretchOf(w);let focal=focalPixels();
 if(!selects(cluster,e,stretch,focal,bitcast<f32>(atomicLoad(&work[w])))){return;}
 if(coneRejects(i,cluster)){return;}
 atomicOr(&work[uni.worldCount+w],1u);
}
@compute @workgroup_size(64)
fn dagMask(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.clusterCount){return;}
 let cluster=clusters[i];
 var draw=false;
 if(visible(i,cluster)&&!coneRejects(i,cluster)){
  let w=cluster.worldIndex;
  if(uni.residentCut!=0u&&atomicLoad(&work[uni.worldCount+w])!=0u){
   // No resident ancestor replaces the missing cluster: this primitive falls back to its pinned roots.
   draw=(cluster.flags&1u)!=0u;
   if(draw&&pageCones[i].resident==0.0){atomicOr(&out.overflow,2u);draw=false;}
  }else{
   let e=uni.view*worlds[w];
   let threshold=select(uni.pixelError,bitcast<f32>(atomicLoad(&work[w])),uni.residentCut!=0u);
   draw=selects(cluster,e,stretchOf(w),focalPixels(),threshold);
   if(draw&&uni.residentCut!=0u&&pageCones[i].resident==0.0){atomicOr(&out.overflow,2u);draw=false;}
  }
 }
 flags[uni.nodeCount+i]=select(0u,1u,draw);
}
`;

const dagScratch={view:new THREE.Matrix4(),world:new THREE.Matrix4(),viewMatrix:new THREE.Matrix4(),cam:new THREE.PerspectiveCamera(),cone:{axis:[0,0,1] as [number,number,number],angle:Math.PI},min:[0,0,0] as number[],max:[0,0,0] as number[],planes:new Float64Array(24)};

function objectPlanes(uniforms:SelectionUniforms,world:THREE.Matrix4,into:Float64Array){
 const m=world.elements,source=uniforms.planes;
 for(let i=0;i<6;i++){
  const a=source[i*4],b=source[i*4+1],c=source[i*4+2],d=source[i*4+3];
  into[i*4]=m[0]*a+m[1]*b+m[2]*c+m[3]*d;
  into[i*4+1]=m[4]*a+m[5]*b+m[6]*c+m[7]*d;
  into[i*4+2]=m[8]*a+m[9]*b+m[10]*c+m[11]*d;
  into[i*4+3]=m[12]*a+m[13]*b+m[14]*c+m[15]*d;
 }
}
function outsidePlanes(planes:Float64Array,minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number){
 for(let p=0;p<24;p+=4){
  const a=planes[p],b=planes[p+1],c=planes[p+2],d=planes[p+3];
  if(a*(a>0?maxX:minX)+b*(b>0?maxY:minY)+c*(c>0?maxZ:minZ)+d<0)return true;
 }
 return false;
}
function projectedError(error:number,sx:number,sy:number,sz:number,radius:number,e:ArrayLike<number>,stretch:number,focal:number,near:number){
 if(error===0)return 0;
 if(!(error>0))return Infinity;
 const vx=e[0]*sx+e[4]*sy+e[8]*sz+e[12];
 const vy=e[1]*sx+e[5]*sy+e[9]*sz+e[13];
 const vz=e[2]*sx+e[6]*sy+e[10]*sz+e[14];
 const distance=Math.sqrt(vx*vx+vy*vy+vz*vz)-radius*stretch;
 if(!(distance>near))return Infinity;
 return (error*stretch*focal)/distance;
}

/** Node oracle for the kernel, in the same shape the shader uses. Not called by the renderer. */
export function evaluateDagSelectionKernel(packed:PackedDag,uniforms:SelectionUniforms,resident?:Uint32Array){
 if(resident&&resident.length!==packed.pageCount)throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED');
 const {clusters,nodes,pageCones,worlds,worldStretch}=packed;
 const clusterInts=new Uint32Array(clusters.buffer),nodeInts=new Uint32Array(nodes.buffer);
 const cameraStretch=uniforms.cameraStretch??1,focal=Math.max(uniforms.pixelScale[0],uniforms.pixelScale[1]),near=uniforms.near;
 const pixelError=uniforms.pixelError;
 const planes:Float64Array[]=[],views:number[][]=[],stretches:number[]=[];
 const {view,world,viewMatrix}=dagScratch;
 view.fromArray(uniforms.view);
 for(let w=0;w<packed.worldCount;w++){
  world.fromArray(worlds.subarray(w*16,w*16+16));
  const object=new Float64Array(24);objectPlanes(uniforms,world,object);planes.push(object);
  viewMatrix.multiplyMatrices(view,world);views.push([...viewMatrix.elements]);
  stretches.push(worldStretch[w]*cameraStretch);
 }
 const nodeFlags=new Uint8Array(Math.max(1,packed.nodeCount));
 for(let n=0;n<packed.nodeCount;n++){
  const base=n*DAG_NODE_FLOATS,w=nodeInts[base+12];
  if(outsidePlanes(planes[w],nodes[base],nodes[base+1],nodes[base+2],nodes[base+4],nodes[base+5],nodes[base+6])){nodeFlags[n]=1;continue;}
  const bound=nodes[base+7];
  if(bound>=0&&projectedError(bound,nodes[base+8],nodes[base+9],nodes[base+10],nodes[base+11],views[w],stretches[w],focal,near)<=pixelError)nodeFlags[n]=2;
 }
 const coneRejects=(index:number,w:number)=>{
  const base=index*PAGE_CONE_FLOATS;
  if(!pageCones[base+7])return false;
  const {cone,cam,min,max}=dagScratch;
  cone.axis[0]=pageCones[base];cone.axis[1]=pageCones[base+1];cone.axis[2]=pageCones[base+2];cone.angle=pageCones[base+3];
  min[0]=pageCones[base+4];min[1]=pageCones[base+5];min[2]=pageCones[base+6];
  max[0]=pageCones[base+8];max[1]=pageCones[base+9];max[2]=pageCones[base+10];
  const cw=uniforms.cameraWorld;cam.position.set(cw[0],cw[1],cw[2]);cam.updateMatrixWorld();
  dagScratch.world.fromArray(worlds.subarray(w*16,w*16+16));
  return coneCullsPage(cone,dagScratch.world,min,max,cam);
 };
 const visible=(index:number)=>{
  const base=index*CLUSTER_FLOATS,w=clusterInts[base+10],node=clusterInts[base+12];
  if(clusterInts[base+13]&CLUSTER_NEVER)return false;
  if(node!==NONE&&nodeFlags[node])return false;
  const cone=index*PAGE_CONE_FLOATS;
  return !outsidePlanes(planes[w],pageCones[cone+4],pageCones[cone+5],pageCones[cone+6],pageCones[cone+8],pageCones[cone+9],pageCones[cone+10]);
 };
 const bandPixels=(index:number,at:number)=>{
  const base=index*CLUSTER_FLOATS,w=clusterInts[base+10],offset=at===0?0:4;
  return projectedError(at===0?clusters[base+8]:clusters[base+9],clusters[base+offset],clusters[base+offset+1],clusters[base+offset+2],clusters[base+offset+3],views[w],stretches[w],focal,near);
 };
 const selects=(index:number,threshold:number)=>bandPixels(index,0)<=threshold&&bandPixels(index,1)>threshold;
 const pageIds:number[]=[];
 let frustumRejected=0,lodLevel=0;
 const thresholds=new Float64Array(Math.max(1,packed.worldCount)).fill(Math.max(pixelError,0));
 const missing=new Uint8Array(Math.max(1,packed.worldCount));
 for(let i=0;i<packed.pageCount;i++){
  const base=i*CLUSTER_FLOATS,w=clusterInts[base+10];
  if(!visible(i)){frustumRejected++;continue;}
  if(!selects(i,pixelError))continue;
  if(coneRejects(i,w))continue;
  if(clusterInts[base+11]>lodLevel)lodLevel=clusterInts[base+11];
  pageIds.push(i);
  if(!resident||resident[i])continue;
  const parent=bandPixels(i,1);
  if(parent>0&&Number.isFinite(parent))thresholds[w]=Math.max(thresholds[w],parent);else missing[w]=1;
 }
 const drawablePageIds:number[]=[];
 if(!resident)return {pageIds,frustumRejected,lodLevel,complete:true,drawablePageIds:pageIds.slice()} as SelectionResult;
 for(let round=0;round<DAG_ESCALATION_ROUNDS+1;round++){
  let raised=false;
  for(let i=0;i<packed.pageCount;i++){
   if(resident[i])continue;
   const base=i*CLUSTER_FLOATS,w=clusterInts[base+10];
   if(!visible(i)||!selects(i,thresholds[w])||coneRejects(i,w))continue;
   const parent=bandPixels(i,1);
   if(parent>0&&Number.isFinite(parent)){if(parent>thresholds[w]){thresholds[w]=parent;raised=true;}}
   else if(!missing[w]){missing[w]=1;raised=true;}
  }
  if(!raised)break;
  if(round===DAG_ESCALATION_ROUNDS)for(let i=0;i<packed.pageCount;i++){
   if(resident[i])continue;
   const base=i*CLUSTER_FLOATS,w=clusterInts[base+10];
   if(visible(i)&&selects(i,thresholds[w])&&!coneRejects(i,w))missing[w]=1;
  }
 }
 let complete=true;
 for(let i=0;i<packed.pageCount;i++){
  const base=i*CLUSTER_FLOATS,w=clusterInts[base+10];
  if(!visible(i)||coneRejects(i,w))continue;
  let draw:boolean;
  if(missing[w]){draw=!!(clusterInts[base+13]&CLUSTER_ROOT);if(draw&&!resident[i]){complete=false;draw=false;}}
  else{draw=selects(i,thresholds[w]);if(draw&&!resident[i]){complete=false;draw=false;}}
  if(draw)drawablePageIds.push(i);
 }
 return {pageIds,frustumRejected,lodLevel,complete,drawablePageIds} as SelectionResult;
}

function writeDagUniforms(target:Float32Array,packed:PackedDag,uniforms:SelectionUniforms,residentCut:boolean){
 target.fill(0);target.set(uniforms.planes,0);target.set(uniforms.view,24);
 target[40]=uniforms.pixelScale[0];target[41]=uniforms.pixelScale[1];target[42]=uniforms.pixelError;target[43]=uniforms.near;
 const ints=new Uint32Array(target.buffer,target.byteOffset,target.length);
 ints[44]=packed.pageCount;ints[45]=packed.nodeCount;ints[46]=packed.worldCount;ints[47]=residentCut?1:0;
 const cw=uniforms.cameraWorld;if(cw){target[48]=cw[0];target[49]=cw[1];target[50]=cw[2];}
 target[51]=uniforms.cameraStretch??1;
}

function parseDagOutput(bytes:ArrayBufferLike,byteOffset:number,byteLength:number,maskPageCount:number):SelectionResult|null{
 const ints=new Uint32Array(bytes,byteOffset,Math.floor(byteLength/4));
 if(((ints[3]??0)&1)!==0)return null;
 const count=Math.min(ints[0]??0,Math.max(0,ints.length-4-maskPageCount));
 const result:SelectionResult={pageIds:[...ints.subarray(4,4+count)],frustumRejected:ints[1]??0,lodLevel:ints[2]??0,complete:((ints[3]??0)&2)===0};
 if(maskPageCount){
  result.drawablePageIds=[];
  const offset=ints.length-maskPageCount;
  for(let i=0;i<maskPageCount;i++)if(ints[offset+i])result.drawablePageIds.push(i);
 }
 return result;
}

/** WebGPU flat cluster cut. Returns undefined so the caller silently keeps the CPU oracle. */
export async function createGpuDagSelection(device:GPUDevice,packed:PackedDag,options:{residentCut?:boolean;createEncoder?:()=>GPUCommandEncoder}={}):Promise<GpuSelection|undefined>{
 if(typeof device.createComputePipeline!=='function'||packed.pageCount<1)return undefined;
 const STORAGE=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;
 const residentCut=!!options.residentCut,pageCount=packed.pageCount,nodeCount=packed.nodeCount,worldCount=Math.max(1,packed.worldCount);
 const groups=(count:number)=>Math.max(1,Math.ceil(count/WORKGROUP));
 const outputBytes=16+pageCount*4,readbackBytes=outputBytes+(residentCut?pageCount*4:0);
 const uniformData=new Float32Array(UNIFORM_BYTES/4);
 const frameData=new Float32Array(worldCount*FRAME_VEC4*4);
 for(let w=0;w<packed.worldCount;w++)frameData[(w*FRAME_VEC4+6)*4]=packed.worldStretch[w];
 let last:GpuCut|null=null,lastSubmitted:SelectionUniforms|undefined,lastReadback:SelectionUniforms|undefined;
 let pending:Promise<unknown>=Promise.resolve(),disposed=false,dead=false,worldRevision=0,residencyRevision=0,submittedResidencyRevision=-1,readbackResidencyRevision=-1;
 const mapped=[false,false];let slot=0;
 const buffers:GPUBuffer[]=[];
 const fail=()=>{dead=true;last=null;lastSubmitted=undefined;lastReadback=undefined;};
 try{
  const clusters=device.createBuffer({size:Math.max(64,packed.clusters.byteLength),usage:STORAGE});
  const nodes=device.createBuffer({size:Math.max(64,packed.nodes.byteLength),usage:STORAGE});
  const uniforms=device.createBuffer({size:UNIFORM_BYTES,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const flags=device.createBuffer({size:Math.max(4,(nodeCount+pageCount)*4),usage:STORAGE|GPUBufferUsage.COPY_SRC});
  const output=device.createBuffer({size:outputBytes,usage:STORAGE|GPUBufferUsage.COPY_SRC});
  const work=device.createBuffer({size:Math.max(8,worldCount*2*4),usage:STORAGE});
  const worlds=device.createBuffer({size:Math.max(64,packed.worlds.byteLength),usage:STORAGE});
  const frames=device.createBuffer({size:Math.max(16,frameData.byteLength),usage:STORAGE});
  const pageCones=device.createBuffer({size:Math.max(48,packed.pageCones.byteLength),usage:STORAGE});
  const readback=[
   device.createBuffer({size:readbackBytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),
   device.createBuffer({size:readbackBytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),
  ];
  buffers.push(clusters,nodes,uniforms,flags,output,work,worlds,frames,pageCones,...readback);
  if(typeof device.pushErrorScope==='function')device.pushErrorScope('validation');
  const storage={type:'storage'} as const,readOnly={type:'read-only-storage'} as const;
  const layout=device.createBindGroupLayout({entries:[
   {binding:0,visibility:GPUShaderStage.COMPUTE,buffer:readOnly},
   {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:readOnly},
   {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
   {binding:3,visibility:GPUShaderStage.COMPUTE,buffer:storage},
   {binding:4,visibility:GPUShaderStage.COMPUTE,buffer:storage},
   {binding:5,visibility:GPUShaderStage.COMPUTE,buffer:storage},
   {binding:6,visibility:GPUShaderStage.COMPUTE,buffer:readOnly},
   {binding:7,visibility:GPUShaderStage.COMPUTE,buffer:storage},
   {binding:8,visibility:GPUShaderStage.COMPUTE,buffer:readOnly},
  ]});
  const module=device.createShaderModule({code:DAG_SELECTION_SHADER});
  if(typeof module.getCompilationInfo==='function'){
   const info=await module.getCompilationInfo();
   if(info.messages.some(message=>message.type==='error')){
    if(typeof device.popErrorScope==='function')await device.popErrorScope().catch(()=>{});
    for(const buffer of buffers)buffer.destroy();
    return undefined;
   }
  }
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
  const stage=(entryPoint:string)=>device.createComputePipeline({layout:pipelineLayout,compute:{module,entryPoint}});
  const resetPipeline=stage('dagReset'),planePipeline=stage('dagPlanes'),nodePipeline=stage('dagNodes');
  const wantedPipeline=stage('dagWanted'),escalatePipeline=stage('dagEscalate'),checkPipeline=stage('dagCheck'),maskPipeline=stage('dagMask');
  if(typeof device.popErrorScope==='function'){
   const error=await device.popErrorScope();
   if(error){for(const buffer of buffers)buffer.destroy();return undefined;}
  }
  const bindGroup=device.createBindGroup({layout,entries:[
   {binding:0,resource:{buffer:clusters}},{binding:1,resource:{buffer:nodes}},{binding:2,resource:{buffer:uniforms}},
   {binding:3,resource:{buffer:flags}},{binding:4,resource:{buffer:output}},{binding:5,resource:{buffer:work}},
   {binding:6,resource:{buffer:worlds}},{binding:7,resource:{buffer:frames}},{binding:8,resource:{buffer:pageCones}},
  ]});
  const upload=(target:GPUBuffer,size:number,source:Float32Array)=>{
   const copy=new Uint8Array(size);
   if(source.byteLength)copy.set(new Uint8Array(source.buffer,source.byteOffset,source.byteLength));
   device.queue.writeBuffer(target,0,copy);
  };
  upload(clusters,Math.max(64,packed.clusters.byteLength),packed.clusters);
  upload(nodes,Math.max(64,packed.nodes.byteLength),packed.nodes);
  upload(worlds,Math.max(64,packed.worlds.byteLength),packed.worlds);
  upload(frames,Math.max(16,frameData.byteLength),frameData);
  upload(pageCones,Math.max(48,packed.pageCones.byteLength),packed.pageCones);
  const previousWorlds=packed.worlds.slice();
  const selection:GpuSelection={
   residentCut,maskBuffer:flags,maskOffset:nodeCount,pageCount,
   updateWorlds(next){
    if(disposed||dead)return false;
    if(next.byteLength!==packed.worlds.byteLength)throw new Error('GPU_SCENE_WORLD_COUNT_CHANGED');
    let changed=false;for(let j=0;j<next.length;j++)if(previousWorlds[j]!==next[j]){changed=true;break;}
    if(!changed)return false;
    previousWorlds.set(next);packed.worlds.set(next);
    device.queue.writeBuffer(worlds,0,next.buffer as ArrayBuffer,next.byteOffset,next.byteLength);
    // The object-to-view stretch is the primitive's own; recompute it whenever its placement moves.
    for(let w=0;w<packed.worldCount;w++){
     packed.worldStretch[w]=maxStretch(Array.from(packed.worlds.subarray(w*16,w*16+16)));
     frameData[(w*FRAME_VEC4+6)*4]=packed.worldStretch[w];
    }
    device.queue.writeBuffer(frames,0,frameData as Float32Array<ArrayBuffer>);
    worldRevision++;last=null;lastSubmitted=undefined;lastReadback=undefined;
    return true;
   },
   updateResidency(next){
    if(disposed||dead||!residentCut)return false;
    if(next.length!==pageCount)throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED');
    let changed=false;
    for(let j=0;j<next.length;j++){
     const index=j*PAGE_CONE_FLOATS+11,value=next[j]?1:0;
     if(packed.pageCones[index]!==value){packed.pageCones[index]=value;changed=true;}
    }
    if(!changed)return false;
    device.queue.writeBuffer(pageCones,0,packed.pageCones as Float32Array<ArrayBuffer>);
    residencyRevision++;last=null;
    return true;
   },
   dispatch(next){
    if(disposed||dead)return;
    const compute=!lastSubmitted||!sameSelectionUniforms(lastSubmitted,next)||submittedResidencyRevision!==residencyRevision;
    const needsReadback=!lastReadback||!sameSelectionUniforms(lastReadback,next)||readbackResidencyRevision!==residencyRevision;
    const i=!mapped[slot]?slot:!mapped[slot^1]?slot^1:-1;
    const copy=needsReadback&&i>=0;
    if((!compute&&!copy)||(!residentCut&&i<0))return;
    const encoder=options.createEncoder?.()??device.createCommandEncoder();
    if(compute){
     writeDagUniforms(uniformData,packed,next,residentCut);device.queue.writeBuffer(uniforms,0,uniformData);
     const pass=encoder.beginComputePass({label:'WG DAG selection'});
     pass.setBindGroup(0,bindGroup);
     const run=(pipeline:GPUComputePipeline,count:number)=>{pass.setPipeline(pipeline);pass.dispatchWorkgroups(groups(count));};
     run(resetPipeline,worldCount);
     run(planePipeline,worldCount);
     run(nodePipeline,Math.max(1,nodeCount));
     run(wantedPipeline,pageCount);
     if(residentCut){
      for(let round=0;round<DAG_ESCALATION_ROUNDS;round++)run(escalatePipeline,pageCount);
      run(checkPipeline,pageCount);
     }
     run(maskPipeline,pageCount);
     pass.end();
     lastSubmitted=copySelectionUniforms(next);submittedResidencyRevision=residencyRevision;
    }
    if(copy){
     encoder.copyBufferToBuffer(output,0,readback[i],0,outputBytes);
     if(residentCut)encoder.copyBufferToBuffer(flags,nodeCount*4,readback[i],outputBytes,pageCount*4);
    }
    device.queue.submit([encoder.finish()]);
    if(!copy)return;
    const captured=copySelectionUniforms(next),capturedWorldRevision=worldRevision,capturedResidencyRevision=residencyRevision;
    lastReadback=captured;readbackResidencyRevision=residencyRevision;mapped[i]=true;slot=i^1;
    pending=pending.catch(()=>{}).then(async()=>{
     try{
      await readback[i].mapAsync(GPUMapMode.READ);
      const bytes=readback[i].getMappedRange();
      const parsed=parseDagOutput(bytes,0,bytes.byteLength,residentCut?pageCount:0);
      readback[i].unmap();mapped[i]=false;
      if(!parsed){fail();return;}
      if(capturedWorldRevision===worldRevision&&capturedResidencyRevision===residencyRevision)last={uniforms:captured,result:parsed};
     }catch{try{readback[i].unmap();}catch{/* Mapping may already be closed. */}mapped[i]=false;fail();}
    });
   },
   peek(){return dead?null:last;},
   failed(){return dead;},
   async flush(){
    await pending;
    if(residentCut&&!dead&&lastSubmitted&&submittedResidencyRevision===residencyRevision&&(!lastReadback||!sameSelectionUniforms(lastReadback,lastSubmitted)||readbackResidencyRevision!==residencyRevision)){
     selection.dispatch(lastSubmitted);await pending;
    }
    return dead?null:last?.result??null;
   },
   dispose(){disposed=true;dead=true;pending=pending.catch(()=>{});for(const buffer of buffers)buffer.destroy();},
  };
  return selection;
 }catch{
  if(typeof device.popErrorScope==='function')await device.popErrorScope().catch(()=>{});
  for(const buffer of buffers)try{buffer.destroy();}catch{/* Partial GPU selection setup must not leak. */}
  return undefined;
 }
}
