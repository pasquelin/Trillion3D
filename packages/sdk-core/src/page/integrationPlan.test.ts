import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SORT_INSERTION_MAX,
  createPageIntegrationPlan,
  planPageIntegration,
  sortPages,
} from './integrationPlan.ts';

/** Counts the views taken on `pages`: a sort that allocates nothing takes none. */
function countViews(pages: Int32Array) {
  const taken = { views: 0 };
  const subarray = pages.subarray.bind(pages);
  Object.defineProperty(pages, 'subarray', {
    value: (start?: number, end?: number) => {
      taken.views++;
      return subarray(start, end);
    },
  });
  return taken;
}

/** The ranks `0 .. count - 1`, in order. */
const ascending = (count: number) => Array.from({ length: count }, (_, i) => i);

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
  assert.deepEqual([...answer.pages.subarray(0, answer.pageCount)], [0, 3, 7]);
});

test('a standalone page takes its entire pack, including page zero', () => {
  const plan = createPageIntegrationPlan(1);
  planPageIntegration(new Int32Array([-1, 2, 0]), 27, plan);
  assert.equal(plan.count, 1);
  assert.equal(plan.pageCount, 1);
  assert.deepEqual([...plan.slices], [0, 27, 0]);
  assert.deepEqual([...plan.pages], [0]);
});

test('a plan reused for a shorter arrival keeps its buffers and counts the new records', () => {
  const plan = createPageIntegrationPlan(3);
  planPageIntegration(new Int32Array([0, 1, 2, 12, 2, 4, 36, 3, 6]), 18, plan);
  const { slices, pages } = plan;
  planPageIntegration(new Int32Array([8, 4, -1]), 14, plan);
  assert.equal(plan.slices, slices);
  assert.equal(plan.pages, pages);
  assert.equal(plan.count, 1);
  assert.equal(plan.pageCount, 0);
  assert.deepEqual([...slices.subarray(0, 3)], [2, 12, -1]);
  planPageIntegration(new Int32Array(), 0, plan);
  assert.equal(plan.count, 0);
  assert.equal(plan.pageCount, 0);
});

test('an initially empty plan still has room for a later standalone arrival', () => {
  const plan = createPageIntegrationPlan(0);
  assert.equal(plan.count, 0);
  assert.equal(plan.pageCount, 0);
  planPageIntegration(new Int32Array([-1, 1, 5]), 12, plan);
  assert.deepEqual([...plan.slices], [0, 12, 5]);
  assert.deepEqual([...plan.pages], [5]);
});

test('an arrival whose ranks already come in order is not sorted again', () => {
  // Longer than an insertion sort, so a sort would take a view; the first rank is page zero.
  const records = SORT_INSERTION_MAX + 1,
    plan = createPageIntegrationPlan(records),
    specs = new Int32Array(records * 3);
  for (let i = 0; i < records; i++) specs.set([-1, 1, i], i * 3);
  const taken = countViews(plan.pages);
  planPageIntegration(specs, 3, plan);
  assert.equal(taken.views, 0);
  assert.equal(plan.pageCount, records);
  assert.deepEqual([...plan.pages], ascending(records));
});

test('sorting changes only the requested prefix for small and large arrivals', () => {
  for (const count of [0, 1, 2, 8, SORT_INSERTION_MAX, SORT_INSERTION_MAX + 1, 130]) {
    const input = Array.from({ length: count }, (_, i) => ((i * 37) % 131) - 60);
    const pages = new Int32Array([...input, -999, 777]);
    const expected = [...input].sort((a, b) => a - b);
    sortPages(pages, count);
    assert.deepEqual([...pages], [...expected, -999, 777]);
  }
});

test('a list up to the insertion bound is sorted in place, without a view', () => {
  for (const count of [2, SORT_INSERTION_MAX]) {
    const pages = new Int32Array(ascending(count).reverse()),
      taken = countViews(pages);
    sortPages(pages, count);
    assert.equal(taken.views, 0, `${count} ranks`);
    assert.deepEqual([...pages], ascending(count));
  }
});

test('a list past the insertion bound is sorted through one view of its prefix', () => {
  for (const count of [SORT_INSERTION_MAX + 1, 4 * SORT_INSERTION_MAX]) {
    const pages = new Int32Array(ascending(count).reverse()),
      taken = countViews(pages);
    sortPages(pages, count);
    assert.equal(taken.views, 1, `${count} ranks`);
    assert.deepEqual([...pages], ascending(count));
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
