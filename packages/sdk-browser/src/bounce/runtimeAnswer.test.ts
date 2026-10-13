// The run-time proxy's answer to a lobe, the shipped WGSL run as JavaScript: a mirror is one ray kept in the store,
// a rough lobe is the mean of a sample a frame up to its cap, an answer of another epoch is kept as a few samples
// that the new ones replace, a frame past its budget leaves the rays for the next and answers what the pixel
// holds, and a scene with no proxy touches nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FRAME_WORK,
  MIRROR_ALPHA,
  MOTION_COUNT,
  SAMPLE_CAP,
  SCENE_COUNT,
  STORE_BITS,
  TRACE_LIST,
} from './runtimeLayout.ts'
import {
  along,
  ahead,
  counters,
  makeStore,
  origin,
  runOver,
  type Epochs,
} from './runtimeRun.fixture.ts'
import { world, type Vec } from './runtimeScene.fixture.ts'

const normal: Vec = [1, 0, 0]
const lit = () => world(1, 1, { places: along(1, 4), surfaces: [[0, 0, 0, 1, 3, 2, 1, 0]] })
/** The count a pixel's cell holds, of its second word. */
const countOf = (store: ReturnType<typeof makeStore>, x = 2, y = 0) =>
  (store.get([x, y], 1) >>> STORE_BITS.confidence) & 255

/** One frame over `store` at the pixel (2, 0): the counters start again but the schedule's. */
function frame(
  w: ReturnType<typeof lit>,
  list: number[],
  store: ReturnType<typeof makeStore>,
  epochs: Epochs,
  alpha: number,
) {
  list[TRACE_LIST.spent] = 0
  list[TRACE_LIST.left] = 0
  const run = runOver(w, list, epochs, store)
  run.testPixel(2, 0, 0)
  return { run, seen: run.rtLobeAnswer(origin, normal, normal, alpha, 1000, 0.01) }
}

test('a mirror is one ray: its answer is kept in the store, and a frame of the same epoch spends nothing', () => {
  const w = lit(),
    store = makeStore(),
    list = counters(0)
  const first = frame(w, list, store, [2, 2], MIRROR_ALPHA / 4)
  assert.deepEqual(first.seen.color, [3, 2, 1])
  assert.equal(first.seen.confidence, 1)
  assert.equal(list[TRACE_LIST.spent], first.run.testWork(), 'its work joins the frame')
  assert.equal(list[TRACE_LIST.left], 0, 'a mirror holds its one sample')
  assert.equal(countOf(store), 1)
  const spent = list[TRACE_LIST.spent]
  const again = frame(w, list, store, [2, 2], MIRROR_ALPHA / 4)
  assert.deepEqual(again.seen.color, [3, 2, 1])
  assert.equal(list[TRACE_LIST.spent], 0, 'nothing spent again')
  assert.ok(spent > 0)
})

test('a rough lobe is the mean of a sample a frame up to its cap, then costs nothing', () => {
  const w = lit(),
    store = makeStore(),
    list = counters(0),
    alpha = 0.09
  let last = frame(w, list, store, [2, 2], alpha)
  for (let n = 1; n < SAMPLE_CAP; n++) {
    assert.equal(countOf(store), n)
    assert.equal(list[TRACE_LIST.left], 1, 'a pixel under its cap is left')
    last = frame(w, list, store, [2, 2], alpha)
  }
  assert.equal(countOf(store), SAMPLE_CAP)
  assert.equal(list[TRACE_LIST.left], 0, 'at its cap nothing is left')
  // The share of the lobe the cube stops: the mean of many more samples of the same lobe.
  const probe = runOver(lit())
  let held = 0
  const total = 4096
  for (let k = 0; k < total; k++) {
    const u = probe.rtSequence(k, [9, 9])
    const direction = probe.rtSampleLobe(normal, normal, alpha, u)
    if (direction[0] > 0) held += probe.rtRadiance(origin, direction, 1000, 0.01).confidence
  }
  const share = held / total
  assert.ok(share > 0.1 && share < 0.9, `the cube stops a share of the lobe: ${share}`)
  assert.ok(
    Math.abs(last.seen.confidence - share) < 0.1,
    `${last.seen.confidence} against ${share}`,
  )
  // The radiance of the part it holds is the cube's own, whatever the share.
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(last.seen.color[c] - [3, 2, 1][c]) < 0.05)
  const spent = (list[TRACE_LIST.spent] = 0)
  frame(w, list, store, [2, 2], alpha)
  assert.equal(list[TRACE_LIST.spent], spent)
})

