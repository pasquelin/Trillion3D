import assert from 'node:assert/strict';
import test from 'node:test';
import { createPageIntegrationPlan, planPageIntegration, sortPages } from './integrationPlan.ts';

test('a packed arrival preserves its record order and reports sorted catalogue pages', () => {
  const plan = createPageIntegrationPlan(4);
  plan.slices.fill(-77);
  plan.pages.fill(-77);
  const answer = planPageIntegration(
    new Int32Array([24, 2, 7, 0, 3, 0, 60, 1, -1, 36, 2, 3]),
    18,
    plan,
  );
  assert.equal(answer, plan);
  assert.equal(answer.count, 4);
  assert.equal(answer.pageCount, 3);
  assert.deepEqual([...answer.slices], [6, 6, 7, 0, 9, 0, 15, 3, -1, 9, 6, 3]);
  assert.deepEqual([...answer.pages], [0, 3, 7, -77]);
});

test('a standalone page takes its entire pack, including page zero', () => {
  const plan = createPageIntegrationPlan(1);
  planPageIntegration(new Int32Array([-1, 2, 0]), 27, plan);
  assert.equal(plan.count, 1);
  assert.equal(plan.pageCount, 1);
  assert.deepEqual([...plan.slices], [0, 27, 0]);
  assert.deepEqual([...plan.pages], [0]);
});

test('reusing buffers for a shorter arrival resets counts without overwriting unused room', () => {
  const plan = createPageIntegrationPlan(3);
  planPageIntegration(new Int32Array([0, 1, 2, 12, 2, 4, 36, 3, 6]), 18, plan);
  const slices = plan.slices;
  const pages = plan.pages;
  planPageIntegration(new Int32Array([8, 4, -1]), 14, plan);
  assert.equal(plan.slices, slices);
  assert.equal(plan.pages, pages);
  assert.equal(plan.count, 1);
  assert.equal(plan.pageCount, 0);
  assert.deepEqual([...slices], [2, 12, -1, 3, 6, 4, 9, 9, 6]);
  assert.deepEqual([...pages], [2, 4, 6]);
  planPageIntegration(new Int32Array(), 0, plan);
  assert.equal(plan.count, 0);
  assert.equal(plan.pageCount, 0);
  assert.deepEqual([...slices], [2, 12, -1, 3, 6, 4, 9, 9, 6]);
});

test('an initially empty plan still has room for a later standalone arrival', () => {
  const plan = createPageIntegrationPlan(0);
  assert.equal(plan.count, 0);
  assert.equal(plan.pageCount, 0);
  planPageIntegration(new Int32Array([-1, 1, 5]), 12, plan);
  assert.deepEqual([...plan.slices], [0, 12, 5]);
  assert.deepEqual([...plan.pages], [5]);
});

test('sorting changes only the requested prefix for small and large arrivals', () => {
  for (const count of [0, 1, 2, 8, 64, 65, 130]) {
    const input = Array.from({ length: count }, (_, i) => ((i * 37) % 131) - 60);
    const pages = new Int32Array([...input, -999, 777]);
    const expected = [...input].sort((a, b) => a - b);
    sortPages(pages, count);
    assert.deepEqual([...pages], [...expected, -999, 777]);
  }
});

test('sorting preserves repeated ranks and already ordered lists', () => {
  for (const input of [
    [5, 3, 5, 0, 3],
    [-2, -1, 0, 1],
    [8, 7, 6, 5],
  ]) {
    const pages = new Int32Array(input);
    sortPages(pages, pages.length);
    assert.deepEqual(
      [...pages],
      [...input].sort((a, b) => a - b),
    );
  }
});
