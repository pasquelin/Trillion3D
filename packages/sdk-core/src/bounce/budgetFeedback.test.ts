import test from 'node:test';
import assert from 'node:assert/strict';
import { createBounceBudget, bounceBatchOf } from './budget.ts';

test('GPU feedback reduces work smoothly and records only usable timestamp samples', () => {
  const budget = createBounceBudget(1);
  assert.deepEqual([budget.budgetMs, budget.load, budget.lastMs, budget.samples], [1, 1, null, 0]);
  budget.observe(2);
  assert.deepEqual([budget.load, budget.lastMs, budget.samples], [0.875, 2, 1]);
  for (const value of [null, 0, -1, NaN, Infinity, -Infinity]) budget.observe(value);
  assert.deepEqual([budget.load, budget.lastMs, budget.samples], [0.875, 2, 1]);
  budget.observe(0.1);
  assert.deepEqual([budget.load, budget.lastMs, budget.samples], [0.90625, 0.1, 2]);
  assert.equal(bounceBatchOf(1000, budget.load), 906);
});

test('pressure keeps a nonzero convergence floor and recovery never exceeds the ceiling', () => {
  const budget = createBounceBudget(1);
  for (let i = 0; i < 200; i++) budget.observe(1e6);
  assert.ok(Math.abs(budget.load - 0.02) < 1e-12);
  assert.equal(budget.samples, 200);
  assert.equal(bounceBatchOf(1000, budget.load), 20);
  for (let i = 0; i < 200; i++) budget.observe(1e-6);
  assert.ok(budget.load <= 1 && budget.load > 0.999999);
  const fast = createBounceBudget(2);
  fast.observe(1);
  assert.equal(fast.load, 1);
  for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
    const fallback = createBounceBudget(invalid);
    assert.equal(fallback.budgetMs, 0.8);
    fallback.observe(1.6);
    assert.equal(fallback.load, 0.875);
  }
});