test('an answer of another epoch is kept as a mean of a few samples, which the new ones replace', () => {
  const w = lit(),
    store = makeStore(),
    list = counters(0),
    alpha = 0.09
  for (let n = 0; n < SAMPLE_CAP; n++) frame(w, list, store, [2, 2], alpha)
  frame(w, list, store, [2, 3], alpha)
  assert.equal(countOf(store), MOTION_COUNT + 1, 'the view moved: the mean is of few samples')
  frame(w, list, store, [3, 3], alpha)
  assert.equal(countOf(store), SCENE_COUNT + 1, 'the scene changed: fewer still')
  // A mirror of another epoch is cast again: a mean of one sample is the sample.
  const mirror = makeStore(),
    other = counters(0)
  frame(w, other, mirror, [2, 2], 0)
  const stale = frame(w, other, mirror, [2, 3], 0)
  assert.ok(other[TRACE_LIST.spent] > 0, 'cast again')
  assert.equal(stale.seen.confidence, 1)
})

test('a frame past its budget leaves the rays for the next: the pixel answers what it holds', () => {
  const w = lit(),
    store = makeStore(),
    list = counters(0),
    alpha = 0.09
  frame(w, list, store, [2, 2], alpha)
  const held = countOf(store)
  list[TRACE_LIST.spent] = FRAME_WORK
  list[TRACE_LIST.left] = 0
  const run = runOver(w, list, [2, 2], store)
  run.testPixel(2, 0, 0)
  const seen = run.rtLobeAnswer(origin, normal, normal, alpha, 1000, 0.01)
  assert.equal(countOf(store), held, 'no sample added')
  assert.equal(list[TRACE_LIST.left], 1, 'the pixel is left')
  assert.ok(seen.confidence >= 0)
  // A pixel never answered holds nothing, and is left too.
  run.testPixel(0, 1, 0)
  assert.equal(run.rtLobeAnswer(origin, normal, normal, alpha, 1000, 0.01).confidence, 0)
  assert.equal(list[TRACE_LIST.left], 2)
})

test('a second lobe of a pixel keeps nothing: one ray along its centre, none past the budget', () => {
  const w = lit(),
    store = makeStore(),
    list = counters(0)
  const run = runOver(w, list, [2, 2], store)
  run.testPixel(1, 0, 0)
  run.rtLobeAnswer(origin, normal, normal, 0.09, 1000, 0.01)
  const words = store.words.size
  const coat = run.rtLobeAnswer(origin, normal, normal, 0.09, 1000, 0.01)
  assert.deepEqual(coat.color, [3, 2, 1])
  assert.equal(store.words.size, words, 'nothing written')
  list[TRACE_LIST.spent] = FRAME_WORK
  assert.equal(run.rtLobeAnswer(origin, normal, normal, 0.09, 1000, 0.01).confidence, 0)
})

test('a scene with no placement wearing a proxy costs nothing: no ray, no word touched', () => {
  const w = world(1, 1, { places: along(1, 4) })
  w.header.instances = 0
  const store = makeStore(),
    list = counters(0)
  const run = runOver(w, list, [2, 2], store)
  run.testPixel(1, 0, 0)
  assert.equal(run.rtLobeAnswer(origin, normal, normal, 0.09, 1000, 0.01).confidence, 0)
  assert.equal(store.words.size, 0)
  assert.deepEqual(list, counters(0))
  assert.equal(run.testWork(), 0)
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

test('the lobe sampler and its density agree: the share of samples above the surface is the density integrated there', () => {
  const run = runOver(lit()),
    alpha = 0.25,
    view: Vec = [0.6, 0.8, 0]
  let above = 0
  const total = 20000
  for (let k = 0; k < total; k++) {
    const l = run.rtSampleLobe(normal, view, alpha, run.rtSequence(k, [3, 5]))
    assert.ok(Math.abs(Math.hypot(...l) - 1) < 1e-4, 'a unit direction')
    if (l[0] > 0) above++
  }
  // The density over the hemisphere of the normal, by a fine grid of its solid angle.
  let integral = 0
  const steps = 400
  for (let i = 0; i < steps; i++) {
    const cosine = (i + 0.5) / steps,
      sine = Math.sqrt(1 - cosine * cosine)
    for (let j = 0; j < steps; j++) {
      const phi = ((j + 0.5) / steps) * 2 * Math.PI
      integral += run.rtLobePdf(normal, view, alpha, [
        cosine,
        sine * Math.cos(phi),
        sine * Math.sin(phi),
      ])
    }
  }
  integral *= (2 * Math.PI) / (steps * steps)
  assert.ok(Math.abs(above / total - integral) < 0.02, `${above / total} against ${integral}`)
})

void ahead
