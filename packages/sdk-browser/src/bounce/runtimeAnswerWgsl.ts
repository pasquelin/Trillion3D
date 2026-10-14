import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { runtimeRadianceWgsl } from './runtimeRadianceWgsl.ts'
import { runtimeHistoryWgsl } from './runtimeHistoryWgsl.ts'
import { sceneKey, type SceneBindings } from './sceneBindings.ts'
import { FRAME_WORK, REFRESH_WORK, TRACE_LIST } from './runtimeLayout.ts'

/** The bindings of the program that answers a pixel from the store: the proxy's, the trace's list with the
 *  frame's counters and the store of the answers (`runtimeLayout.ts`). */
export type RuntimeBindings = SceneBindings & { list: number; store: number }

/**
 * THE RUN-TIME PROXY'S ANSWER, KEPT FROM IMAGE TO IMAGE: the radiance of a ray (`rtRadiance`), cast by the
 * opaque trace within its frame's budget. What a surface last got from its ray lives in the store
 * (`runtimeLayout.ts`) under the stamp of the epoch (`follow`) it was cast in, so that a frame that spends its
 * budget (`FRAME_WORK`) leaves the pixels after it their surface's history (`rtHistory`), and the next frames
 * — the trace starts where the last one's budget ended — answer them. The store is the one cache of the
 * proxy's answers.
 *
 * `rtAnswer(P, N, …)`, for the surface at `P` of normal `N` — the pixel's opaque one or its transparents'
 * front one (`rtLayer`), each its own cells and its own history —, within the frame's budget and from the store: an
 * answer of this epoch in the pixel's own cell is the answer, no ray is cast again for it. Else a ray is
 * cast while the frame has spent under its budget — `RT_FRAME_WORK` in a still view, `RT_REFRESH_WORK` in a
 * moving one for a pixel whose surface holds a history, the rest of the budget kept for the holes, cast
 * first —, its work added to the frame's, its answer written in the pixel's cell under the epoch's stamp. A
 * pixel the budget leaves out answers its surface's history, a hole nothing — the chain's next stage
 * answers it —, never another surface's answer; it is counted as left: the view settles (`settle.ts`) when
 * none is. A moving image writes the history it answered in the pixel's cell of the set it writes, under
 * the surface's key, its stamp kept: an answer is never thrown away for the view's move. A second call for
 * a pixel — the clear coat's lobe — is one ray, kept nowhere. No placement wearing a proxy, no ray: nothing
 * is read or written.
 *
 * The frame's counters are summed over the workgroup and sent once (`rtShare`, called by every invocation of
 * the trace at its end): one global atomic of each a workgroup, never one a pixel — the work spent added, the
 * cursor raised where a base lobe was cast in turn (a hole's ray leaves the schedule where it was), the
 * left count raised where a pixel was left, which the frame reads as zero or not alone. The budget a ray
 * is checked against is the work the workgroups before it sent, and its pixel's own.
 */
/** What names a fragment of a program over `runtime`, the bindings it answers the proxy from: none
 *  without (a program with no proxy's stage). */
export const runtimeKey = (runtime?: RuntimeBindings) =>
  runtime ? `${sceneKey(runtime)}, ${runtime.list}, ${runtime.store}` : 'none'

export const runtimeAnswerWgsl = (runtime: RuntimeBindings) =>
  wgslBlock(
    `runtimeAnswerWgsl(${runtimeKey(runtime)})`,
    [runtimeRadianceWgsl(runtime), runtimeHistoryWgsl(runtime.group, runtime.store)],
    `
${wgslConsts({
  RT_FRAME_WORK: FRAME_WORK,
  RT_REFRESH_WORK: REFRESH_WORK,
  RT_LEFT: TRACE_LIST.left,
  RT_SPENT: TRACE_LIST.spent,
  RT_CURSOR: TRACE_LIST.cursor,
})}
@group(${runtime.group}) @binding(${runtime.list}) var<storage,read_write> traceList:array<atomic<u32>>;
/** The pixel the trace is at, the rank of its tile, and the rays it has asked of the proxy for it: the
 *  first is the base lobe's, which keeps its answer in the store (\`rtAnswer\`); a coat's goes without. */
var<private> rtPixel:vec2u;
var<private> rtRank:u32;
var<private> rtCalls:u32;
/** What this invocation's rays spent of the frame's work, whether its base lobe was cast in turn,
 *  and whether its pixel was left an answer older than the epoch: \`rtShare\` sends them. */
var<private> rtSpentHere:u32;
var<private> rtCastHere:bool;
var<private> rtLeftHere:bool;
/** The workgroup's sums of them: the work, then whether any was cast, then whether any was left. */
var<workgroup> rtGroup:array<atomic<u32>,3>;
/** The base lobe's ray, cast: its answer written in the pixel's cell of the set the image writes. A ray
 *  of the schedule (\`turn\`) moves its cursor on; a hole's, cast out of turn, does not. */
fn rtCast(P:vec3f,N:vec3f,origin:vec3f,direction:vec3f,reach:f32,tangent:f32,stamp:u32,turn:bool)->RtRadiance{
 let seen=rtRadiance(origin,direction,reach,tangent);
 rtSpentHere+=rtWork+rtExtra;
 rtCastHere=rtCastHere||turn;
 rtCellWrite(rtPixel,rtWriteSet(),seen,stamp,N,rtKeyDepth(P),rtFirst);
 return seen;
}
/** A moving image's history of the pixel's surface, kept in its cell of the set the image writes. */
fn rtKeep(held:RtCell,P:vec3f,N:vec3f){
 if(held.stamp==0u){rtHoleWrite(rtPixel,rtWriteSet());return;}
 rtCellPut(rtPixel,rtWriteSet(),held.color,held.share,held.stamp,N,rtKeyDepth(P),held.distance);
}
fn rtAnswer(P:vec3f,N:vec3f,origin:vec3f,direction:vec3f,reach:f32,tangent:f32)->RtRadiance{
 if(rtProxy.instances==0u){return RtRadiance(vec3f(0.0),0.0);}
 let first=rtCalls==0u;
 rtCalls++;
 let spent=atomicLoad(&traceList[RT_SPENT])+rtSpentHere;
 if(!first){
  if(spent>=RT_FRAME_WORK){return RtRadiance(vec3f(0.0),0.0);}
  let seen=rtRadiance(origin,direction,reach,tangent);
  rtSpentHere+=rtWork+rtExtra;
  return seen;
 }
 let stamp=rtStamp(reflectionView.runtime.x);
 let still=reflectionView.runtime.w==RT_IN_PLACE;
 var own=rtNone();
 if(still){
  own=rtCellRead(rtPixel,rtReadSet());
  if(own.stamp==stamp){return rtCellAnswer(own);}
 }
 if(spent<select(RT_REFRESH_WORK,RT_FRAME_WORK,still)){return rtCast(P,N,origin,direction,reach,tangent,stamp,true);}
 let held=rtHistory(own,P,N,tangent);
 if(held.stamp==0u&&spent<RT_FRAME_WORK){return rtCast(P,N,origin,direction,reach,tangent,stamp,false);}
 rtLeftHere=true;
 if(!still){rtKeep(held,P,N);}
 return rtCellAnswer(held);
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
