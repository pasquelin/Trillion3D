// The run-time proxy's budget and history, the shipped WGSL run as JavaScript: a frame under its budget
// casts the ray and keeps the answer, a frame past it leaves the ray for the next image and answers
// what the pixel last got, and a scene with no proxy touches nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HISTORY, HISTORY_HEADER_WORDS, HISTORY_PIXEL_WORDS } from '../reflections/proxyHistory.ts'
import { FRAME_WORK } from './runtimeLayout.ts'
import { along, ahead, history, origin, runOver } from './runtimeRun.fixture.ts'
import { world } from './runtimeScene.fixture.ts'

test('a frame under its budget casts the ray, adds its work to the frame and keeps the answer for its pixel', () => {
  const w = world(1, 1, { places: along(1, 4), surfaces: [[0, 0, 0, 1, 3, 2, 1, 0]] })
  const kept = history(4, 0)
  const run = runOver(w, kept)
  run.testPixel(2)
  const seen = run.rtAnswer(origin, ahead, 1000, 0.01)
  assert.deepEqual(seen.color, [3, 2, 1])
  assert.equal(seen.confidence, 1)
  assert.equal(kept[HISTORY.spent], run.testWork(), 'its work joins the frame')
  assert.equal(kept[HISTORY.left], 0)
  // The pixel's two words: the colour, and the stamp of the epoch above the confidence.
  const at = HISTORY_HEADER_WORDS + 2 * HISTORY_PIXEL_WORDS
  assert.ok(kept[at] !== 0 && kept[at + 1] >>> 24 === (2 % 255) + 1)
  assert.equal((kept[at + 1] >>> 16) & 255, 255)
})

test('a frame past its budget leaves the ray for the next image: the pixel answers what it last got', () => {
  const w = world(1, 1, { places: along(1, 4), surfaces: [[0, 0, 0, 1, 3, 2, 1, 0]] })
  const kept = history(4, 0)
  // An image that cast it, then a frame whose budget is gone.
  const first = runOver(w, kept)
  first.testPixel(2)
  first.rtAnswer(origin, ahead, 1000, 0.01)
  kept[HISTORY.spent] = FRAME_WORK
  const run = runOver(w, kept)
  run.testPixel(2)
  const again = run.rtAnswer(origin, [-1, 0, 0], 1000, 0.01)
  assert.deepEqual(again.color, [3, 2, 1], 'the last answer, not the ray it was given')
  assert.equal(again.confidence, 1)
  assert.equal(kept[HISTORY.left], 0, 'the answer is of this epoch: nothing is left')
  // The epoch moved (an input of the answers did): the answer is older, and counted as left.
  const later = runOver(w, kept, 3)
  later.testPixel(2)
  later.rtAnswer(origin, ahead, 1000, 0.01)
  assert.equal(kept[HISTORY.left], 1)
  // A pixel never answered holds nothing, and is left too.
  later.testPixel(0)
  assert.equal(later.rtAnswer(origin, ahead, 1000, 0.01).confidence, 0)
  assert.equal(kept[HISTORY.left], 2)
})

test('a second lobe of a pixel keeps no history: past the budget it answers nothing', () => {
  const w = world(1, 1, { places: along(1, 4), surfaces: [[0, 0, 0, 1, 3, 2, 1, 0]] })
  const kept = history(4, FRAME_WORK)
  const run = runOver(w, kept)
  run.testPixel(1)
  run.rtAnswer(origin, ahead, 1000, 0.01)
  const coat = run.rtAnswer(origin, ahead, 1000, 0.01)
  assert.equal(coat.confidence, 0)
  assert.equal(kept[HISTORY.left], 1, 'the base lobe was counted once')
})

test('a scene with no placement wearing a proxy costs nothing: no ray, no word touched', () => {
  const w = world(1, 1, { places: along(1, 4) })
  w.header.instances = 0
  const kept = history(4, 0)
  const run = runOver(w, kept)
  run.testPixel(1)
  assert.equal(run.rtAnswer(origin, ahead, 1000, 0.01).confidence, 0)
  assert.deepEqual(kept, history(4, 0))
  assert.equal(run.testWork(), 0)
})

test('an answer of this epoch is kept: no ray is cast again for it, the frame spends nothing', () => {
  const w = world(1, 1, { places: along(1, 4), surfaces: [[0, 0, 0, 1, 3, 2, 1, 0]] })
  const kept = history(4, 0)
  const first = runOver(w, kept)
  first.testPixel(2)
  first.rtAnswer(origin, ahead, 1000, 0.01)
  const spent = kept[HISTORY.spent]
  const again = runOver(w, kept)
  again.testPixel(2)
  const seen = again.rtAnswer(origin, [-1, 0, 0], 1000, 0.01)
  assert.deepEqual(seen.color, [3, 2, 1], 'the kept answer, not the ray it was given')
  assert.equal(kept[HISTORY.spent], spent, 'nothing spent')
  assert.equal(kept[HISTORY.left], 0)
})
