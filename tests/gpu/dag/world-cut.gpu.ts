// The world DAG and the placements it stands in for, cut by the WGSL kernel itself: on every frame
// — objects placed or not, super-roots held or not, the world top always — every object is drawn
// exactly once, by its placement or its world group, wherever either is whole: placed, or every
// root of the world above it held. Never twice, never a part.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  objectCovers,
  worldScene,
  type WorldScene,
} from '../../../packages/sdk-browser/src/gpu/dag/worldScene.fixture.ts'
import { evaluateDagSelectionKernel } from '../../../packages/sdk-browser/src/gpu/dag/oracle/oracle.fixture.ts'
import { ruleResidency } from '../../../packages/sdk-browser/src/gpu/dag/readiness.fixture.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { runSelectionKernel } from './selectionKernel.ts'

const FRAMES = 24

/** The roots of the world above object `u` of `s`: the clusters nothing replaces, reached through
 *  the groups replacing its world cluster. */
function rootsAbove(s: WorldScene, u: number) {
  const st = s.world.structure,
    found = new Set<number>()
  const climb = (rank: number) => {
    if (st.owners[rank] < 0) return void found.add(rank)
    const g = st.owners[rank]
    for (let i = st.outputOffsets[g]; i < st.outputOffsets[g + 1]; i++) climb(st.outputs[i])
  }
  climb(s.packed.world!.clusterOf[u])
  return [...found]
}

/** A frame's residency: the objects `placed` (each its cluster, its world object with it), the
 *  super-roots `held`, the world top always. */
function residentOf(s: WorldScene, placed: boolean[], held: boolean[]) {
  const resident = new Uint8Array(s.packed.pageCount)
  placed.forEach((on, u) => on && (resident[u] = resident[s.base + u] = 1))
  for (let rank = s.world.leaves; rank < s.world.pages.length; rank++)
    resident[s.base + rank] = rank === s.world.pages.length - 1 || held[rank] ? 1 : 0
  return resident
}

test('the kernel draws every object exactly once, by its placement or its world group', async () => {
  let lone = 0
  const next = lcgRandom(1473)
  const frames = Array.from({ length: FRAMES }, (_, frame) => {
    const s = worldScene(frame % 4)
    const threshold = 0.05 * 2 ** (next() * 12)
    const placed = Array.from({ length: s.world.leaves }, () => next() < 0.8)
    const held = s.world.pages.map(() => next() < 0.7)
    return { s, uniforms: cameraSelectionUniforms(s.cam, threshold, [1280, 720]), placed, held }
  })
  const { readings } = await runSelectionKernel(
    frames.map(({ s, uniforms, placed, held }, frame) => ({
      name: `frame ${frame}`,
      packed: s.packed,
      uniforms,
      resident: residentOf(s, placed, held),
    })),
  )
  frames.forEach(({ s, uniforms, placed, held }, frame) => {
    const drawn = readings[frame].drawn,
      resident = residentOf(s, placed, held)
    const model = evaluateDagSelectionKernel(s.packed, uniforms, ruleResidency(s.packed, resident))
    const whole = placed.map((on, u) =>
      on || rootsAbove(s, u).every((rank) => resident[s.base + rank]) ? 1 : 0,
    )
    lone += whole.filter((on, u) => !on).length
    assert.deepEqual(
      objectCovers(s, drawn),
      whole,
      `frame ${frame}: drawn ${drawn}, model ${model.drawablePageIds}`,
    )
  })
  // The frames reach the case the rule is for: an object neither placed nor stood in for.
  assert.ok(lone > 0)
})
