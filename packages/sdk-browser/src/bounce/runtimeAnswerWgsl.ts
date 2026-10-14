import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { runtimeRadianceWgsl } from './runtimeRadianceWgsl.ts'
import { sceneKey, type SceneBindings } from './sceneBindings.ts'
import { FRAME_WORK, STORE_BITS, TRACE_LIST } from './runtimeLayout.ts'

/** The bindings of the program that answers a pixel from the store: the proxy's, the trace's list with the
 *  frame's counters and the store of the answers (`runtimeLayout.ts`). */
export type RuntimeBindings = SceneBindings & { list: number; store: number }

/**
 * THE RUN-TIME PROXY'S ANSWER, KEPT FROM IMAGE TO IMAGE: the radiance of a ray (`rtRadiance`), cast by the
 * opaque trace within its frame's budget. What a pixel last got from its ray lives in the store
 * (`runtimeLayout.ts`) under the stamp of the epoch (`follow`) it was cast in, so that a frame that spends its
 * budget (`FRAME_WORK`) leaves the pixels after it their last answer, and the next frames — the trace
 * starts where the last one's budget ended — answer them. The store is the one cache of the proxy's answers.
 *
 * `rtAnswer`, within the frame's budget and from the store: a ray is cast while the frame has spent under
 * `RT_FRAME_WORK` — one a frame at `RT_WORK` at most, and the trace starts at
 * another tile each image (the list's `offset`) —, its work added to the frame's, its answer kept for its
 * pixel under the epoch's stamp. An answer of this epoch is the answer: no ray is cast again for it, whatever
 * budget is left. A ray the budget leaves out answers what its pixel last got, and is counted as left when that
 * answer is older than the epoch: the view settles (`settle.ts`) when none is. A second call for a pixel — the
 * clear coat's lobe — is one ray, kept nowhere. No placement wearing a proxy, no ray: nothing is read or
 * written.
 *
 * The frame's counters are summed over the workgroup and sent once (`rtShare`, called by every invocation of
 * the trace at its end): one global atomic of each a workgroup, never one a pixel — the work spent added, the
 * cursor raised where a base lobe was cast, the left count raised where a pixel was left, which the frame
 * reads as zero or not alone. The budget a ray is checked against is the work the workgroups before it sent,
 * and its pixel's own.
 */
