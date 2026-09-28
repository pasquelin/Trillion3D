import { DAG_BINDINGS_WGSL } from './bindings.ts';
import { DAG_ERROR_WGSL } from './error.ts';
import { INVERSE_TRANSPOSE_WGSL } from '../../../math/inverseTransposeWgsl.ts';
import { DAG_COMPACT_WGSL } from './compactWgsl.ts';
import { DAG_TOTALS_WGSL } from './totalsWgsl.ts';
import { DAG_RELEVE_WGSL } from './snapshotWgsl.ts';
import { DAG_REQUEST_WGSL } from '../request.ts';
import { DAG_WANTED_WGSL } from './wantedWgsl.ts';
import { DAG_LIVE_WGSL } from './liveWgsl.ts';
import { DAG_LEVEL_WGSL } from './levelWgsl.ts';
import { DAG_LAST_USE_WGSL } from './lastUseWgsl.ts';
import { DAG_EVICT_WGSL } from './evictWgsl.ts';
import { DAG_FLOOR_WGSL } from './floorWgsl.ts';
import { DAG_PAGES_WGSL } from './pagesWgsl.ts';
import { CASTS_NO_SHADOW, SPRITE_UNCULLED } from '../../../visibility/shader/spriteWgsl.ts';
import { DAG_VIEWS_WGSL, LIST_FULL } from './viewsWgsl.ts';
import { DAG_RECORD_WGSL } from './recordWgsl.ts';
import { DAG_AHEAD_WGSL } from './aheadWgsl.ts';
import { CUT_RULE_WGSL } from '../../../page/cut/rule.ts';
import { DAG_CONE_WGSL } from './coneWgsl.ts';
import { DAG_PRIMITIVE_WGSL } from './primitiveWgsl.ts';
import { FRAME_VEC4 } from '../types.ts';

