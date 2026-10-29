import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PT_ROUND_WGSL } from './viewWgsl.ts'

/** The counts of the lists of retried paths, after the count of each bounce. */
export const PT_RETRY_COUNTS = 2

/** The word of the queue the lists begin at, for `levels` bounces. */
export const queueListBase = (levels: number) => levels + PT_RETRY_COUNTS

/** The words of the queue for `levels` bounces and lists of `capacity` paths: the counts, then the two lists a bounce reads and writes and the two of its rounds. */
export const queueWords = (levels: number, capacity: number) => queueListBase(levels) + 4 * capacity

/**
 * THE QUEUE OF PATHS (`ptQueue`, words): the count of the paths each of the bounces is handed by the one before, the counts of the two lists of the paths a surface the ray goes through sends back
 * to its own bounce (`ptView.counts.w - 2` and `- 1`), then the lists of the paths' numbers, `counts.y` long: two a bounce reads one and writes the other (`bounce & 1`), and the two of the
 * rounds that retrace a bounce (`round & 1`). A path's number is its place in the tile, `x + y * width`, and its record is at that place in `ptStates`. The arguments of the indirect dispatch over a bounce's paths are in a buffer of their own
 * (`ptArgsOut`, `argsProgram.ts`, written by a program of its own): a buffer is not an indirect argument and a writable storage binding in the same dispatch.
 *
 * A bounce is run in rounds: round 0 over the paths the bounce before handed it, every later round (`ptView.sampling.z`) over the paths the round before sent back, those whose ray went through a surface that did
 * not cover it and is traced again from the other side in the same bounce, as the reference's loop over the surfaces a ray crosses does; the program declares `ptQueue` and `ptView`.
 */
export const PT_QUEUE_WGSL = wgslBlock(
  'PT_QUEUE_WGSL',
  [PT_ROUND_WGSL],
  `fn ptCountAt(bounce:u32)->u32{return min(bounce,ptView.counts.z);}
fn ptListAt(bounce:u32)->u32{return ptView.counts.w+(min(bounce,ptView.counts.z)&1u)*ptView.counts.y;}
fn ptRetryCountAt(turn:u32)->u32{return ptView.counts.w-2u+(turn&1u);}
fn ptRetryListAt(turn:u32)->u32{return ptView.counts.w+(2u+(turn&1u))*ptView.counts.y;}
fn ptRoundCount(bounce:u32)->u32{
 let turn=ptRound();
 return atomicLoad(&ptQueue[select(ptCountAt(bounce),ptRetryCountAt(turn),turn>0u)]);
}
fn ptRoundList(bounce:u32)->u32{
 let turn=ptRound();
 return select(ptListAt(bounce),ptRetryListAt(turn),turn>0u);
}
fn ptPush(bounce:u32,index:u32){
 let slot=atomicAdd(&ptQueue[ptCountAt(bounce)],1u);
 atomicStore(&ptQueue[ptListAt(bounce)+slot],index);
}
fn ptPushRetry(index:u32){
 let next=ptRound()+1u;
 let slot=atomicAdd(&ptQueue[ptRetryCountAt(next)],1u);
 atomicStore(&ptQueue[ptRetryListAt(next)+slot],index);
}
fn ptFlat(wg:vec3u,n:vec3u,lane:u32)->u32{return (wg.y*n.x+wg.x)*64u+lane;}`,
)