export const runtimeAnswerWgsl = ({ list, store, ...scene }: RuntimeBindings) =>
  wgslBlock(
    `runtimeAnswerWgsl(${sceneKey(scene)}, ${list}, ${store})`,
    [runtimeRadianceWgsl(scene)],
    `
${wgslConsts({
  RT_FRAME_WORK: FRAME_WORK,
  RT_LEFT: TRACE_LIST.left,
  RT_SPENT: TRACE_LIST.spent,
  RT_CURSOR: TRACE_LIST.cursor,
  RT_CONFIDENCE_MAX: 2 ** STORE_BITS.confidence - 1,
  RT_STAMP_SHIFT: STORE_BITS.stamp,
})}
@group(${scene.group}) @binding(${list}) var<storage,read_write> traceList:array<atomic<u32>>;
@group(${scene.group}) @binding(${store}) var rtStore:texture_storage_2d_array<r32uint,read_write>;
/** The pixel the trace is at, the rank of its tile, and the rays it has asked of the proxy for it: the
 *  first is the base lobe's, which keeps its answer in the store (\`rtAnswer\`); a coat's goes without. */
var<private> rtPixel:vec2u;
var<private> rtRank:u32;
var<private> rtCalls:u32;
/** A pixel's cell of the store: its radiance premultiplied by its confidence, its confidence and the stamp of its epoch. */
struct RtCell{premult:vec3f,confidence:f32,stamp:u32,}
/** A radiance on a shared exponent, nine bits a channel (rgb9e5): the pixel's colour in one word. */
fn rtPackShared(c:vec3f)->u32{
 let v=clamp(c,vec3f(0.0),vec3f(65408.0));
 let top=max(v.x,max(v.y,v.z));
 var exponent=max(-16.0,floor(log2(max(top,1e-30))))+16.0;
 var step=exp2(exponent-24.0);
 if(floor(top/step+0.5)>=512.0){exponent+=1.0;step*=2.0;}
 let m=vec3u(floor(v/step+vec3f(0.5)));
 return m.x|(m.y<<9u)|(m.z<<18u)|(u32(exponent)<<27u);
}
fn rtUnpackShared(w:u32)->vec3f{
 let m=vec3f(f32(w&511u),f32((w>>9u)&511u),f32((w>>18u)&511u));
 return m*exp2(f32(w>>27u)-24.0);
}
/** An epoch's stamp on eight bits, never zero: a pixel never answered holds none. */
fn rtStamp(epoch:u32)->u32{return epoch%255u+1u;}
fn rtCellRead(at:vec2u)->RtCell{
 let a=textureLoad(rtStore,at,0u).x;
 let b=textureLoad(rtStore,at,1u).x;
 return RtCell(rtUnpackShared(a),f32(b&RT_CONFIDENCE_MAX)/f32(RT_CONFIDENCE_MAX),b>>RT_STAMP_SHIFT);
}
fn rtCellWrite(at:vec2u,answer:RtRadiance,stamp:u32){
 let c=u32(round(clamp(answer.confidence,0.0,1.0)*f32(RT_CONFIDENCE_MAX)));
 textureStore(rtStore,at,0u,vec4u(rtPackShared(answer.color*answer.confidence),0u,0u,0u));
 textureStore(rtStore,at,1u,vec4u(c|(stamp<<RT_STAMP_SHIFT),0u,0u,0u));
}
/** What a cell answers: the radiance of the share it holds, and that share. */
fn rtCellAnswer(cell:RtCell)->RtRadiance{
 if(!(cell.confidence>0.0)){return RtRadiance(vec3f(0.0),0.0);}
 return RtRadiance(cell.premult/cell.confidence,min(cell.confidence,1.0));
}
/** What this invocation's rays spent of the frame's work, whether its base lobe was cast and kept,
 *  and whether its pixel was left an answer older than the epoch: \`rtShare\` sends them. */
var<private> rtSpentHere:u32;
var<private> rtCastHere:bool;
var<private> rtLeftHere:bool;
/** The workgroup's sums of them: the work, then whether any was cast, then whether any was left. */
var<workgroup> rtGroup:array<atomic<u32>,3>;
fn rtAnswer(origin:vec3f,direction:vec3f,reach:f32,tangent:f32)->RtRadiance{
 if(rtProxy.instances==0u){return RtRadiance(vec3f(0.0),0.0);}
 let first=rtCalls==0u;
 rtCalls++;
 let stamp=rtStamp(reflectionView.runtime.x);
 var cell=RtCell(vec3f(0.0),0.0,0u);
 if(first){
  cell=rtCellRead(rtPixel);
  if(cell.stamp==stamp){return rtCellAnswer(cell);}
 }
 if(atomicLoad(&traceList[RT_SPENT])+rtSpentHere<RT_FRAME_WORK){
  let seen=rtRadiance(origin,direction,reach,tangent);
  rtSpentHere+=rtWork+rtExtra;
  if(first){
   rtCastHere=true;
   rtCellWrite(rtPixel,seen,stamp);
  }
  return seen;
 }
 if(!first){return RtRadiance(vec3f(0.0),0.0);}
 rtLeftHere=true;
 return rtCellAnswer(cell);
}
/** This invocation's counters into the workgroup's sums. */
fn rtGroupAdd(){
 if(rtSpentHere!=0u){atomicAdd(&rtGroup[0],rtSpentHere);}
 if(rtCastHere){atomicOr(&rtGroup[1],1u);}
 if(rtLeftHere){atomicOr(&rtGroup[2],1u);}
}
/** The workgroup's sums into the frame's counters: one atomic of each, from one invocation. */
fn rtGroupSend(){
 let spent=atomicLoad(&rtGroup[0]);
 if(spent!=0u){atomicAdd(&traceList[RT_SPENT],spent);}
 if(atomicLoad(&rtGroup[1])!=0u){atomicMax(&traceList[RT_CURSOR],rtRank+1u);}
 if(atomicLoad(&rtGroup[2])!=0u){atomicAdd(&traceList[RT_LEFT],1u);}
}
/** The workgroup's counters sent once: called by every invocation, in uniform control flow, after
 *  its pixel's last \`rtAnswer\`. */
fn rtShare(lane:u32){
 rtGroupAdd();
 workgroupBarrier();
 if(lane==0u){rtGroupSend();}
}
`,
  )
