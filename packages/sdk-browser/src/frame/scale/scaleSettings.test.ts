// The dynamic resolution's settings, each the reference's (`dynamicResolutionOptions.ts`) with its
// default: the heuristic reads them at each GPU time (`dynamicResolution.ts`), the page's frame
// time budget replaces the frame cap's interval, and a time pairs with the edge fraction in force.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createScaleControl } from './scaleControl.ts'
import { HZ120 } from './scaleFit.fixture.ts'
import { createDynamicResolution, recordFrame, refreshFraction } from './dynamicResolution.ts'
import { DYNAMIC_RESOLUTION_RULES } from '../../../../sdk-core/src/contracts/dynamicResolutionOptions.ts'
import {
  resolveSettings,
  type SettingOptions,
} from '../../../../sdk-core/src/contracts/settingRules.ts'

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
  assert.equal(
    createDynamicResolution().capacity,
    DYNAMIC_RESOLUTION_RULES.dynamicResolutionHistorySize.default,
    'a new history holds what the rule defaults to',
  )
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

test('a frame time budget the page names replaces the frame cap’s interval; the over-budget headroom shortens it', () => {
  const run = (budget: number, late = 0, gpuMs = 20) => {
    const control = createScaleControl('auto'),
      clock = { now: 0 }
    Object.assign(control.rules, {
      dynamicResolutionFrameTimeBudgetMs: budget,
      dynamicResolutionOverBudgetHeadroomPercent: late,
    })
    for (let i = 0; i < 8; i++) {
      control.tick((clock.now += HZ120), true)
      control.hold()
    }
    for (let i = 0; i < 3; i++) {
      control.tick((clock.now += HZ120), true)
      control.drew(control.wanted(), true)
      control.observe(gpuMs, control.wanted(), true)
    }
    return control.wanted()
  }
  assert.ok(run(0) < 1, '20 ms over the 120 Hz display’s 8.3 ms')
  assert.equal(run(33.3), 1, '20 ms under the 33.3 ms of the reference')
  // 28 ms under 33.3 ms; over the 26.6 ms a headroom of a fifth leaves of it.
  assert.equal(run(33.3, 0, 28), 1, 'under the whole budget')
  assert.ok(run(33.3, 20, 28) < 1, 'over the budget less its over-budget headroom')
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
