import test from 'node:test';
import assert from 'node:assert/strict';
import { bounceBatchOf, createBounceBudget, type BounceBudget } from './budget.ts';
import { BOUNCE_SETTINGS } from './contracts.ts';

/** A device whose bounce stage takes `fullMs` at full load, and its share of that below. */
function run(budget: BounceBudget, fullMs: number, frames: number) {
  const loads: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    budget.observe(budget.load * fullMs);
    loads.push(budget.load);
  }
  return loads;
}

const state = (budget: BounceBudget) => [budget.load, budget.lastMs, budget.samples];

test('bounceBatchOf rounds the product of ceiling and load to nearest integer', () => {
  assert.equal(bounceBatchOf(100, 0.5), 50);
  assert.equal(bounceBatchOf(10, 0.34), 3);
  assert.equal(bounceBatchOf(10, 0.36), 4);
});

test('bounceBatchOf never returns less than one, even with tiny load on small ceiling', () => {
  assert.equal(bounceBatchOf(1, 0.01), 1);
  assert.equal(bounceBatchOf(4, 0.05), 1);
  assert.equal(bounceBatchOf(0, 1), 1);
});

test('bounceBatchOf clamps to published ceiling when load equals one', () => {
  assert.equal(bounceBatchOf(256, 1), 256);
});

test('a new budget encodes the whole ceiling and has measured nothing', () => {
  const budget = createBounceBudget(1.5);
  assert.deepEqual([budget.budgetMs, ...state(budget)], [1.5, 1, null, 0]);
});

test('a missing, zero, negative or infinite budget falls back to the published one', () => {
  const published = createBounceBudget(BOUNCE_SETTINGS.budgetMs);
  run(published, 3 * BOUNCE_SETTINGS.budgetMs, 5);
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    const fallback = createBounceBudget(invalid);
    assert.equal(fallback.budgetMs, BOUNCE_SETTINGS.budgetMs, `${invalid}`);
    run(fallback, 3 * BOUNCE_SETTINGS.budgetMs, 5);
    assert.equal(fallback.load, published.load, `${invalid}`);
  }
});

test('a stage without a usable timestamp leaves the budget as it was', () => {
  const budget = createBounceBudget(1);
  budget.observe(2);
  const before = state(budget);
  assert.deepEqual(before.slice(1), [2, 1]);
  for (const value of [null, 0, -1, NaN, Infinity, -Infinity]) budget.observe(value);
  assert.deepEqual(state(budget), before);
});

test('an overloaded device settles on the load that fills the budget, smoothly and from above', () => {
  const budget = createBounceBudget(2);
  const loads = run(budget, 8, 120);
  assert.ok(loads[0] < 1 && loads[0] > 0.25, `one frame closes part of the gap: ${loads[0]}`);
  for (let frame = 1; frame < loads.length; frame++) {
    assert.ok(loads[frame] <= loads[frame - 1], `never rises: ${loads}`);
    assert.ok(loads[frame] >= 0.25, `never overshoots the load that fits: ${loads[frame]}`);
  }
  assert.ok(Math.abs(loads.at(-1)! - 0.25) < 1e-9, `${loads.at(-1)}`);
  assert.equal(budget.samples, 120);
  assert.equal(budget.lastMs, loads.at(-2)! * 8);
});

test('a lighter frame lets the load recover gradually, never above the full ceiling', () => {
  const budget = createBounceBudget(2);
  run(budget, 8, 120);
  const loads = run(budget, 1, 120);
  assert.ok(loads[0] > 0.25 && loads[0] < 0.5, `one frame recovers part of the way: ${loads[0]}`);
  for (let frame = 1; frame < loads.length; frame++) {
    assert.ok(loads[frame] >= loads[frame - 1], `never falls: ${loads}`);
    assert.ok(loads[frame] <= 1);
  }
  assert.ok(1 - loads.at(-1)! < 1e-9, `${loads.at(-1)}`);
  const fast = createBounceBudget(2);
  fast.observe(1);
  assert.equal(fast.load, 1, 'a device under budget at full load stays at full load');
});

test('sustained overload holds the progress floor, and a spike beyond it weighs no more', () => {
  const budget = createBounceBudget(1);
  for (let frame = 0; frame < 300; frame++) {
    budget.observe(1e6);
    assert.ok(budget.load >= BOUNCE_SETTINGS.budgetFloor, `${budget.load}`);
  }
  assert.ok(budget.load - BOUNCE_SETTINGS.budgetFloor < 1e-12, `${budget.load}`);
  assert.ok(bounceBatchOf(1000, budget.load) > 1, 'the floor still encodes work');
  // Two spikes that both ask for less than the floor lower the load by the same step.
  const large = createBounceBudget(1),
    huge = createBounceBudget(1);
  large.observe(1 / (BOUNCE_SETTINGS.budgetFloor / 2));
  huge.observe(1e6);
  assert.equal(large.load, huge.load);
  assert.ok(large.load < 1);
});
