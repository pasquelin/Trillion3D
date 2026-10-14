// The GPU frustum verdict (`verdictWgsl.ts`) run in JavaScript (`shaderRun`): the shipped text,
// its workgroups replayed one after the other, what `verdictWgsl.test.ts` holds to its contract and
// what a fake device dispatches (`tests/kit/gpu/fakeComputeBlend.ts`).
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { BLEND_VERDICT_SHADER, VERDICT_GROUP } from './verdictWgsl.ts'
import { VERDICT, verdictWords } from './verdictLayout.ts'
import { FRAME_HEAD } from './frameHead.ts'
import { writeKeyRecords } from './keyRecords.ts'
import type { WebgpuBlendState } from './state.ts'

type Kernel = {
  judgeLane(group: number, lane: number): void
  packLane(group: number, lane: number): void
}

const NAMES = [
  'judgeLane',
  'packLane',
  'judgeItem',
  'boxExcluded',
  'boundedDouble',
  'frameDouble',
  'keyedDouble',
]

/** The words of the verdict's six bindings (`VERDICT_BINDING`), read and written where they sit. */
type VerdictWords = {
  keyed: ArrayLike<number>
  draws: Uint32Array
  counts: ArrayLike<number>
  frame: ArrayLike<number>
  keep: number[] | Uint32Array
  verdict: number[] | Uint32Array
}

/** The verdict kernel over `words`, the items the frame names, its two barrier steps replayed
 *  group by group over fresh workgroup memory. */
export function runVerdict(words: VerdictWords) {
  const { draws } = words
  const scope = {
    keyed: words.keyed,
    draws: Array.from({ length: draws.length >> 2 }, (_, i) =>
      Array.from(draws.subarray(i * 4, i * 4 + 4)),
    ),
    counts: words.counts,
    frame: words.frame,
    keep: words.keep,
    verdict: words.verdict,
    bits: new Array<number>(VERDICT_GROUP).fill(0),
    tally: [0, 0],
  }
  // The kernel's own functions; the library's are reached on their own.
  const kernel = shaderRun<Kernel>(BLEND_VERDICT_SHADER, NAMES, scope)
  const items = words.frame[FRAME_HEAD.items]
  for (let group = 0; group * VERDICT_GROUP < items; group++) {
    scope.tally[0] = scope.tally[1] = 0
    for (let lane = 0; lane < VERDICT_GROUP; lane++) kernel.judgeLane(group, lane)
    for (let lane = 0; lane < VERDICT_GROUP; lane++) kernel.packLane(group, lane)
  }
}

/** The verdict of `blendState` as the kernel computes it, the compaction's `counts` by paged
 *  rank. */
export function gpuVerdict(blendState: WebgpuBlendState, counts: number[]) {
  const items = blendState.blendGpu.length
  const keep = new Array<number>(bitWords(items)).fill(0xdeadbeef),
    verdict = new Array<number>(verdictWords(blendState.transmissive)).fill(7)
  verdict[VERDICT.rejected] = verdict[VERDICT.inView] = 0
  runVerdict({
    keyed: writeKeyRecords(blendState),
    draws: blendState.drawsPacked,
    counts,
    frame: blendState.frameWords,
    keep,
    verdict,
  })
  const water = VERDICT.waterDraws
  return {
    keep: Uint32Array.from(keep),
    rejected: verdict[VERDICT.rejected],
    inView: verdict[VERDICT.inView],
    waterDraws: Uint32Array.from(verdict.slice(water, water + blendState.transmissive)),
  }
}
