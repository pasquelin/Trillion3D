// The render scale stacked six rules (a budget that followed a slower cadence, a probe for a
// faster display, an unseen reserve, a silent-timer path, rest that only lowers, a still image at
// the budget's scale) and still ran 85-93 fps at 120 Hz: a GPU time within its refresh is not a
// frame within it. One controller now learns the GPU cost that meets the refresh from the
// presented intervals and fits the scale to it by the area ratio (`createScaleControl`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createScaleControl } from './scaleControl.ts'
import { fitting, HZ120, simulate } from './scaleFit.fixture.ts'
import { HISTORY } from './scaleTargets.ts'
import {
  createDynamicResolution,
  NO_TIMING,
  recordFrame,
  refreshFraction,
} from './dynamicResolution.ts'
import { DYNAMIC_RESOLUTION_RULES } from '../../../../sdk-core/src/contracts/dynamicResolutionOptions.ts'
import {
  resolveSettings,
  type SettingOptions,
} from '../../../../sdk-core/src/contracts/settingRules.ts'

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

test('a hidden tab: its pause is no frame, and the scale holds', () => {
  const { control, clock, at } = converged()
  clock.now += 5000
  const { scales } = simulate(control, RUN, { gpu: (s) => 10 * s * s, other: () => OTHER }, clock)
  assert.ok(scales.every((s) => s === at))
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

// The cut's edge scale is one more budget of the render scale's heuristic: one history, one change
// period, one reset (`dynamicResolution.ts`); its time is the cut's own, `observe`'s fourth argument.
/** An 'auto' control past its refresh measure, the edge budget 10 ms, and its images: each takes
 *  `ms` on the GPU in all, `edgeMs` for the cut and its raster, drawn at the fractions in force. */
function budgeted() {
  const control = createScaleControl('auto'),
    clock = { now: 0 }
  for (let i = 0; i < 8; i++) {
    control.tick((clock.now += HZ120), true)
    control.hold()
  }
  control.edge.ask(10, 30)
  const image = (edgeMs: number, ms = 1, steered = true) => {
    control.tick((clock.now += HZ120), true)
    control.drew(control.wanted(), true)
    control.observe(ms, control.wanted(), steered, edgeMs)
    return control.edge.now
  }
  return { control, image }
}

test('the edge scale moves as the render scale does, on a linear model, a time not steered left out', () => {
  const { control, image } = budgeted(),
    edge = Array.from({ length: 18 }, () => image(20))
  assert.deepEqual(edge.slice(0, 8), Array(8).fill(1), 'the first time ignored, then 8 images')
  // The budget less its 5 %, over the time, times the fraction in force.
  assert.ok(Math.abs(edge[8] - 9.5 / 20) < 1e-12, `${edge[8]}`)
  assert.equal(edge[15], edge[8], 'and no other change for 8 images')
  assert.equal(edge[17], 0.3, 'never under its lowest')
  assert.equal(control.wanted(), 1, 'the render scale, on its own budget, stays whole')
  assert.equal(control.edge.ask(0, 30), 1, 'a budget of 0 or less: none, what it learnt kept')
  assert.equal(control.edge.ask(10, 30), 0.3)
  const before = image(20, 1, false)
  assert.equal(before, 0.3, 'an image off the controller’s scale is not recorded')
})

test('a time of 0 asks for the most a fraction may be, a time of no timing is left out', () => {
  const lowered = () => {
    const b = budgeted()
    for (let i = 0; i < 9; i++) b.image(20)
    assert.ok(b.control.edge.now < 1)
    return b
  }
  const unmeasured = lowered()
  const low = unmeasured.control.edge.now
  for (let i = 0; i < 12; i++) assert.equal(unmeasured.image(NO_TIMING), low, 'left out')
  const zero = lowered()
  for (let i = 0; i < 12; i++) zero.image(0)
  assert.equal(zero.control.edge.now, 1, 'a time of 0: the most, as the reference gives it')
})

test('over its budget twice in a row, the render scale moves both fractions at once, the edge scale alone waits', () => {
  const alone = budgeted()
  for (let i = 0; i < 4; i++) alone.image(20)
  assert.equal(alone.control.edge.now, 1, 'its own panic waits for the change period')
  const both = budgeted()
  for (let i = 0; i < 4; i++) both.image(20, 40)
  assert.ok(both.control.wanted() < 1 && both.control.edge.now < 1, 'the render scale’s does not')
})

test('a silent timer, another display and other bounds forget both budgets', () => {
  const lowered = () => {
    const b = budgeted()
    for (let i = 0; i < 9; i++) b.image(20, 40)
    assert.ok(b.control.wanted() < 1 && b.control.edge.now < 1)
    return b
  }
  const silent = lowered()
  // The images go on, no GPU time comes: past the history the timer is none.
  for (let i = 0; i <= HISTORY; i++) {
    silent.control.tick(i * HZ120, true)
    silent.control.drew(silent.control.wanted(), true)
  }
  assert.deepEqual([silent.control.wanted(), silent.control.edge.now], [1, 1], 'a silent timer')
  const moved = lowered()
  Object.assign(globalThis, { screen: { width: 2560, height: 1440 }, devicePixelRatio: 1 })
  try {
    moved.control.tick(0, true)
  } finally {
    Reflect.deleteProperty(globalThis, 'screen')
    Reflect.deleteProperty(globalThis, 'devicePixelRatio')
  }
  assert.deepEqual([moved.control.wanted(), moved.control.edge.now], [1, 1], 'another display')
  const bounded = lowered()
  bounded.control.set({ min: 0.5, max: 1 })
  assert.deepEqual([bounded.control.wanted(), bounded.control.edge.now], [1, 1], 'other bounds')
})

test('a fixed render scale has no dynamic resolution: the edge scale stays at 1', () => {
  const control = createScaleControl(1)
  control.edge.ask(10, 30)
  for (let i = 0; i < 40; i++) {
    control.tick(i * HZ120, true)
    control.drew(1, true)
    control.observe(1, 1, true, 20)
  }
  assert.equal(control.edge.ask(10, 30), 1)
})

// The heuristic's settings, each the reference's (`dynamicResolutionOptions.ts`): the numbers are
// those the formulas give by hand, the render scale's budget 10 ms and a fraction of 1.
/** The heuristic after the GPU times `times` (ms, oldest first, at a fraction of 1 and the CPU time
 *  `cpu`), the settings `options` over the reference's defaults, `since` refreshes after its last
 *  change — 8, one allowed now —: its state and the parts the render scale settled on. */
function fitted(
  options: SettingOptions<typeof DYNAMIC_RESOLUTION_RULES>,
  times: number[],
  { cpu = 0, since = 8 } = {},
) {
  const h = createDynamicResolution(),
    f = {
      ...{ s: 1, bounds: { min: 0.5, max: 1 }, edge: 1, edgeBudgetMs: 0, edgeMin: 0.3 },
      rules: resolveSettings(DYNAMIC_RESOLUTION_RULES, options),
      cpuMs: cpu,
    }
  Object.assign(h, { budgetMs: 10, ignore: 0, framesSinceChange: since })
  for (const ms of times) recordFrame(h, f, ms, f.s)
  refreshFraction(h, f)
  return { h, f }
}

test('the headroom leaves the budget free: the target is the budget less it', () => {
  // One frame at 20 ms over a 10 ms budget: over it, the panic gives the ratio at once.
  assert.ok(Math.abs(fitted({}, [20]).f.s - Math.sqrt(9 / 20)) < 1e-12, 'a tenth, the default')
  const none = fitted({ dynamicResolutionHeadroomPercent: 0 }, [20])
  assert.ok(Math.abs(none.f.s - Math.sqrt(10 / 20)) < 1e-12)
  const strict = fitted({ dynamicResolutionOverBudgetHeadroomPercent: 20 }, [9])
  assert.equal(strict.f.s, 1, 'the budget the frame must pass is the one the page gave')
})

test('the frame weight, the history and the frames over budget shape what the browse finds', () => {
  const times = [5, 20, 20] // from the newest: 20, 20, 5
  const mean = (weights: number[]) => {
    const ratio = [20, 20, 5].map((ms) => Math.sqrt(9 / ms))
    let sum = 0,
      total = 0
    weights.forEach((w, i) => ((sum += ratio[i] * w), (total += w)))
    return sum / total
  }
  // Over twice in a row ends the browse (the default 2): the two newest alone, a panic.
  assert.ok(Math.abs(fitted({}, times).f.s - Math.sqrt(9 / 20)) < 1e-12)
  const read = fitted({ dynamicResolutionMaxOverBudgetFrames: 0 }, times).f.s
  assert.equal(read, fitted({}, times).f.s, 'read no lower than 2')
  // Three in a row: the browse goes on past the 5 ms frame, which ends the run of overs.
  const three = fitted({ dynamicResolutionMaxOverBudgetFrames: 3 }, times)
  assert.ok(Math.abs(three.f.s - mean([1, 0.9, 0.81])) < 1e-12, `${three.f.s}`)
  const flat = { dynamicResolutionMaxOverBudgetFrames: 3, dynamicResolutionFrameWeightExponent: 1 }
  assert.ok(Math.abs(fitted(flat, times).f.s - mean([1, 1, 1])) < 1e-12, 'every frame alike')
  const short = { dynamicResolutionMaxOverBudgetFrames: 3, dynamicResolutionHistorySize: 2 }
  assert.ok(Math.abs(fitted(short, times).f.s - Math.sqrt(9 / 20)) < 1e-12, 'two frames kept')
})

test('a history that changes size keeps the newest frames, in their order', () => {
  const { h, f } = fitted({}, [1, 2, 3, 4, 5])
  f.rules.dynamicResolutionHistorySize = 3
  recordFrame(h, f, 6, 1)
  const ring = (back: number) => h.gpuMs[(h.newest - back + h.capacity) % h.capacity]
  assert.deepEqual([h.capacity, h.size, ring(0), ring(1), ring(2)], [3, 3, 6, 5, 4])
  f.rules.dynamicResolutionHistorySize = 5
  recordFrame(h, f, 7, 1)
  assert.deepEqual([h.capacity, h.size, ring(0), ring(1), ring(2), ring(3)], [5, 4, 7, 6, 5, 4])
})

test('the change period, the threshold and the amortization decide how a rise goes', () => {
  // A page that settled at 0.6 whose frames now cost 6 ms: the target asks for 0.6 · √1.5.
  const rise = (options: SettingOptions<typeof DYNAMIC_RESOLUTION_RULES>, since = 8) => {
    const h = createDynamicResolution(),
      f = {
        ...{ s: 0.6, bounds: { min: 0.5, max: 1 }, edge: 1, edgeBudgetMs: 0, edgeMin: 0.3 },
        rules: resolveSettings(DYNAMIC_RESOLUTION_RULES, options),
        cpuMs: 0,
      }
    Object.assign(h, { budgetMs: 10, ignore: 0, framesSinceChange: since })
    recordFrame(h, f, 6, 0.6)
    refreshFraction(h, f)
    return f.s
  }
  const asked = 0.6 * Math.sqrt(9 / 6)
  assert.ok(Math.abs(rise({}) - (0.6 + (asked - 0.6) * 0.9)) < 1e-12, 'nine tenths of the way')
  assert.ok(
    Math.abs(rise({ dynamicResolutionIncreaseAmortization: 1 }) - asked) < 1e-12,
    'all of it',
  )
  assert.equal(rise({ dynamicResolutionIncreaseAmortization: 0 }), 0.6, 'none')
  assert.equal(rise({}, 7), 0.6, 'the period not passed: it waits')
  assert.ok(rise({ dynamicResolutionChangePeriod: 7 }, 7) > 0.6, 'a shorter period')
  assert.equal(rise({ dynamicResolutionChangePercentThreshold: 100 }), 0.6, 'under the threshold')
})

test('the render scale never passes its throttling maximum, and a late CPU excuses a frame the GPU did not make late', () => {
  assert.equal(fitted({ dynamicResolutionThrottlingMaxPercent: 60 }, [1, 1]).f.s, 0.6)
  const low = fitted({ dynamicResolutionThrottlingMaxPercent: 20 }, [1, 1])
  assert.equal(low.f.s, 0.5, 'within the page’s bounds')
  // Too early for a change: only a panic moves the scale at once.
  const early = { since: 0 }
  assert.ok(fitted({}, [20], early).f.s < 1, 'the GPU over its budget: at once')
  const cpu = { dynamicResolutionUseCpuTimeLogic: true }
  assert.equal(fitted(cpu, [20], { ...early, cpu: 20 }).f.s, 1, 'the CPU the cause: it waits')
  assert.ok(fitted(cpu, [20], { ...early, cpu: 2 }).f.s < 1, 'the CPU free: at once')
})

test('a frame time budget the page names replaces the frame cap’s interval', () => {
  const run = (budget: number) => {
    const control = createScaleControl('auto'),
      clock = { now: 0 }
    Object.assign(control.rules, { dynamicResolutionFrameTimeBudgetMs: budget })
    for (let i = 0; i < 8; i++) {
      control.tick((clock.now += HZ120), true)
      control.hold()
    }
    for (let i = 0; i < 3; i++) {
      control.tick((clock.now += HZ120), true)
      control.drew(control.wanted(), true)
      control.observe(20, control.wanted(), true)
    }
    return control.wanted()
  }
  assert.ok(run(0) < 1, '20 ms over the 120 Hz display’s 8.3 ms')
  assert.equal(run(33.3), 1, '20 ms under the 33.3 ms of the reference')
})

test('each GPU time pairs with the edge fraction in force when it is recorded', () => {
  const h = createDynamicResolution(),
    f = {
      ...{ s: 1, bounds: { min: 0.5, max: 1 }, edge: 0.7, edgeBudgetMs: 10, edgeMin: 0.3 },
      rules: resolveSettings(DYNAMIC_RESOLUTION_RULES, {}),
      cpuMs: 3,
    }
  h.ignore = 0
  recordFrame(h, f, 5, 0.9, 4)
  assert.deepEqual([h.fractions[0], h.fractions[16], h.gpuMs[16], h.cpuMs[0]], [0.9, 0.7, 4, 3])
})
