import test from 'node:test'
import assert from 'node:assert/strict'
import { PHYSICS_STEP, POSE_WORDS } from '../../../sdk-core/src/physics/index.ts'
import { createPhysicsPoses } from './poses.ts'
import { along, createStepClock } from './stepClock.ts'
import { records, seated } from './seatedPoses.fixture.ts'

/** Every row the frame drew is finite: a non-finite one stops the renderer ("Invalid matrix"). */
function assertFinite(matrices: Float64Array, label: string) {
  assert.ok(matrices.every(Number.isFinite), `${label}: ${[...matrices.subarray(0, 16)]}`)
}

/** Step `n`'s results for `count` crates rising at 1 m/s: one step, its state before unsent. */
function risen(count: number, n: number) {
  const words = new Uint32Array(2 * count * POSE_WORDS)
  words.set(records(count, 1 + n * PHYSICS_STEP, 1))
  for (let at = 0; at < count * POSE_WORDS; at += POSE_WORDS)
    words[count * POSE_WORDS + at] = ~words[at]
  return words
}

test('a frame clock that steps back draws every body at a finite pose, never behind', () => {
  const { scene, batch, meshes, bodies } = seated(2)
  const poses = createPhysicsPoses(2, scene)
  const clock = createStepClock(PHYSICS_STEP)
  poses.receive(risen(2, 0), 2, bodies, 0)
  let highest = -Infinity,
    delivered = 0
  // A capture's or a test's clock: frames on, then 40 ms back, then still, then on again.
  for (const ms of [16, 16, 16, -40, 0, 16, 16, -8, 16]) {
    clock.frame(ms / 1000)
    poses.apply(bodies, along(clock.drawn, delivered, PHYSICS_STEP, true), true)
    assertFinite(batch.rows.matrices, `a frame ${ms} ms on`)
    assert.ok(meshes[0].position.y >= highest, `never drawn behind: ${meshes[0].position.y}`)
    highest = meshes[0].position.y
    // The worker delivers each frame's steps before the next.
    while (delivered < clock.steps) poses.receive(risen(2, ++delivered), 2, bodies, 1)
  }
})

test('ticks arriving while the frame clock stands still draw every body at a finite pose', () => {
  const { scene, batch, bodies } = seated(1)
  const poses = createPhysicsPoses(1, scene)
  const clock = createStepClock(PHYSICS_STEP)
  clock.frame(0.016)
  // States far past the time drawn, which does not move: drawn at the earliest they bracket.
  for (let n = 1; n < 2500; n++) {
    poses.receive(risen(1, n), 1, bodies, 1)
    clock.frame(0)
    poses.apply(bodies, along(clock.drawn, n, PHYSICS_STEP, true), true)
  }
  assertFinite(batch.rows.matrices, 'still')
  // The clock runs on: the newest state is drawn, then moved on from it while it is late.
  for (let frame = 0; frame < 4; frame++) {
    clock.frame(0.03)
    poses.apply(bodies, along(clock.drawn, 2499, PHYSICS_STEP, true), true)
  }
  assertFinite(batch.rows.matrices, 'running again')
})
