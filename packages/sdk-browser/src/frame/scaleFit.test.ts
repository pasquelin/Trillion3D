// #831: the render scale stacked six rules (a budget that followed a slower cadence, a probe for a
// faster display, an unseen reserve, a silent-timer path, rest that only lowers, a still image at
// the budget's scale) and still ran 85-93 fps at 120 Hz: a GPU time within its refresh is not a
// frame within it. One controller now learns the GPU cost that meets the refresh from the
// presented intervals and fits the scale to it by the area ratio (`createScaleControl`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createScaleControl } from './scaleControl.ts'
import { fitting, HZ120, lowered, simulate } from './scaleFit.fixture.ts'

/** The non-GPU share of every frame, ms: the browser's compositing and the CPU. */
const OTHER = 0.6
/** Frames in a run: five seconds at 120 Hz. */
const RUN = 600

/** The last `n` entries of `list`. */
const tail = <T>(list: T[], n: number) => list.slice(list.length - n)

for (const g of [6, 8, 10, 14]) {
  test(`${g} ms GPU at full scale, 120 Hz: the largest scale that fits one refresh, then held`, () => {
    const control = createScaleControl('auto'),
      { shown, scales } = simulate(control, RUN, { gpu: (s) => g * s * s, other: () => OTHER }),
      fit = fitting(g, OTHER),
      last = tail(scales, 240)
    assert.ok(control.wanted() <= fit + 1e-12, `${control.wanted()} fits ${fit}`)
    // Within the controller's smallest move (2 % of the scale) of the largest that fits.
    assert.ok(control.wanted() >= fit / 1.02 ** 2, `${control.wanted()} near ${fit}`)
    assert.ok(
      tail(shown, 240).every((n) => n === 1),
      'every frame of the last two seconds met the refresh',
    )
    assert.equal(new Set(last).size, 1, 'and the scale never moved there')
  })
}

test('a 2/3 refresh mix at the floor: the clock reads the refresh, the scale stays at the floor', () => {
  const control = createScaleControl('auto'),
    // At the floor, 15 and 18 ms in turn: two refreshes, then three.
    { shown, scales } = simulate(control, RUN, { gpu: (s, f) => (f % 2 ? 60 : 72) * s * s })
  assert.ok(Math.abs(control.refreshMs! - HZ120) < 1e-6, `${control.refreshMs}`)
  assert.deepEqual(new Set(tail(shown, 120)), new Set([2, 3]))
  const floor = scales.indexOf(0.5)
  assert.ok(floor >= 0, 'the floor is reached')
  assert.ok(
    scales.slice(floor).every((s) => s === 0.5),
    'and never left: no slower budget raises it',
  )
})

/** A controller converged on a 10 ms page at 120 Hz, and the clock it ran on. */
function converged() {
  const control = createScaleControl('auto'),
    clock = { now: 0, frame: 0 }
  simulate(control, RUN, { gpu: (s) => 10 * s * s, other: () => OTHER }, clock)
  return { control, clock, at: control.wanted() }
}

test('a lone spike moves nothing', () => {
  const { control, clock, at } = converged(),
    spike = clock.frame + 30
  const { shown, scales } = simulate(
    control,
    RUN,
    { gpu: (s, f) => (f === spike ? 30 : 10 * s * s), other: () => OTHER },
    clock,
  )
  assert.ok(
    scales.every((s) => s === at),
    'the scale held',
  )
  assert.equal(shown.filter((n) => n > 1).length, 1, 'the spike alone missed')
})

test('a scene that gets lighter: the scale rises to the cost it learnt, no frame missed', () => {
  const { control, clock, at } = converged()
  const { shown } = simulate(control, RUN, { gpu: (s) => 7 * s * s, other: () => OTHER }, clock)
  assert.ok(control.wanted() > at, `${control.wanted()} > ${at}`)
  assert.ok(control.wanted() <= fitting(7, OTHER) + 1e-12)
  assert.ok(shown.every((n) => n === 1))
})

test('a scene that gets heavier: the scale drops within the period, then holds', () => {
  const { control, clock, at } = converged()
  const { shown, scales } = simulate(
    control,
    RUN,
    { gpu: (s) => 16 * s * s, other: () => OTHER },
    clock,
  )
  assert.ok(control.wanted() < at)
  assert.ok(
    shown.slice(30).every((n) => n === 1),
    'every frame meets after the drop',
  )
  assert.equal(new Set(tail(scales, 240)).size, 1)
})

