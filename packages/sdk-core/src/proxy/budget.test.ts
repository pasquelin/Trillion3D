import test from 'node:test'
import assert from 'node:assert/strict'
import { bounceBatchOf, createProxyBudget, type ProxyBudget } from './budget.ts'
import { BOUNCE_SETTINGS } from '../bounce/contracts.ts'

/** A device whose bounce stage takes `fullMs` at full load, and its share of that below. */
function run(budget: ProxyBudget, fullMs: number, frames: number) {
  const loads: number[] = []
  for (let frame = 0; frame < frames; frame++) {
    budget.observe(null, budget.load * fullMs)
    loads.push(budget.load)
  }
  return loads
}

const state = (budget: ProxyBudget) => [budget.load, budget.lastMs, budget.samples]

test('bounceBatchOf rounds the product of ceiling and load to nearest integer', () => {
  assert.equal(bounceBatchOf(100, 0.5), 50)
  assert.equal(bounceBatchOf(10, 0.34), 3)
  assert.equal(bounceBatchOf(10, 0.36), 4)
})

test('bounceBatchOf never returns less than one, even with tiny load on small ceiling', () => {
  assert.equal(bounceBatchOf(1, 0.01), 1)
  assert.equal(bounceBatchOf(4, 0.05), 1)
  assert.equal(bounceBatchOf(0, 1), 1)
})

test('bounceBatchOf clamps to published ceiling when load equals one', () => {
  assert.equal(bounceBatchOf(256, 1), 256)
})

test('a new budget encodes the whole ceiling and has measured nothing', () => {
  const budget = createProxyBudget(1.5)
  assert.deepEqual([budget.budgetMs, ...state(budget)], [1.5, 1, null, 0])
})

test('a missing, zero, negative or infinite budget falls back to the published one', () => {
  const published = createProxyBudget(BOUNCE_SETTINGS.budgetMs)
  run(published, 3 * BOUNCE_SETTINGS.budgetMs, 5)
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    const fallback = createProxyBudget(invalid)
    assert.equal(fallback.budgetMs, BOUNCE_SETTINGS.budgetMs, `${invalid}`)
    run(fallback, 3 * BOUNCE_SETTINGS.budgetMs, 5)
    assert.equal(fallback.load, published.load, `${invalid}`)
  }
})

test('a stage without a usable timestamp leaves the budget as it was', () => {
  const budget = createProxyBudget(1)
  budget.observe(null, 2)
  const before = state(budget)
  assert.deepEqual(before.slice(1), [2, 1])
  for (const value of [null, 0, -1, NaN, Infinity, -Infinity]) budget.observe(null, value)
  assert.deepEqual(state(budget), before)
})

test('an overloaded device settles on the load that fills the budget, smoothly and from above', () => {
  const budget = createProxyBudget(2)
  const loads = run(budget, 8, 120)
  assert.ok(loads[0] < 1 && loads[0] > 0.25, `one frame closes part of the gap: ${loads[0]}`)
  for (let frame = 1; frame < loads.length; frame++) {
    assert.ok(loads[frame] <= loads[frame - 1], `never rises: ${loads}`)
    assert.ok(loads[frame] >= 0.25, `never overshoots the load that fits: ${loads[frame]}`)
  }
  assert.ok(Math.abs(loads.at(-1)! - 0.25) < 1e-9, `${loads.at(-1)}`)
  assert.equal(budget.samples, 120)
  assert.equal(budget.lastMs, loads.at(-2)! * 8)
})

test('a lighter frame lets the load recover gradually, never above the full ceiling', () => {
  const budget = createProxyBudget(2)
  run(budget, 8, 120)
  const loads = run(budget, 1, 120)
  assert.ok(loads[0] > 0.25 && loads[0] < 0.5, `one frame recovers part of the way: ${loads[0]}`)
  for (let frame = 1; frame < loads.length; frame++) {
    assert.ok(loads[frame] >= loads[frame - 1], `never falls: ${loads}`)
    assert.ok(loads[frame] <= 1)
  }
  assert.ok(1 - loads.at(-1)! < 1e-9, `${loads.at(-1)}`)
  const fast = createProxyBudget(2)
  fast.observe(null, 1)
  assert.equal(fast.load, 1, 'a device under budget at full load stays at full load')
})

test('sustained overload holds the progress floor, and a spike beyond it weighs no more', () => {
  const budget = createProxyBudget(1)
  for (let frame = 0; frame < 300; frame++) {
    budget.observe(null, 1e6)
    assert.ok(budget.load >= BOUNCE_SETTINGS.budgetFloor, `${budget.load}`)
  }
  assert.ok(budget.load - BOUNCE_SETTINGS.budgetFloor < 1e-12, `${budget.load}`)
  assert.ok(bounceBatchOf(1000, budget.load) > 1, 'the floor still encodes work')
  // Two spikes that both ask for less than the floor lower the load by the same step.
  const large = createProxyBudget(1),
    huge = createProxyBudget(1)
  large.observe(null, 1 / (BOUNCE_SETTINGS.budgetFloor / 2))
  huge.observe(null, 1e6)
  assert.equal(large.load, huge.load)
  assert.ok(large.load < 1)
})

test('the reflections take the share first, the probes what they leave', () => {
  const budget = createProxyBudget(2)
  // The reflections took 1.5 ms of 2: the probes, at full load for 1 ms, aim at 0.5.
  for (let frame = 0; frame < 120; frame++) budget.observe(1.5, budget.load * 1)
  assert.ok(Math.abs(budget.load - 0.5) < 1e-6, `${budget.load}`)
  // Reflections past the share leave the probes their floor, never nothing.
  for (let frame = 0; frame < 300; frame++) budget.observe(5, budget.load * 1)
  assert.ok(Math.abs(budget.load - 2 * BOUNCE_SETTINGS.budgetFloor) < 1e-6, `${budget.load}`)
})

test("the reflection rays' units follow the device's own rate, three times faster or slower", () => {
  for (const factor of [3, 1 / 3]) {
    const budget = createProxyBudget(2)
    const prior = budget.units / 2
    const rate = prior * factor
    // Each frame the reflections spend their whole cap at the device's rate.
    for (let sample = 0; sample < 10; sample++) {
      const units = budget.units
      budget.spent(units)
      budget.observe(units / rate, null)
    }
    const wanted = rate * 2
    assert.ok(Math.abs(budget.units - wanted) / wanted < 0.1, `${budget.units} for ${wanted}`)
  }
})

test('a frame that spent nothing, or an unmeasured pass, leaves the units as they were', () => {
  const budget = createProxyBudget(2)
  const units = budget.units
  for (const ms of [null, 0, -1, NaN, Infinity]) budget.observe(ms, null)
  budget.observe(1, null)
  assert.equal(budget.units, units, 'no units read back yet')
  budget.spent(0)
  budget.spent(NaN)
  budget.observe(1, null)
  assert.equal(budget.units, units)
})
