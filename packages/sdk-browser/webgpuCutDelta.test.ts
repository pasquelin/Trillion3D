import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from './pageSelection.ts';
import { createCutDelta } from './webgpuCutDelta.ts';

const pageOf = (id: number, url = `p${id}`) => ({ id, url, level: 0 }) as unknown as PageRec;
const listOf = (delta: { entered: Int32Array; enteredCount: number }) => [
  ...delta.entered.subarray(0, delta.enteredCount),
];
const goneOf = (delta: { exited: Int32Array; exitedCount: number }) => [
  ...delta.exited.subarray(0, delta.exitedCount),
];

test('a cut delta enters every page of the first cut it is given', () => {
  const packed = [0, 1, 2, 3].map((id) => pageOf(id));
  const pages: PageRec[] = [];
  const delta = createCutDelta(packed, pages);
  delta.apply([2, 0, 1]);
  assert.deepEqual(listOf(delta).sort(), [0, 1, 2]);
  assert.deepEqual(goneOf(delta), []);
  // The records follow the order the readback published, which the page budget ranks in.
  assert.deepEqual(
    pages.map((page) => page.id),
    [2, 0, 1],
  );
  assert.equal(delta.count, 3);
});

test('two identical images process no page at all', () => {
  const packed = [0, 1, 2].map((id) => pageOf(id));
  const pages: PageRec[] = [];
  const delta = createCutDelta(packed, pages);
  delta.apply([0, 1, 2]);
  delta.apply([0, 1, 2]);
  assert.deepEqual(listOf(delta), []);
  assert.deepEqual(goneOf(delta), []);
  assert.equal(delta.count, 3);
  delta.hold();
  assert.deepEqual(listOf(delta), []);
  assert.deepEqual(goneOf(delta), []);
  assert.equal(pages.length, 3);
});

test('a moved cut names only what entered and what left', () => {
  const packed = [0, 1, 2, 3, 4].map((id) => pageOf(id));
  const pages: PageRec[] = [];
  const delta = createCutDelta(packed, pages);
  delta.apply([0, 1, 2]);
  delta.apply([1, 2, 3, 4]);
  assert.deepEqual(listOf(delta).sort(), [3, 4]);
  assert.deepEqual(goneOf(delta), [0]);
  assert.deepEqual(
    pages.map((page) => page.id),
    [1, 2, 3, 4],
  );
});

test('the suffix the caller appends is dropped, the cut is not', () => {
  const packed = [0, 1].map((id) => pageOf(id));
  const pages: PageRec[] = [];
  const delta = createCutDelta(packed, pages);
  delta.apply([0, 1]);
  pages.push(pageOf(9, 'transparent'));
  delta.hold();
  assert.deepEqual(
    pages.map((page) => page.id),
    [0, 1],
  );
  pages.push(pageOf(9, 'transparent'));
  delta.apply([0, 1]);
  assert.deepEqual(
    pages.map((page) => page.id),
    [0, 1],
  );
});

test('an unknown or repeated page id never enters the cut', () => {
  const packed = [pageOf(0), undefined as unknown as PageRec, pageOf(2)];
  const pages: PageRec[] = [];
  const delta = createCutDelta(packed, pages);
  delta.apply([0, 1, 2, 2, 99, -1]);
  assert.deepEqual(listOf(delta).sort(), [0, 2]);
  assert.equal(pages.length, 2);
});

test('an invalidated delta re-enters the whole cut, as the first image does', () => {
  const packed = [0, 1].map((id) => pageOf(id));
  const pages: PageRec[] = [];
  const delta = createCutDelta(packed, pages);
  delta.apply([0, 1]);
  delta.invalidate();
  assert.equal(delta.count, 0);
  delta.apply([0, 1]);
  assert.deepEqual(listOf(delta).sort(), [0, 1]);
});

test('a cut held image after image allocates nothing', () => {
  const packed = Array.from({ length: 64 }, (_, id) => pageOf(id));
  const pages: PageRec[] = [];
  const delta = createCutDelta(packed, pages);
  const ids = packed.map((page) => page.id);
  delta.apply(ids);
  const { entered, exited } = delta;
  const capacity = pages.length;
  for (let frame = 0; frame < 200; frame++) {
    delta.apply(ids);
    delta.hold();
  }
  // The difference lists and the record array are the ones the first image used.
  assert.equal(delta.entered, entered);
  assert.equal(delta.exited, exited);
  assert.equal(pages.length, capacity);
  assert.equal(delta.enteredCount, 0);
  assert.equal(delta.exitedCount, 0);
});
