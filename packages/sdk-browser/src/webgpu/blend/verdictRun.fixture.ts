// The GPU frustum verdict (`verdictWgsl.ts`) run in JavaScript (`shaderRun`): the shipped text,
// its workgroups replayed one after the other, what `verdictWgsl.test.ts` holds to its contract.
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { BLEND_VERDICT_SHADER, VERDICT_GROUP } from './verdictWgsl.ts'
import { VERDICT, verdictWords } from './verdictLayout.ts'
import { writeKeyRecords } from './keyRecords.ts'
import type { WebgpuBlendState } from './state.ts'

type Kernel = {
  planeLane(lane: number): void
  judgeLane(group: number, lane: number): void
  packLane(group: number, lane: number): void
}

const NAMES = [
  'planeLane',
  'judgeLane',
  'packLane',
  'judgeItem',
  'boxExcluded',
  'boundedDouble',
  'frameDouble',
  'keyedDouble',
]

/** The verdict of `blendState` as the kernel computes it, its three barrier steps replayed group
 *  by group over fresh workgroup memory. */
export function gpuVerdict(blendState: WebgpuBlendState, counts: number[]) {
  const items = blendState.blendGpu.length,
    draws = blendState.drawsPacked
  const scope = {
    keyed: Array.from(writeKeyRecords(blendState)),
    draws: Array.from({ length: items }, (_, i) => Array.from(draws.subarray(i * 4, i * 4 + 4))),
    counts,
    frame: Array.from(blendState.frameWords),
    keep: new Array<number>(bitWords(items)).fill(0xdeadbeef),
    verdict: new Array<number>(verdictWords(blendState.transmissive)).fill(7),
    bits: new Array<number>(VERDICT_GROUP).fill(0),
    tally: [0, 0],
    planes: new Array<number>(24).fill(0),
    planeSides: new Array<number>(6).fill(0),
  }
  scope.verdict[VERDICT.rejected] = scope.verdict[VERDICT.inView] = 0
  // The kernel's own functions; the library's are reached on their own.
  const kernel = shaderRun<Kernel>(BLEND_VERDICT_SHADER, NAMES, scope)
  for (let group = 0; group * VERDICT_GROUP < items; group++) {
    scope.tally[0] = scope.tally[1] = 0
    for (let lane = 0; lane < VERDICT_GROUP; lane++) kernel.planeLane(lane)
    for (let lane = 0; lane < VERDICT_GROUP; lane++) kernel.judgeLane(group, lane)
    for (let lane = 0; lane < VERDICT_GROUP; lane++) kernel.packLane(group, lane)
  }
  const water = VERDICT.waterDraws
  return {
    keep: Uint32Array.from(scope.keep),
    rejected: scope.verdict[VERDICT.rejected],
    inView: scope.verdict[VERDICT.inView],
    waterDraws: Uint32Array.from(scope.verdict.slice(water, water + blendState.transmissive)),
  }
}
