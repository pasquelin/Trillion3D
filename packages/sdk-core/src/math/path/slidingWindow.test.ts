// The sliding median (`slidingWindow.ts`) keeps its values sorted as they arrive: every read must
// still equal the median of the last values, recomputed from scratch, on random inputs and on the
// values a typed sort orders specially (NaN, ±0, ±Inf).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Fenetre } from './slidingWindow.ts';
import { createPathGovernor } from './governor.ts';

const WINDOW = 30;
const SPECIAL = [NaN, 0, -0, Infinity, -Infinity, Number.MAX_VALUE, -Number.MIN_VALUE, 1e-300];

/** The median as it was computed before the change: a fresh copy, sorted, on every read. */
function reference(values: number[]) {
  const last = values.slice(-WINDOW);
  if (!last.length) return null;
  const sorted = Float64Array.from(last).sort(),
    middle = last.length >> 1;
  return last.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** A deterministic generator: the same inputs on every run. */
function random(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function sameMedian(window: Fenetre, values: number[], label: string) {
  const got = window.mediane(),
    want = reference(values);
  assert.ok(Object.is(got, want), `${label}: ${got} !== ${want}`);
}

test('an empty window has no median', () => {
  assert.equal(new Fenetre().mediane(), null);
});

test('every read equals the median recomputed from scratch, reads and writes interleaved', () => {
  const next = random(919);
  for (let run = 0; run < 200; run++) {
    const window = new Fenetre(),
      values: number[] = [];
    for (let step = 0; step < 90; step++) {
      const roll = next();
      const value =
        roll < 0.15
          ? SPECIAL[Math.floor(next() * SPECIAL.length)]
          : (next() - 0.5) * 10 ** (next() * 12);
      window.ajoute(value);
      values.push(value);
      // Reads follow no pattern: none, one, or several in a row, as the governor makes them.
      for (let reads = Math.floor(next() * 3); reads > 0; reads--)
        sameMedian(window, values, `run ${run} step ${step}`);
      assert.equal(window.count, Math.min(values.length, WINDOW));
    }
  }
});

test('the edge values alone keep their order: NaN last, -0 before +0', () => {
  for (const value of SPECIAL) {
    const window = new Fenetre(),
      values: number[] = [];
    for (let i = 0; i < WINDOW + 3; i++) {
      window.ajoute(value);
      values.push(value);
      sameMedian(window, values, `constant ${value}`);
    }
  }
  const window = new Fenetre(),
    values = [-0, 0, 0, -0, NaN, -0];
  for (const value of values) window.ajoute(value);
  sameMedian(window, values, 'signed zeros');
});

test('an observation takes no view of a window and sorts none, full or not (#983)', () => {
  let t = 0;
  const governor = createPathGovernor(() => (t += 0.001));
  governor.setWasm(true, true, null);
  const views = mock.method(Float64Array.prototype, 'subarray'),
    sorts = mock.method(Float64Array.prototype, 'sort');
  try {
    for (let i = 0; i < 2 * WINDOW + 10; i++)
      governor.observe('boxes', i % 2 ? 'js' : 'wasm', 1 + (i % 7) * 0.1, 100);
    assert.equal(views.mock.callCount() + sorts.mock.callCount(), 0);
  } finally {
    mock.restoreAll();
  }
});
