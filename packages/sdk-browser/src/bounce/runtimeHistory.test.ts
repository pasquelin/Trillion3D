// The history a pixel the frame's budget leaves out answers, the shipped WGSL run as JavaScript: its surface's
// answer where the image before saw it, kept in the set the moving image writes, never another surface's answer,
// and the holes cast first from the budget a moving image keeps for them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FRAME_WORK, REFRESH_WORK, STORE_BITS, STORE_MODE, TRACE_LIST } from './runtimeLayout.ts'
import { along, ahead, counters, origin, runOver } from './runtimeRun.fixture.ts'
import { facing, makeStore, point, type Store } from './runtimeStore.fixture.ts'
import { world } from './runtimeScene.fixture.ts'

const lit = () => world(1, 1, { places: along(1, 4), surfaces: [[0, 0, 0, 1, 3, 2, 1, 0]] })
/** The words of an image that moved: epoch 3, reading the set from layer 0, writing the one from 3. */
const MOVED = [3, 0, 3, STORE_MODE.reproject]
const stampOf = (store: Store, at: number[], layer: number) =>
  store.get(at, layer) >>> STORE_BITS.stamp

/** A store whose pixel (2, 0) — where the image before saw `point` — holds the answer of epoch 2. */
function castAtTwo(w: ReturnType<typeof lit>, store: Store) {
  const first = runOver(w, counters(0), 2, store)
  first.testPixel(2, 0, 0)
  first.rtAnswer(point, facing, origin, ahead, 1000, 0.01)
  first.testShare()
}

test('a moving image answers a left pixel from where the image before saw its surface, and keeps it', () => {
  const w = lit(),
    store = makeStore()
  castAtTwo(w, store)
  // The view moved: the surface is at pixel (1, 0) now, and the budget is spent.
  const list = counters(FRAME_WORK)
  const run = runOver(w, list, MOVED, store)
  run.testPixel(1, 0, 0)
  const seen = run.rtAnswer(point, facing, origin, [-1, 0, 0], 1000, 0.01)
  run.testShare()
  assert.deepEqual(seen.color, [3, 2, 1], "the surface's answer, not the pixel's own cell")
  assert.equal(seen.confidence, 1)
  assert.equal(list[TRACE_LIST.left], 1, 'older than the epoch: left for a later image')
  assert.equal(
    store.get([1, 0], 3),
    store.get([2, 0], 0),
    'its colour kept whole in the set written',
  )
  assert.equal(stampOf(store, [1, 0], 4), (2 % 255) + 1, 'under the stamp it was cast at')
  assert.equal(store.get([1, 0], 1), 0, 'the set read is not written')
})

test("a cell of another surface is no history: the pixel left answers nothing, never the other's answer", () => {
  const w = lit(),
    store = makeStore()
  castAtTwo(w, store)
  // A still view whose epoch moved: the pixel now shows a surface facing along x.
  const run = runOver(w, counters(FRAME_WORK), 3, store)
  run.testPixel(2, 0, 0)
  const seen = run.rtAnswer(point, [1, 0, 0], origin, ahead, 1000, 0.01)
  assert.equal(seen.confidence, 0, 'a hole: the next stage answers it')
  // Moving, the cell where the image before saw the point holds a surface facing the eye.
  const moved = runOver(w, counters(FRAME_WORK), MOVED, store)
  moved.testPixel(1, 0, 0)
  const turned = moved.rtAnswer(point, [1, 0, 0], origin, ahead, 1000, 0.01)
  assert.equal(turned.confidence, 0)
  assert.equal(stampOf(store, [1, 0], 4), 0, 'a hole kept as one')
})

test('a moving image keeps a quarter of its budget for the holes, cast out of turn', () => {
  const w = lit(),
    store = makeStore()
  castAtTwo(w, store)
  const list = counters(REFRESH_WORK)
  const run = runOver(w, list, MOVED, store)
  // A pixel whose surface holds a history waits for its turn past the refresh's share.
  run.testPixel(1, 0, 0)
  run.testReset()
  run.rtAnswer(point, facing, origin, ahead, 1000, 0.01)
  run.testShare()
  assert.equal(list[TRACE_LIST.spent], REFRESH_WORK, 'no ray for a history')
  // A hole is cast, and the schedule stays where it was.
  run.testPixel(3, 3, 5)
  run.testReset()
  const hole = run.rtAnswer([0.5, -0.75, 0.5], facing, origin, ahead, 1000, 0.01)
  run.testShare()
  assert.deepEqual(hole.color, [3, 2, 1])
  assert.ok(list[TRACE_LIST.spent] > REFRESH_WORK, 'the hole cast')
  assert.equal(list[TRACE_LIST.cursor], 0, 'the cursor is the schedule’s')
  assert.equal(stampOf(store, [3, 3], 4), (3 % 255) + 1)
})