export const DAG_SELECTION_SHADER = `struct Cluster{sphere:vec4f,parentSphere:vec4f,lodError:f32,parentError:f32,flags:u32,}
struct CullNode{minimum:vec3f,firstChild:u32,maximum:vec3f,maxParentError:f32,sphere:vec4f,worldIndex:u32,firstPage:u32,pageCount:u32,childCount:u32,floorSphere:vec4f,errorFloor:f32,open:u32,pad0:u32,pad1:u32,}
// \`view\`, \`planes\` and \`worlds\` are those of the render frame; \`cameraWorld\` is its origin, which
// the kernel need not read since the camera sits at zero there: it is sent so the block's reader can name it.
// \`perspective\` is the projection's clip-w weight, 1 perspective and 0 orthographic (\`viewPoint\`).
// \`viewFlags\`, \`pageRows\`, \`pageMask\`, \`clipScale\` and \`clipPad\` serve a light cut alone (\`pagesWgsl.ts\`): a camera sends zeros.
// One block per view (\`viewsWgsl.ts\`): block 0 also carries what the views share — counts, caps, flags — and the
// \`view*\` words; \`queueCap\` is the capacity of each descent queue; \`ahead\`, non-zero, says block 1 is the view ahead (\`aheadWgsl.ts\`).
struct Uniforms{planes:array<vec4f,6>,view:mat4x4f,pixelScale:vec2f,pixelError:f32,near:f32,clusterCount:u32,nodeCount:u32,worldCount:u32,residentCut:u32,cameraWorld:vec3f,cameraStretch:f32,listCap:u32,perspective:f32,viewFlags:u32,pageRows:u32,pageMask:vec2<u32>,clipScale:f32,clipPad:f32,viewCount:u32,viewCapacity:u32,queueCap:u32,ahead:u32,}
struct Output{count:atomic<u32>,frustumRejected:atomic<u32>,lodLevel:atomic<u32>,overflow:atomic<u32>,selectedTriangles:atomic<u32>,transparentTriangles:atomic<u32>,reserved:array<u32,2>,pages:array<u32>,}
// The primitives the bound \`frames\` holds (\`../frameRanges.ts\`): a camera or light cut's range.
struct FrameRange{first:u32,count:u32,}
${DAG_BINDINGS_WGSL}
/** A WGSL const-expression may not be infinite, so the unreachable band uses the largest f32:
 *  every comparison below behaves exactly as the CPU cut's Infinity for any finite threshold. */
const INF:f32=3.4e38;
/** Vec4s per slot of \`frames\`: six planes, then the primitive's words (\`../worlds.ts\`). */
const FRAME:u32=${FRAME_VEC4}u;
/** Frustum planes live in the primitive's own space, so no box is ever transformed.
 *  GPU mirror of \`frustumExcludesBox\` (sdk-core, packages/sdk-core/src/math/frustum/box.ts): same corners, same sum.
 *  An infinite far plane is not tested (\`farless\`): it rejects no box. */
fn outsideFrustum(base:u32,bmin:vec3f,bmax:vec3f)->bool{
 let skip=select(6u,FAR_PLANE,farless());
 for(var i=0u;i<6u;i++){if(i!=skip&&outsidePlane(frames[base+i],bmin,bmax)){return true;}}
 return false;
}
/** Rank of the far plane among the six (\`frustum.ts\`: right, left, bottom, top, far, near). */
const FAR_PLANE:u32=4u;
/** True when the view has no far plane: an infinite one reaches the kernel as a NaN plane
 *  (\`frustum.ts\`, zero normal normalized), which no comparison satisfies, and a NaN stays NaN
 *  through \`dagPrepare\`'s product. Read at the bit on the uniform, a NaN test no compiler folds. */
fn farless()->bool{return (bitcast<u32>(views[vi].planes[FAR_PLANE].x)&0x7fffffffu)>0x7f800000u;}
/** View \`v\`'s six planes, brought into a primitive's space by \`m\` (its transposed world), from
 *  \`frames[at]\` on; \`open\`: six planes no box leaves. */
fn putPlanes(at:u32,m:mat4x4f,v:u32,open:bool){for(var i=0u;i<6u;i++){frames[at+i]=select(m*views[v].planes[i],vec4f(0.0,0.0,0.0,1.0),open);}}
/** True when the box lies wholly behind the plane: its corner furthest along the normal is. */
fn outsidePlane(plane:vec4f,bmin:vec3f,bmax:vec3f)->bool{
 let px=select(bmin.x,bmax.x,plane.x>0.0);let py=select(bmin.y,bmax.y,plane.y>0.0);let pz=select(bmin.z,bmax.z,plane.z>0.0);
 return dot(plane.xyz,vec3f(px,py,pz))+plane.w<0.0;
}
/** True on a primitive no camera culls (\`SPRITE_UNCULLED\`). */
fn unculledOf(w:u32)->bool{return (markOf(w)&${SPRITE_UNCULLED}u)!=0u;}
fn visible(r:u32,w:u32,cluster:Cluster)->bool{
 if((cluster.flags&2u)!=0u){return false;}
 return !outsideFrustum(slotOf(w)*FRAME,boxMin(r),boxMax(r))&&!pageMissed(w,boxMin(r),boxMax(r));
}
fn stretchOf(world:u32)->f32{return frames[rowOf(world)*FRAME+6u].x*views[vi].cameraStretch;}
/** Reset and per-primitive planes in a single dispatch: the output counters and block counts
 *  \`dagMask\` accumulates, the frustum planes only the descent reads, and what a camera cut
 *  derives once per primitive (\`primitiveWgsl.ts\`).
 *  One thread per SLOT, view after view (\`viewsWgsl.ts\`): a camera's slot is its primitive. Each
 *  range's dispatch takes its range's slots (\`rangeSlot\`); the first one resets the frame. */
@compute @workgroup_size(64)
fn dagPrepare(@builtin(global_invocation_id) id:vec3u){
 let head=rangeFirst()==0u;let i=id.x;
 if(head&&i==0u){
  // A later batch's cut appends its requests to the frame's list (\`VIEW_APPEND\`): the count and
  // the list-full bit carry on, the other flags are the batch's own.
  if((views[0u].viewFlags&VIEW_APPEND)==0u){atomicStore(&out.count,0u);atomicStore(&out.overflow,0u);}
  else{atomicAnd(&out.overflow,${LIST_FULL}u);}
  atomicStore(&out.frustumRejected,0u);atomicStore(&out.lodLevel,0u);resetTotaux();resetCounters();
 }
 if(head&&i<blockCount()){atomicStore(&work[blockBase()+i],0u);atomicStore(&work[drawMaskBase()+2u*i],0u);atomicStore(&work[drawMaskBase()+2u*i+1u],0u);}
 if(head&&i<views[0u].viewCount){atomicStore(&work[viewWord(0u,i)],0u);atomicStore(&work[viewWord(2u,i)],0u);}
 if(head&&i==0u){atomicStore(&work[drawnGroupsMax()],0u);countFrame();}
 let world=views[0u].worldCount;
 if(i>=rangeCount()*views[0u].viewCount){return;}
 let t=rangeSlot(i);vi=t/world;let w=t-vi*world;let slot=slotOf(w);
 // The primitive's root opens the descent: one thread, one root, no counter to contend for. A
 // light cut opens none on a primitive that casts no shadow (\`markOf\`, \`castsNoShadow\`).
 let root=select(rootOf(w),0xffffffffu,isLightCut()&&(markOf(w)&${CASTS_NO_SHADOW}u)!=0u);
 flags[queueBase(0u)+t]=select(packEntry(vi,root),root,root==0xffffffffu);
 let pose=worlds[w];let m=transpose(pose);let base=slot*FRAME;
 // A primitive a camera never culls (\`unculledOf\`) takes six planes no box leaves.
 let open=!isLightCut()&&unculledOf(w);
 putPlanes(base,m,vi,open);
 if(!isLightCut()){preparePrimitive(w,pose,m,open);}
}
@compute @workgroup_size(64)
fn dagMask(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lid:u32){
 // Totals are summed in the workgroup first (\`totalsWgsl.ts\`), so EVERY thread in the
 // group crosses both barriers: a thread with no cluster does not return early, it does nothing.
 ouvreTotaux(lid);
 let s=id.x;
 if(s<liveCount()){
  let entry=liveAt(s);let i=entryIndex(entry);let w=pageWorld(i);
  // A page of another range's primitive is that range's dispatch's (\`inRange\`).
  if(inRange(w)){
  vi=entryView(entry);let r=recordOf(i,w);
  let clusterFlags=clusters[r].flags;
  var draw=false;
  // The cut rule (\`../../../page/cut/rule.ts\`), on the residency \`../readiness.ts\` derives: a
  // cut without residency holds every cluster and every finer group.
  let word=flags[coneCache(i)];
  if((word&CONE_REJECTED)==0u){
   let all=views[0u].residentCut==0u;
   if(isLightCut()){
    let pixels=clusterPixels(clusters[r],viewWorld(w),stretchOf(w),focalPixels());
    draw=drawsCluster(all||isResident(i),pixels.x,pixels.y,all||childResident(i),views[vi].pixelError);
   }else{
    // Camera cut: the rule on the two comparisons \`dagWanted\` made this frame, on the same
    // projections — no matrix product, no projection, no sphere read again.
    draw=drawsCompared(all||isResident(i),(word&PARENT_ABOVE)!=0u,(word&OWN_WITHIN)!=0u,all||childResident(i));
   }
  }
  noteImage(r,clusterFlags,draw);
  // A light cut keeps no draw flag — two views may draw the same cluster —, only its view's log.
  if(isLightCut()){if(draw){viewDrawnAppend(i);}}
  else{
   let drawn=select(0u,1u,draw);
   flags[views[0u].queueCap+i]=drawn;
   // Drawn count of this page's block, held here rather than reread later page by page.
   if(drawn!=0u){atomicAdd(&work[blockBase()+i/BLOCK],1u);atomicOr(&work[drawMaskWord(i)],drawBit(i));drawnAppend(i);stampUse(i);}
  }
 }}
 verseTotaux(lid);
}
${DAG_CONE_WGSL}
${DAG_PRIMITIVE_WGSL}
${DAG_ERROR_WGSL}
${CUT_RULE_WGSL}
${INVERSE_TRANSPOSE_WGSL}
${DAG_COMPACT_WGSL}${DAG_TOTALS_WGSL}${DAG_REQUEST_WGSL}${DAG_RELEVE_WGSL}${DAG_WANTED_WGSL}
${DAG_LIVE_WGSL}
${DAG_LEVEL_WGSL}
${DAG_LAST_USE_WGSL}${DAG_EVICT_WGSL}
${DAG_FLOOR_WGSL}
${DAG_PAGES_WGSL}
${DAG_VIEWS_WGSL}
${DAG_RECORD_WGSL}
${DAG_AHEAD_WGSL}`;
