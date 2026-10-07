import test from 'node:test'
import assert from 'node:assert/strict'
import { restartTaaAverage } from './landing.ts'
import { taaRenderMatrix, taaSampledRank, taaSettled } from './frame.ts'
import { runtime } from './frame.fixture.ts'
import { TAA_STILL_FRAMES } from './stillFrames.fixture.ts'
import { TAA_SAMPLES } from './jitter.ts'
import type { TaaInputs } from './inputs.ts'

test("without accumulation this frame, the render matrix is the camera's and composition reads the lit image", () => {
  const { rt, cam, encoded, frame } = runtime()
  rt.capture.capturing = true
  assert.equal(frame(false), null)
  assert.equal(taaRenderMatrix(rt, cam), cam.viewProjection)
  assert.equal(encoded.length, 0)
  rt.capture.capturing = false
  rt.run.diagnostic = 'screen-error' as never
  assert.equal(frame(false), null)
  assert.equal(taaRenderMatrix(rt, cam), cam.viewProjection)
  // With no pass rigged at all, the frame is held.
  rt.gpu.temporal = undefined
  assert.equal(taaSettled(rt), true)
})

test('an accumulated frame advances jitter, writes the uniform and returns the written target', () => {
  const { rt, cam, temporal, encoded, frame, flags } = runtime()
  let u = frame(false)!
  assert.notEqual(taaRenderMatrix(rt, cam), cam.viewProjection, 'the matrix carries the jitter')
  assert.equal(encoded.length, 1)
  assert.equal((encoded[0] as TaaInputs).flags, flags, 'what the as-is share comes from')
  assert.equal(temporal.motion.resets, 1, 'the first frame has no history: poses are taken')
  // Without history, `params.y` is 0; the next frame has it, and nobody moved (`params.z`).
  assert.equal(u[37], 0)
  u = frame(false)!
  assert.equal(u[37], 1)
  assert.equal(u[38], 0)
  assert.deepEqual(temporal.motion.updates, [false], 'unchanged scene: no pose comparison')
  assert.equal(temporal.frame.sample, 2)
  // The nine filter weights sum to one.
  let sum = 0
  for (let k = 0; k < 9; k++) sum += u[40 + k]
  assert.ok(Math.abs(sum - 1) < 1e-5)
  // A scene change makes poses be compared, and a placement that moved is told to the pass.
  rt.run.gate.revisions.scene++
  temporal.motion.moved = true
  u = frame(false)!
  assert.deepEqual(temporal.motion.updates, [false, true])
  assert.equal(u[38], 1)
  frame(false, false)
  assert.equal((encoded.at(-1) as TaaInputs).flags, undefined, 'no as-is pixel, no flags (OMB-11)')
})

test('hold waits for a full cycle of still frames, averaged uniformly from a fixed phase', () => {
  const { rt, temporal, frame } = runtime()
  // Three moving frames: the history's own share (`historyCap`), no uniform one; jitter advances.
  for (let i = 0; i < 3; i++) frame(false)
  assert.equal(temporal.frame.sample, 3)
  assert.equal(frame(false)![36], 0)
  assert.equal(taaSettled(rt), false)
  // First still frame: history is dropped, jitter restarts from zero.
  let u = frame(true)!
  assert.equal(u[37], 0, 'without history: the pass returns the filtered current image')
  assert.equal(temporal.frame.sample, 1, 'phase zero replayed')
  assert.equal(temporal.frame.stillFrames, 1)
  // The following weigh 1/k: the sixteenth gives the uniform average of sixteen frames.
  u = frame(true)!
  assert.equal(u[37], 1)
  assert.equal(Math.fround(u[36]), Math.fround(1 / 2))
  for (let k = 3; k < TAA_STILL_FRAMES; k++) frame(true)
  assert.equal(taaSettled(rt), false, 'one image short of the whole cycles, nothing is held')
  assert.equal(temporal.frame.sample, TAA_SAMPLES - 1, 'the last phase of the cycle is still owed')
  u = frame(true)!
  assert.equal(Math.fround(u[36]), Math.fround(1 / TAA_STILL_FRAMES))
  assert.equal(temporal.frame.sample, 0, 'the images drawn close whole cycles')
  assert.equal(taaSettled(rt), true, 'read before entry: every phase drawn as often, held')
  // Something moves: the count restarts, history stays and mixes at its own share.
  u = frame(false)!
  assert.equal(temporal.frame.stillFrames, 0)
  assert.equal(u[37], 1)
  assert.equal(u[36], 0)
  assert.equal(taaSettled(rt), false)
  // Reallocated targets lose history and the count.
  for (let i = 0; i < TAA_STILL_FRAMES; i++) frame(true)
  assert.equal(taaSettled(rt), true)
  restartTaaAverage(temporal.frame)
  assert.equal(temporal.frame.hasHistory, false)
  assert.equal(taaSettled(rt), false)
})

// A convergence frame — the barrier that re-renders the same pose to show arrived tiles —
// replays the last ordinary frame: same jitter, same stillness, instead of accumulating once more.
test('a convergence frame replays the last ordinary frame instead of advancing jitter', () => {
  const { rt, temporal, frame } = runtime()
  let replayed = 0,
    checkpoints = 0
  temporal.checkpoint = () => {
    checkpoints++
  }
  temporal.replay = () => {
    replayed++
    return true
  }
  frame(false)
  assert.equal(checkpoints, 1, 'an ordinary frame remembers where it started')
  assert.equal(replayed, 0)
  rt.run.textureConverging = true
  frame(false)
  assert.equal(replayed, 1, 'a convergence frame replays')
  assert.equal(checkpoints, 1, 'and remembers nothing new')
  // The replayed stillness is that of the reference frame, not the one the tiles disturbed.
  assert.equal(temporal.frame.stillFrames, 1)
})

// Lighting is sampled on a moving image accumulated on a history, and on no other.
test('the sampled rank: moving accumulated frames only, another each frame, replayed', () => {
  const { rt, temporal, frame } = runtime()
  assert.equal(taaSampledRank(rt), 0, 'before any frame, nothing is sampled')
  frame(false)
  assert.equal(taaSampledRank(rt), 0, 'the first moving frame has no history to average it')
  frame(false)
  const first = taaSampledRank(rt)
  assert.ok(first > 0, 'a moving frame on a history samples')
  rt.run.frame++
  frame(false)
  const second = taaSampledRank(rt)
  assert.notEqual(second, first, 'the next moving frame draws elsewhere')
  frame(true)
  assert.equal(taaSampledRank(rt), 0, 'a still frame shades every light')
  // A convergence frame replays the rank of the moving frame it remakes.
  temporal.replay = () => ((temporal.frame.sampledRank = second), false)
  rt.run.textureConverging = true
  frame(false)
  assert.equal(taaSampledRank(rt), second, 'a replayed frame draws the same lights')
  rt.run.textureConverging = false
  rt.capture.capturing = true
  frame(false)
  assert.equal(taaSampledRank(rt), 0, 'a capture does not accumulate: nothing is sampled')
})
