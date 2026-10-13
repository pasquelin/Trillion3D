// The run-time proxy's budget and store, the shipped WGSL run as JavaScript: a frame under its budget casts the ray
// and keeps the answer, a frame past it leaves the ray for the next image and answers what the pixel last got, and a
// scene with no proxy touches nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FRAME_WORK, STORE_BITS, TRACE_LIST } from './runtimeLayout.ts'
import { along, ahead, counters, makeStore, origin, runOver } from './runtimeRun.fixture.ts'
import { world, type Vec } from './runtimeScene.fixture.ts'

const lit = () => world(1, 1, { places: along(1, 4), surfaces: [[0, 0, 0, 1, 3, 2, 1, 0]] })

test('a frame under its budget casts the ray, adds its work to the frame and keeps the answer for its pixel', () => {
  const w = lit(),
    list = counters(0),
    store = makeStore()
  const run = runOver(w, list, 2, store)
  run.testPixel(2, 0, 0)
  const seen = run.rtAnswer(origin, ahead, 1000, 0.01)
  assert.deepEqual(seen.color, [3, 2, 1])
  assert.equal(seen.confidence, 1)
  assert.equal(list[TRACE_LIST.spent], run.testWork(), 'its work joins the frame')
  assert.equal(list[TRACE_LIST.left], 0)
  // The pixel's two words: the colour, and the stamp of the epoch above the confidence.
  assert.ok(store.get([2, 0], 0) !== 0)
  assert.equal(store.get([2, 0], 1) >>> STORE_BITS.stamp, (2 % 255) + 1)
  assert.equal(
    store.get([2, 0], 1) & (2 ** STORE_BITS.confidence - 1),
    2 ** STORE_BITS.confidence - 1,
  )
})

test('a frame past its budget leaves the ray for the next image: the pixel answers what it last got', () => {
  const w = lit(),
    list = counters(0),
    store = makeStore()
  // An image that cast it, then a frame whose budget is gone.
  const first = runOver(w, list, 2, store)
  first.testPixel(2, 0, 0)
  first.rtAnswer(origin, ahead, 1000, 0.01)
  list[TRACE_LIST.spent] = FRAME_WORK
  const run = runOver(w, list, 2, store)
  run.testPixel(2, 0, 0)
  const again = run.rtAnswer(origin, [-1, 0, 0], 1000, 0.01)
  assert.deepEqual(again.color, [3, 2, 1], 'the last answer, not the ray it was given')
  assert.equal(again.confidence, 1)
  assert.equal(list[TRACE_LIST.left], 0, 'the answer is of this epoch: nothing is left')
  // The epoch moved (an input of the answers did): the answer is older, and counted as left.
  const later = runOver(w, list, 3, store)
  later.testPixel(2, 0, 0)
  later.rtAnswer(origin, ahead, 1000, 0.01)
  assert.equal(list[TRACE_LIST.left], 1)
  // A pixel never answered holds nothing, and is left too.
  later.testPixel(0, 1, 0)
  assert.equal(later.rtAnswer(origin, ahead, 1000, 0.01).confidence, 0)
  assert.equal(list[TRACE_LIST.left], 2)
})

test('a second lobe of a pixel keeps nothing: past the budget it answers nothing', () => {
  const w = lit(),
    list = counters(FRAME_WORK),
    store = makeStore()
  const run = runOver(w, list, 2, store)
  run.testPixel(1, 0, 0)
  run.rtAnswer(origin, ahead, 1000, 0.01)
  const coat = run.rtAnswer(origin, ahead, 1000, 0.01)
  assert.equal(coat.confidence, 0)
  assert.equal(list[TRACE_LIST.left], 1, 'the base lobe was counted once')
  assert.equal(store.words.size, 0, 'nothing written')
})

test('a scene with no placement wearing a proxy costs nothing: no ray, no word touched', () => {
  const w = world(1, 1, { places: along(1, 4) })
  w.header.instances = 0
  const list = counters(0),
    store = makeStore()
  const run = runOver(w, list, 2, store)
  run.testPixel(1, 0, 0)
  assert.equal(run.rtAnswer(origin, ahead, 1000, 0.01).confidence, 0)
  assert.equal(store.words.size, 0)
  assert.deepEqual(list, counters(0))
  assert.equal(run.testWork(), 0)
})

test('an answer of this epoch is kept: no ray is cast again for it, the frame spends nothing', () => {
  const w = lit(),
    list = counters(0),
    store = makeStore()
  const first = runOver(w, list, 2, store)
  first.testPixel(2, 0, 0)
  first.rtAnswer(origin, ahead, 1000, 0.01)
  const spent = list[TRACE_LIST.spent]
  const again = runOver(w, list, 2, store)
  again.testPixel(2, 0, 0)
  const seen = again.rtAnswer(origin, [-1, 0, 0], 1000, 0.01)
  assert.deepEqual(seen.color, [3, 2, 1], 'the kept answer, not the ray it was given')
  assert.equal(list[TRACE_LIST.spent], spent, 'nothing spent')
  assert.equal(list[TRACE_LIST.left], 0)
})

test('a radiance on a shared exponent keeps nine bits of its largest channel', () => {
  const run = runOver(lit())
  for (const c of [
    [0.5, 3, 40],
    [0, 0, 0],
    [1e-3, 2e-3, 1e-3],
    [60000, 1, 0.5],
  ] as Vec[]) {
    const back = run.rtUnpackShared(run.rtPackShared(c))
    const largest = Math.max(...c)
    for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(back[k] - c[k]) <= largest / 512 + 1e-30, `${c} → ${back}`)
  }
})
