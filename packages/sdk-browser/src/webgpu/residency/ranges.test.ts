// #961: one coalescer for the residency flush and the page tables' flush. Each gives develop's
// ranges, frozen below, on random sorted indices and the edges: none, one, every step joined,
// exactly the cap, one past it, ties at the cut, the largest index.
import test from 'node:test';
import assert from 'node:assert/strict';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { RESIDENCY_RULE, coalesceRanges } from './ranges.ts';

/** develop's `coalesceResidencyRanges`: past the cap, one range covers everything. */
function developResidency(sorted: Int32Array, count: number) {
  if (count <= 0) return [];
  const out: number[][] = [];
  let from = sorted[0],
    to = sorted[0];
  for (let i = 1; i < count; i++) {
    if (sorted[i] - to <= 64) to = sorted[i];
    else {
      if (out.length === 32) return [[sorted[0], sorted[count - 1]]];
      out.push([from, to]);
      from = to = sorted[i];
    }
  }
  return out.length === 32 ? [[sorted[0], sorted[count - 1]]] : [...out, [from, to]];
}

/** develop's page-table flush (`pageUploads.ts`): past 64 runs, the narrowest steps are joined. */
function developPages(sorted: Int32Array, count: number) {
  if (!count) return [];
  let join = 16;
  const gaps: number[] = [];
  for (let i = 1; i < count; i++)
    if (sorted[i] - sorted[i - 1] > join) gaps.push(sorted[i] - sorted[i - 1]);
  if (gaps.length >= 64) join = Int32Array.from(gaps).sort()[gaps.length - 64];
  const out: number[][] = [];
  let from = sorted[0];
  for (let i = 1; i <= count; i++) {
    if (i < count && sorted[i] - sorted[i - 1] <= join) continue;
    out.push([from, sorted[i - 1]]);
    if (i < count) from = sorted[i];
  }
  return out;
}

const pairs = (into: Int32Array, n: number) =>
  Array.from({ length: n }, (_, r) => [into[r * 2], into[r * 2 + 1]]);

/** Sorted distinct indices: `count` of them, steps drawn up to `spread`. */
function indices(next: () => number, count: number, spread: number) {
  const out = new Int32Array(count);
  for (
    let i = 0, at = Math.floor(next() * spread);
    i < count;
    i++, at += 1 + Math.floor(next() * spread)
  )
    out[i] = at;
  return out;
}

const edges = [
  new Int32Array(0),
  Int32Array.of(0),
  Int32Array.of(2 ** 31 - 1),
  Int32Array.from({ length: 500 }, (_, i) => i * 3),
  Int32Array.from({ length: 32 }, (_, i) => i * 1000),
  Int32Array.from({ length: 33 }, (_, i) => i * 1000),
  Int32Array.from({ length: 64 }, (_, i) => i * 1000),
  Int32Array.from({ length: 65 }, (_, i) => i * 1000),
  Int32Array.from({ length: 200 }, (_, i) => i * 100 + (i % 3) * 17),
  Int32Array.from({ length: 90 }, (_, i) => 2 ** 31 - 1 - (89 - i) * 65),
];

test('the shared coalescer gives develop’s residency and page-table ranges, 0 divergence', () => {
  const into = new Int32Array(128);
  const cases = [...edges];
  const next = random(961);
  for (let n = 0; n < 10_000; n++)
    cases.push(indices(next, Math.floor(next() * 300), 1 + Math.floor(next() * 200)));
  for (const sorted of cases) {
    const steps = new Int32Array(sorted.length);
    const pages = { gap: 16, cap: 64, overflow: 'narrowest', steps } as const;
    const r = coalesceRanges(sorted, sorted.length, into, RESIDENCY_RULE);
    assert.deepEqual(pairs(into, r), developResidency(sorted, sorted.length), `${sorted}`);
    const p = coalesceRanges(sorted, sorted.length, into, pages);
    assert.deepEqual(pairs(into, p), developPages(sorted, sorted.length), `${sorted}`);
  }
});
