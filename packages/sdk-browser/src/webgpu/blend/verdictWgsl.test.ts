// The GPU frustum verdict (`verdictWgsl.ts`), its shipped text run in JavaScript (`shaderRun`, the
// `double.ts` contract: every operation the CPU's double), against the item walk
// (`verdict.fixture.ts`) on adversarial scenes: one-ulp straddles, NaN, infinite and signed-zero
// boxes and planes, items with no box, hidden and parked items, paged items the cut emptied.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import type { PlacementOf } from '../../placement/rows.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { BLEND_VERDICT_SHADER, VERDICT_GROUP } from './verdictWgsl.ts'
import { VERDICT, verdictWords } from './verdictLayout.ts'
import { writeKeyRecords } from './keyRecords.ts'
import { orderBlendPasses } from './order.ts'
import { blendSceneOf } from './plan.fixture.ts'
import { blendVerdictCpu } from './verdict.fixture.ts'
import { WATER_RANK_SHIFT } from '../water/rank.ts'
import type { BlendGpuItem, WebgpuBlendState } from './state.ts'

type Kernel = { judgeLane(group: number, lane: number): void; packLane(g: number, l: number): void }

const EDGES = [NaN, Infinity, -Infinity, -0, 0, Number.MAX_VALUE, -Number.MAX_VALUE, 5e-324]

/** The verdict of `blendState` as the kernel computes it, its two barrier halves replayed group
 *  by group over fresh workgroup memory. */
function gpuVerdict(blendState: WebgpuBlendState, counts: number[]) {
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
  }
  scope.verdict[VERDICT.rejected] = scope.verdict[VERDICT.inView] = 0
  const kernel = shaderRun<Kernel>(BLEND_VERDICT_SHADER, ['judgeLane', 'packLane'], scope)
  for (let group = 0; group * VERDICT_GROUP < items; group++) {
    scope.tally[0] = scope.tally[1] = 0
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

/** A box near the frustum's planes, a bound sometimes one ulp across, or a special value. */
function box(next: () => number, edges: boolean) {
  const c = [0, 1, 2].map(() => (next() - 0.5) * 40),
    r = next() * 6
  const bounds = new Float64Array([c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r])
  if (next() < 0.2) {
    // One bound moved onto the axis plane x = 10, or one ulp either side of it.
    const side = next() < 0.5 ? 0 : 3
    bounds[side] = [10 - 2 ** -49, 10, 10 + 2 ** -49][Math.floor(next() * 3)]
  }
  if (edges && next() < 0.1)
    bounds[Math.floor(next() * 6)] = EDGES[Math.floor(next() * EDGES.length)]
  return bounds
}

/** Six planes: an axis box around the origin with one face on x = 10, or random half-spaces. */
function planes(into: Float64Array, next: () => number, edges: boolean) {
  for (let p = 0; p < 6; p++) {
    const axis = p >> 1,
      sign = p & 1 ? -1 : 1
    const tilted = next() < 0.3
    const n = tilted ? [next() - 0.5, next() - 0.5, next() - 0.5] : [0, 0, 0]
    if (!tilted) n[axis] = sign
    into.set([n[0], n[1], n[2], p === 1 ? 10 : 5 + next() * 20], p * 4)
  }
  if (edges && next() < 0.3)
    into[Math.floor(next() * 24)] = EDGES[Math.floor(next() * EDGES.length)]
}

/** A scene of `count` items, its paged ranks and their counts as the compaction left them. */
function scene(count: number, next: () => number, edges: boolean) {
  const items: BlendGpuItem[] = []
  let water = 0
  for (let i = 0; i < count; i++) {
    const transmissive = next() < 0.25
    items.push({
      surface: surfaceOf(G.basicSurface({ side: Math.floor(next() * 3) })),
      matrix: new G.Matrix4().makeTranslation(next() * 50, 0, next() * 50),
      count: 3,
      transmissive,
      flags: transmissive ? ++water << WATER_RANK_SHIFT : 0,
      hidden: next() < 0.1,
      bounds: next() < 0.9 ? box(next, edges) : undefined,
      placement: {
        rows: { live: new Uint8Array([next() < 0.1 ? 0 : 1]) },
        index: 0,
      } as unknown as PlacementOf,
    } as unknown as BlendGpuItem)
  }
  const blendState = blendSceneOf(items)
  blendState.transmissive = water
  planes(blendState.blendPlanes, next, edges)
  // Paged items read the compaction's count at their paged rank: some the cut emptied.
  const counts: number[] = []
  items.forEach((_, i) => {
    if (next() >= 0.5) return
    blendState.drawsPacked[i * 4] = counts.length / 4
    counts.push(0, next() < 0.3 ? 0 : 1 + Math.floor(next() * 9), 0, 0)
  })
  orderBlendPasses(blendState, [0, 0, 0])
  return { blendState, counts }
}

function check(count: number, seed: number, edges: boolean) {
  const { blendState, counts } = scene(count, lcgRandom(seed), edges)
  assert.deepEqual(
    gpuVerdict(blendState, counts),
    blendVerdictCpu(blendState, counts),
    `seed ${seed}, ${count} items`,
  )
}

test('random scenes: keep words, counts and water verdicts are the item walk, word for word', () => {
  for (let seed = 1; seed <= 16; seed++) check(150, seed, false)
})

test('NaN, infinite and signed-zero boxes and planes, one-ulp straddles: the CPU verdict', () => {
  for (let seed = 101; seed <= 124; seed++) check(150, seed, true)
})

test('empty groups and the word edges', () => {
  for (const count of [1, 31, 32, 33, 63, 64, 65, 97]) check(count, 300 + count, true)
})