test('still images only lower the scale; motion after them takes it up', () => {
  const { control, clock, at } = converged(),
    light = { gpu: (s: number) => 5 * s * s, other: () => OTHER }
  const rest = simulate(control, RUN, { ...light, still: () => true }, clock)
  assert.ok(
    rest.scales.every((s) => s === at),
    'a still average closes at one size',
  )
  simulate(control, RUN, light, clock)
  assert.ok(control.wanted() > at)
})

test('a hidden tab: its pause is no frame, and the scale holds', () => {
  const { control, clock, at } = converged()
  clock.now += 5000
  const { scales } = simulate(control, RUN, { gpu: (s) => 10 * s * s, other: () => OTHER }, clock)
  assert.ok(scales.every((s) => s === at))
})

test('without GPU times the intervals find the largest scale that meets the refresh', () => {
  const control = createScaleControl('auto'),
    { shown, scales } = simulate(control, RUN * 2, {
      gpu: (s) => 10 * s * s,
      other: () => OTHER,
      timed: false,
    }),
    fit = fitting(10, OTHER)
  assert.ok(control.wanted() <= fit + 1e-12, `${control.wanted()} fits ${fit}`)
  assert.ok(control.wanted() >= fit * 0.9, `${control.wanted()} near ${fit}`)
  assert.ok(tail(shown, 240).every((n) => n === 1))
  assert.equal(new Set(tail(scales, 240)).size, 1)
})

test('a fixed scale is never moved', () => {
  const control = createScaleControl(0.75)
  simulate(control, RUN, { gpu: (s) => 20 * s * s, other: () => OTHER })
  assert.equal(control.wanted(), 0.75)
})

// A page heavy from its first frame shows every other refresh: all its intervals read half the
// display's rate. The frames held before its first image measure the display itself.
for (const [hz, g, holds] of [
  [120, 16, 'finds 120 Hz and lowers the scale to fit one refresh'],
  [60, 12, 'keeps 60 Hz and the full scale'],
  [144, 10, 'finds 144 Hz and lowers the scale to fit one refresh'],
] as const) {
  test(`a page heavy from its first frame on a ${hz} Hz display ${holds}`, () => {
    const refresh = 1000 / hz,
      control = createScaleControl('auto'),
      { shown, scales } = simulate(
        control,
        RUN,
        { gpu: (s) => g * s * s, other: () => OTHER },
        undefined,
        refresh,
      ),
      fit = fitting(g, OTHER, 0.5, refresh)
    assert.ok(Math.abs(control.refreshMs! - refresh) < 1e-6, `${control.refreshMs}`)
    assert.ok(shown[0] > 1 || fit === 1, 'its first image missed the refresh')
    assert.ok(control.wanted() <= fit + 1e-12 && control.wanted() >= fit / 1.02 ** 2)
    assert.ok(tail(shown, 240).every((n) => n === 1))
    assert.equal(new Set(tail(scales, 240)).size, 1)
  })
}

test('images timed at no cost take the scale to its maximum', () => {
  const control = createScaleControl('auto'),
    clock = lowered(control, 40)
  assert.ok(control.wanted() < 1)
  simulate(control, RUN, { gpu: () => 0 }, clock)
  assert.equal(control.wanted(), 1)
})

test('a timer dropout keeps what the GPU times taught: their return searches nothing again', () => {
  // A share of 0.2 ms: the search ends above a tenth below the missing cost, a bound only the times taught.
  const page = { gpu: (s: number) => 10 * s * s, other: () => 0.2 },
    control = createScaleControl('auto'),
    clock = { now: 0, frame: 0 }
  simulate(control, RUN, page, clock)
  const at = control.wanted()
  assert.ok(at > Math.sqrt(0.9 * (HZ120 / 10)), `${at}`)
  simulate(control, 60, { ...page, timed: false }, clock)
  const { shown, scales } = simulate(control, RUN, page, clock)
  // The scale the dropout's intervals found fits the bounds the times taught, within the smallest
  // move: kept, never searched again.
  assert.equal(new Set(scales).size, 1, `${new Set(scales).size} scales after the return`)
  assert.ok(Math.abs(scales[0] / at - 1) <= 0.02, `${scales[0]} near ${at}`)
  assert.ok(tail(shown, 240).every((n) => n === 1))
})
