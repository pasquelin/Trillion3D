import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { PT_TRACE_BINDINGS } from './traceProgram.ts'
import { PT_QUEUE_WGSL } from './queueWgsl.ts'
import { PT_STEPS, PT_VIEW_WGSL } from './viewWgsl.ts'

/** The bindings of the arguments program: group 0 holds the parameters (read at the dynamic offset of the dispatch) and the queue, group 1 the arguments it writes. */
export const PT_ARGS_BINDINGS = {
  view: PT_TRACE_BINDINGS.view,
  queue: PT_TRACE_BINDINGS.queue,
  out: 0,
} as const

export const PT_ARGS_ENTRY = 'ptArgs'

/**
 * THE ARGUMENTS OF THE DISPATCH OVER A BOUNCE'S PATHS (`ptArgs`): the groups that hold the count of paths the bounce before handed this one (`ptView.flags.w` is the bounce, the bounces past the compaction depth go on over the list of the last compacted one; `ptView.sampling.z` is the round, the later rounds go over the paths the round before sent back), as the x and y of an indirect dispatch, at the place of the round. It also empties the list of retried paths the round fills.
 * A program of its own, over the two buffers it reads and writes alone, so that it binds two storage buffers where the bounces bind eight.
 */
export const PT_ARGS_WGSL = wgslProgram(
  `@group(0) @binding(${PT_ARGS_BINDINGS.view}) var<uniform> ptView:PtView;
@group(0) @binding(${PT_ARGS_BINDINGS.queue}) var<storage,read_write> ptQueue:array<atomic<u32>>;
@group(1) @binding(${PT_ARGS_BINDINGS.out}) var<storage,read_write> ptArgsOut:array<u32>;
@compute @workgroup_size(1,1,1)
fn ${PT_ARGS_ENTRY}(){
 let bounce=ptView.flags.w;
 let turn=ptRound();
 let step=bounce*${PT_STEPS}u+turn;
 let groups=(ptRoundCount(bounce)+63u)/64u;
 ptArgsOut[3u*step]=min(groups,65535u);
 ptArgsOut[3u*step+1u]=max((groups+65534u)/65535u,1u);
 ptArgsOut[3u*step+2u]=1u;
 // The list this round sends paths back to is empty when it begins: the round that read it is over.
 atomicStore(&ptQueue[ptRetryCountAt(turn+1u)],0u);
}`,
  [PT_VIEW_WGSL, PT_QUEUE_WGSL],
)
