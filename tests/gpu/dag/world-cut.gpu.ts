// The world HLOD and the placements of its HLOD 0 cells, cut by the WGSL kernel itself: on every
// frame, each cell in the word the host chose (`CELL_DRAW`, `worldFollow.ts`), every object is
// drawn exactly once — by its placement while its cell draws its placements, by its actor while
// its cell draws it — and not at all where its word draws neither.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  objectCovers,
  worldScene,
  type WorldScene,
} from '../../../packages/sdk-browser/src/geometry/dag/worlds/worldScene.fixture.ts'
import { evaluateDagSelectionKernel } from '../../../packages/sdk-browser/src/geometry/dag/oracle/oracle.fixture.ts'
import { ruleResidency } from '../../../packages/sdk-browser/src/geometry/dag/readiness.fixture.ts'
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { CELL_DRAW } from '../../../packages/sdk-browser/src/geometry/dag/worlds/worldLinks.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { runSelectionKernel } from './selectionKernel.ts'

const FRAMES = 24

/** `states` written for the world of `s`, one per HLOD 0 cell, and the residency the host waits
 *  for before choosing them: a cell drawing its placements has its placement resident, one drawing
 *  its HLOD every world page of its cell. */
function frameOf(s: WorldScene, states: readonly number[]) {
  const world = s.packed.world!,
    cold = new Uint32Array(s.packed.coldWords.buffer)
  world.states.set(states)
  cold.set(world.states, world.stateBase)
  const resident = new Uint8Array(s.packed.pageCount)
  states.forEach((state, u) => {
    if (state & CELL_DRAW.placements) resident[u] = 1
    if (state & CELL_DRAW.hlod)
      s.world.pages.forEach((_, rank) => world.hlod[rank] === u && (resident[s.base + rank] = 1))
  })
  return resident
}

test('the kernel draws every object exactly once, by the representation its cell chose', async () => {
  const next = lcgRandom(1473),
    // Its placements, its actor, nothing.
    choices = [CELL_DRAW.placements, CELL_DRAW.hlod, 0]
  const frames = Array.from({ length: FRAMES }, () => {
    const s = worldScene()
    const threshold = 0.01 * 2 ** (next() * 8)
    const states = Array.from(
      { length: s.world.leaves },
      () => choices[Math.floor(next() * choices.length)],
    )
    const resident = frameOf(s, states)
    return { s, uniforms: cameraSelectionUniforms(s.cam, threshold, [1280, 720]), states, resident }
  })
  const { readings } = await runSelectionKernel(
    frames.map(({ s, uniforms, resident }, frame) => ({
      name: `frame ${frame}`,
      packed: s.packed,
      uniforms,
      resident,
    })),
  )
  frames.forEach(({ s, uniforms, states, resident }, frame) => {
    const drawn = readings[frame].drawn
    const model = evaluateDagSelectionKernel(s.packed, uniforms, ruleResidency(s.packed, resident))
    const once = states.map((state) => (state & (CELL_DRAW.placements | CELL_DRAW.hlod) ? 1 : 0))
    assert.deepEqual(
      objectCovers(s, drawn),
      once,
      `frame ${frame}: drawn ${drawn}, model ${model.drawablePageIds}`,
    )
  })
})
