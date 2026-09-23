import { DAG_ERROR_WGSL } from './gpuDagShaderError.ts';
import { INVERSE_TRANSPOSE_WGSL } from './inverseTransposeWgsl.ts';
import { DAG_COMPACT_WGSL } from './gpuDagCompactWgsl.ts';
import { DAG_TOTALS_WGSL } from './gpuDagTotalsWgsl.ts';
import { DAG_RELEVE_WGSL } from './gpuDagReleveWgsl.ts';
import { DAG_REQUEST_WGSL } from './gpuDagRequest.ts';
import { DAG_WANTED_WGSL } from './gpuDagWantedWgsl.ts';
import { DAG_LIVE_WGSL } from './gpuDagLiveWgsl.ts';
import { DAG_LEVEL_WGSL } from './gpuDagLevelWgsl.ts';
import { DAG_FLOOR_WGSL } from './gpuDagFloorWgsl.ts';
import { DAG_RECORD_WGSL } from './gpuDagRecordWgsl.ts';
import { ESCALATION_SLACK } from './pageSelectionTypes.ts';
import {
  CONE_LENGTH_RATIO_WGSL,
  CONE_ORTHO_EPS_WGSL,
  HALF_PI_WGSL,
} from '../sdk-core/src/index.ts';

export const DAG_SELECTION_SHADER = `struct Cluster{sphere:vec4f,parentSphere:vec4f,lodError:f32,parentError:f32,worldIndex:u32,flags:u32,}
struct CullNode{minimum:vec3f,firstChild:u32,maximum:vec3f,maxParentError:f32,sphere:vec4f,worldIndex:u32,firstPage:u32,pageCount:u32,childCount:u32,floorSphere:vec4f,errorFloor:f32,nodeFlags:u32,pad0:u32,pad1:u32,}
// \`view\`, \`planes\` and \`worlds\` are those of the render frame; \`cameraWorld\` is its origin, which
// the kernel need not read since the camera sits at zero there: it is sent so the block's reader can name it.
// \`perspective\` is the projection's clip-w weight, 1 perspective and 0 orthographic (\`viewPoint\`).
struct Uniforms{planes:array<vec4f,6>,view:mat4x4f,pixelScale:vec2f,pixelError:f32,near:f32,clusterCount:u32,nodeCount:u32,worldCount:u32,residentCut:u32,cameraWorld:vec3f,cameraStretch:f32,listCap:u32,perspective:f32,pad1:u32,pad2:u32,}
struct Output{count:atomic<u32>,frustumRejected:atomic<u32>,lodLevel:atomic<u32>,overflow:atomic<u32>,selectedTriangles:atomic<u32>,transparentTriangles:atomic<u32>,drawnTriangles:atomic<u32>,uncoveredTriangles:atomic<u32>,pages:array<u32>,}
@group(0) @binding(0) var<storage, read> clusters:array<Cluster>;
@group(0) @binding(1) var<storage, read> nodes:array<CullNode>;
@group(0) @binding(2) var<uniform> uni:Uniforms;
@group(0) @binding(3) var<storage, read_write> flags:array<u32>;
@group(0) @binding(4) var<storage, read_write> out:Output;
@group(0) @binding(5) var<storage, read_write> work:array<atomic<u32>>;
@group(0) @binding(6) var<storage, read> worlds:array<mat4x4f>;
@group(0) @binding(7) var<storage, read_write> frames:array<vec4f>;
@group(0) @binding(8) var<storage, read> cold:array<u32>;
/** A WGSL const-expression may not be infinite, so the unreachable band uses the largest f32:
 *  every comparison below behaves exactly as the CPU cut's Infinity for any finite threshold. */
const INF:f32=3.4e38;
const FRAME:u32=7u;
/** Frustum planes live in the primitive's own space, so no box is ever transformed.
 *  GPU mirror of \`frustumExcludesBox\` (sdk-core, mathFrustumBox.ts): same corners, same sum. */
fn outsideFrustum(base:u32,bmin:vec3f,bmax:vec3f)->bool{
 for(var i=0u;i<6u;i++){
  let plane=frames[base+i];
  let px=select(bmin.x,bmax.x,plane.x>0.0);let py=select(bmin.y,bmax.y,plane.y>0.0);let pz=select(bmin.z,bmax.z,plane.z>0.0);
  if(dot(plane.xyz,vec3f(px,py,pz))+plane.w<0.0){return true;}
 }
 return false;
}
/** GPU mirror of \`isConformal\` (pageCone.ts): 3x3 divided by the sum of its absolute values,
 *  relative tolerances only; null, infinite or NaN sum (read at the bit): cluster kept. */
fn isConformal(m:mat3x3f)->bool{
 let s=abs(m[0])+abs(m[1])+abs(m[2]);let t=s.x+s.y+s.z;
 if(!(t>0.0)||(bitcast<u32>(t)&0x7f800000u)==0x7f800000u){return false;}
 let a=m[0]/t;let b=m[1]/t;let c=m[2]/t;
 let lx2=dot(a,a);let ly2=dot(b,b);let lz2=dot(c,c);
 let maxl=max(lx2,max(ly2,lz2));let minl=min(lx2,min(ly2,lz2));
 if(maxl>minl*${CONE_LENGTH_RATIO_WGSL}){return false;}
 let eps=maxl*${CONE_ORTHO_EPS_WGSL};
 return abs(dot(a,b))<=eps&&abs(dot(a,c))<=eps&&abs(dot(b,c))<=eps;
}
/** GPU mirror of \`coneCullsPageWith\` (pageCone.ts): same tolerances (mathCone.ts), same operands.
 *  \`world\` is a world matrix of the RENDER FRAME, where the camera is the origin: the vector from
 *  the box centre to the eye is the opposite of that centre, and subtracting two distant positions
 *  no longer happens. Same geometry as the CPU mirror, which works in absolute world space. */
/** The camera as one homogeneous point of the render frame (\`EngineCamera.viewPoint\`): the origin
 *  under a perspective projection, the way back — the view's third row — under an orthographic one. */
fn viewPoint()->vec4f{
 let back=vec3f(uni.view[0].z,uni.view[1].z,uni.view[2].z);
 return vec4f(back*(1.0-uni.perspective),uni.perspective);
}
fn coneRejectsBox(cone:vec4f,bmin:vec3f,bmax:vec3f,world:mat4x4f)->bool{
 if(cone.w>=${HALF_PI_WGSL}){return false;}
 let m=mat3x3f(world[0].xyz,world[1].xyz,world[2].xyz);
 if(!isConformal(m)){return false;}
 let c=0.5*(bmin+bmax);let e=0.5*(bmax-bmin);
 let center=(world*vec4f(c,1.0)).xyz;
 let we=abs(world[0].xyz)*e.x+abs(world[1].xyz)*e.y+abs(world[2].xyz)*e.z;
 let eye=viewPoint();
 let toCam=eye.xyz-center*eye.w;
 let dist=length(toCam);
 if(dist==0.0){return false;}
 let view=toCam/dist;
 let axis=inverseTranspose3(m,cone.xyz);
 let al=length(axis);
 if(!(al>0.0)){return false;}
 let axisWorld=axis/al;
 let radius=length(we);
 if(dist<=radius*eye.w){return false;}
 let spread=asin(clamp(radius*eye.w/dist,0.0,1.0));
 let d=dot(axisWorld,view);
 return d<-sin(cone.w+spread)&&(cone.w+spread)<${HALF_PI_WGSL};
}
fn coneRejects(index:u32,cluster:Cluster)->bool{
 if(hasBox(index)==0.0){return false;}
 return coneRejectsBox(coneOf(index),boxMin(index),boxMax(index),worlds[cluster.worldIndex]);
}
/** Cone reject depends only on the page, its world and the camera: it is therefore the same for
 *  the five passes of one frame. \`dagWanted\` computes it once per visible page and stores it
 *  behind the draw flags; later passes reread it instead of redoing \`asin\`, \`sin\` and the two
 *  \`length\`s. They only read it for a visible page, the only one it was written for. */
fn coneCache(index:u32)->u32{return uni.nodeCount+uni.clusterCount+index;}
fn coneRejected(index:u32)->bool{return flags[coneCache(index)]!=0u;}
fn visible(index:u32,cluster:Cluster)->bool{
 if((cluster.flags&2u)!=0u){return false;}
 return !outsideFrustum(cluster.worldIndex*FRAME,boxMin(index),boxMax(index));
}
fn stretchOf(world:u32)->f32{return frames[world*FRAME+6u].x*uni.cameraStretch;}
/** Raise the primitive's threshold to the replacement band, or demand the pinned cover.
 *  The threshold is set STRICTLY above the parent's error (\`ESCALATION_SLACK\` slack): passes that
 *  reread it recompute that error in another entry point, where the driver does not return the
 *  same f32 to the last bit. An exact equality there left the missing cluster kept by \`dagMask\`
 *  — a non-resident page drawn, hence coverage declared incomplete. */
fn escalate(world:u32,parentPixels:f32){
 let raised=parentPixels*${ESCALATION_SLACK};
 if(parentPixels>0.0&&raised<INF){atomicMax(&work[world],bitcast<u32>(raised));}
 else{atomicOr(&work[uni.worldCount+world],1u);}
}
/** Reset and per-primitive planes: two kernels yesterday, a single dispatch today.
 *  Nothing tied them — the first writes the thresholds, output counters and block counts that
 *  \`dagMask\` accumulates, the second the frustum planes — and only the descent reads the second. */
@compute @workgroup_size(64)
fn dagPrepare(@builtin(global_invocation_id) id:vec3u){
 let w=id.x;
 if(w==0u){atomicStore(&out.count,0u);atomicStore(&out.frustumRejected,0u);atomicStore(&out.lodLevel,0u);atomicStore(&out.overflow,0u);resetTotaux();resetCounters();}
 if(w<blockCount()){atomicStore(&work[blockBase()+w],0u);}
 if(w>=uni.worldCount){return;}
 // The primitive's root opens the descent: one thread, one root, no counter to contend for.
 flags[queueBase(0u)+w]=rootOf(w);
 atomicStore(&work[w],bitcast<u32>(resetPrune(w)));
 atomicStore(&work[uni.worldCount+w],0u);
 let t=transpose(worlds[w]);let base=w*FRAME;
 for(var i=0u;i<6u;i++){frames[base+i]=t*uni.planes[i];}
}
@compute @workgroup_size(64)
fn dagMask(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lid:u32){
 // Totals are summed in the workgroup first (\`gpuDagTotalsWgsl.ts\`), so EVERY thread in the
 // group crosses both barriers: a thread with no cluster does not return early, it does nothing.
 ouvreTotaux(lid);
 let s=id.x;
 if(s<liveCount()){
  let i=liveAt(s);
  let cluster=clusters[i];
  var draw=false;
  var trou=false;
  if(!coneRejected(i)){
   let w=cluster.worldIndex;
   if(uni.residentCut!=0u&&(atomicLoad(&work[uni.worldCount+w])!=0u||pruneCrossed(w))){
    // No resident ancestor replaces the missing cluster: this primitive falls back to its pinned roots.
    draw=(cluster.flags&1u)!=0u;
    if(draw&&!isResident(i)){atomicOr(&out.overflow,2u);draw=false;trou=true;}
   }else{
    let e=uni.view*worlds[w];
    let threshold=select(uni.pixelError,bitcast<f32>(atomicLoad(&work[w])),uni.residentCut!=0u);
    draw=selects(cluster,e,stretchOf(w),focalPixels(),threshold);
    if(draw&&uni.residentCut!=0u&&!isResident(i)){atomicOr(&out.overflow,2u);draw=false;trou=true;}
   }
  }
  let posee=select(0u,1u,draw);
  flags[uni.nodeCount+i]=posee;
  noteImage(i,cluster.flags,draw||trou,draw,trou);
  // Drawn count of this page's block, held here rather than reread later page by page.
  if(posee!=0u){atomicAdd(&work[blockBase()+i/BLOCK],1u);drawnAppend(i);}
 }
 verseTotaux(lid);
}
${DAG_ERROR_WGSL}
${INVERSE_TRANSPOSE_WGSL}
${DAG_COMPACT_WGSL}${DAG_TOTALS_WGSL}${DAG_REQUEST_WGSL}${DAG_RELEVE_WGSL}${DAG_WANTED_WGSL}
${DAG_LIVE_WGSL}
${DAG_LEVEL_WGSL}
${DAG_FLOOR_WGSL}
${DAG_RECORD_WGSL}`;
