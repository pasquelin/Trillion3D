// The world's time on the display's grid (`worldFrameGrid.ts`), through the world's own frames
// (`worldFrames.ts`): each frame stepped at its timestamp, then drawn with the display's refresh the
// scale control published. In Node the frame's timestamp is `performance.now()` (`frameStart`).
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createWorldFrames, NOT_DRAWN } from './worldFrames.ts'

const P120 = 1000 / 120,
  P60 = 1000 / 60

let seed = 7
/** A number in [-1, 1), the same sequence at every run. */
const noise = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), seed / 2 ** 31 - 1)

/** A world's frames on a mocked clock: `frame(at, refresh)` steps the frame at `at` ms, draws it
 *  with the scale control's `refresh` (null: none known), and returns the seconds stepped. */
function world(t: TestContext) {
  const clock = { now: 0 }
  t.mock.method(performance, 'now', () => clock.now)
  const frames = createWorldFrames(),
    scene = new Object3D(),
    told: { delta: number; time: number }[] = []
  frames.add(({ delta, time }) => told.push({ delta, time }))
  const frame = (at: number, refresh: number | null) => {
    clock.now = at
    const seconds = frames.advance()
    frames.dispatch({ ...NOT_DRAWN, displayRefreshMs: refresh })
    return seconds
  }
  return { clock, frames, scene, told, frame }
}

test('jittered timestamps of a 120 Hz display advance by exactly one period, two where one dropped', (t) => {
  const { frame, told } = world(t)
  const deltas: number[] = [],
    dropped = new Set<number>()
  let k = 0
  for (let f = 0; f < 600; f++) {
    // A display frame dropped now and then: the next image is shown two refreshes later.
    if (f % 37 === 36) {
      k++
      dropped.add(f)
    }
    // Timestamps 0.2 ms off the grid either way; the refresh as the clock's fit reads it.
    const at = 1000 + k++ * P120 + 0.2 * noise()
    deltas.push(frame(at, P120 * (1 + 2e-6 * noise())))
  }
  const steady = deltas.slice(10),
    one = steady.find((d, i) => !dropped.has(i + 10))!
  assert.ok(Math.abs((one * 1000) / P120 - 1) <= 2e-6, `one period ${one}`)
  steady.forEach((d, i) =>
    assert.ok(Object.is(d, dropped.has(i + 10) ? 2 * one : one), `frame ${i + 10}: ${d}`),
  )
  // The hooks are told what was integrated, at times as far apart as the deltas.
  told.forEach(({ delta }, i) => assert.ok(Object.is(delta, deltas[i])))
  for (let i = 11; i < told.length; i++)
    assert.ok(Math.abs(told[i].time - told[i - 1].time - told[i].delta) < 1e-9)
})

test('a variable-refresh display presenting off the grid advances by its own intervals', (t) => {
  const { frame } = world(t)
  // Intervals between one and two refreshes of a locked 120 Hz clock, each a fifth of a period or
  // more off any whole number of it: what a display presenting when a frame is ready shows.
  const intervals = [10.1, 11.9, 13.4, 9.7, 14.6]
  let at = 1000,
    previous = at
  frame(at, P120)
  for (let f = 0; f < 200; f++) {
    at += intervals[f % intervals.length] + 0.01 * noise()
    const seconds = frame(at, P120)
    assert.ok(Object.is(seconds, (at - previous) / 1000), `frame ${f}: ${seconds}`)
    previous = at
  }
})

test('a pause advances two periods once, and no frame after it catches up', (t) => {
  const { frame, told } = world(t)
  let at = 1000
  const deltas: number[] = []
  for (let f = 0; f < 20; f++) deltas.push(frame((at += P120), P120))
  const one = deltas.at(-1)!
  assert.ok(Object.is(deltas.at(-2), one))
  const before = told.at(-1)!.time
  // Five seconds of a hidden tab, or of a still scene the loop slept through.
  at += 5000
  assert.ok(Object.is(frame(at, P120), 2 * one), 'the pause spans two periods')
  assert.ok(Math.abs(told.at(-1)!.time - before - 5) < 1e-9, "the world's time is the wall's")
  const after: number[] = []
  for (let f = 0; f < 20; f++) after.push(frame((at += P120 + 0.1 * noise()), P120))
  // The grid restarted at the pause: a few frames on their own timestamps, then on it again.
  for (const seconds of after) assert.ok(seconds < 1.05 * one, `no catch-up: ${seconds}`)
  for (const seconds of after.slice(5)) assert.ok(Object.is(seconds, one))
})

test('a refresh change restarts the grid, and 10 000 frames never drift from the wall', (t) => {
  for (const unknownBetween of [30, 0]) {
    const { frame } = world(t)
    const first = 1000
    let at = first,
      integrated = 0,
      snapped = 0,
      worst = 0,
      previous = Number.NaN
    frame(at, null)
    for (let f = 1; f < 10_000; f++) {
      const sixty = f >= 5000,
        period = sixty ? P60 : P120
      at += period + 0.1 * noise()
      // The clock's fit, a hair off and moving each frame; a new display knows none for a while.
      const refresh = sixty && f < 5000 + unknownBetween ? null : period * (1 + 1e-4 * noise())
      const seconds = frame(at, refresh)
      integrated += seconds
      // A delta that repeats the last: what the animation worker samples ahead at.
      if (Object.is(seconds, previous)) snapped++
      previous = seconds
      // What the world integrated is the wall's time since the first frame, within the grid's
      // tolerance at any frame: the error never grows.
      worst = Math.max(worst, Math.abs(integrated * 1000 - (at - first)))
    }
    t.diagnostic(
      `refresh unknown ${unknownBetween} frames: worst ${worst.toFixed(3)} ms, ` +
        `${snapped} of 9999 frames repeat the last delta`,
    )
    assert.ok(worst <= 0.1 * P60 + 0.2, `drift ${worst} ms`)
    assert.ok(snapped > 0.98 * 9999, `snapped ${snapped}`)
  }
})

test('a display frame stepped again advances nothing, and its frame is told the period once', (t) => {
  const { frames, frame, clock, scene, told } = world(t)
  let at = 1000
  for (let f = 0; f < 10; f++) frame((at += P120), P120)
  const one = told.at(-1)!.delta,
    time = told.at(-1)!.time
  // The page's own `render()` and the loop in one display frame; a still frame stepped again.
  clock.now = at += P120
  assert.ok(Object.is(frames.advance(), one))
  assert.equal(frames.step(null, scene), false)
  clock.now = at + 0.3
  assert.equal(frames.advance(), 0)
  frames.dispatch({ ...NOT_DRAWN, displayRefreshMs: P120 })
  assert.ok(Object.is(told.at(-1)!.delta, one))
  assert.ok(Math.abs(told.at(-1)!.time - time - one) < 1e-9)
  // The next display frame is one period on, not two.
  assert.ok(Object.is(frame(at + P120, P120), one))
})
