// Totals of the cut shown list, held by the difference instead of being resommed: `selected` the
// whole drawable cut, `uncovered` the hole (cluster with no residency row or bytes), `drawn` what
// remains, `transparent` the blend share. Oracle: the previous full pass, which resommed the cut
// at every adoption.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from '../../page/selection/selection.ts';
import { createCutDelta } from './delta.ts';
import { createCutCounts } from './counts.ts';

function page(triangles: number, transparent: boolean, resident: boolean): PageRec {
  return { triangles, transparent, array: resident ? new Uint32Array(3) : undefined } as PageRec;
}

/** Full pass: three totals from a single loop over the published sequence. */
function reference(pages: readonly PageRec[], ids: readonly number[], offsets: Int32Array) {
  let selected = 0,
    uncovered = 0,
    transparent = 0;
  for (let i = 0; i < ids.length; i++) {
    const rec = pages[ids[i]];
    if (!rec) continue;
    selected += rec.triangles;
    if (rec.transparent) transparent += rec.triangles;
    if (offsets[ids[i]] < 0 || !rec.array) uncovered += rec.triangles;
  }
  return {
    selectedTriangles: selected,
    drawnTriangles: selected - uncovered,
    uncoveredTriangles: uncovered,
    transparentTriangles: transparent,
  };
}

/** A reproducible pseudo-random stream: the sweep must be the same on every run. */
function stream(seed: number) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

test('the coverage relation holds, hole included, on a cut set once', () => {
  const pages = [
    page(10, false, true),
    page(5, false, true),
    page(30, true, true),
    page(7, false, false),
  ];
  const offsets = Int32Array.from([0, -1, 4, 8]);
  const delta = createCutDelta(pages),
    counts = createCutCounts(pages, offsets, delta);
  delta.apply([0, 1, 2, 3]);
  const totals = counts.apply();
  assert.deepEqual({ ...totals }, reference(pages, [0, 1, 2, 3], offsets));
  assert.equal(totals.uncoveredTriangles, 5 + 7, 'no residency row (1), no bytes (3)');
  assert.equal(
    totals.selectedTriangles - totals.drawnTriangles - totals.uncoveredTriangles,
    0,
    'coverage relation',
  );
});

test('a cut reread identically does not touch a counter', () => {
  const pages = [page(10, false, true), page(4, true, true)];
  const offsets = Int32Array.from([0, 4]);
  const delta = createCutDelta(pages),
    counts = createCutCounts(pages, offsets, delta);
  delta.apply([0, 1]);
  counts.apply();
  const avant = { ...counts.totals };
  delta.apply([0, 1]);
  assert.equal(delta.enteredCount + delta.exitedCount, 0, 'no page entered or exited');
  assert.deepEqual({ ...counts.apply() }, avant);
});

test('coverage that flips under the cut is taken by the named page alone', () => {
  const pages = [page(10, false, true), page(6, false, true)];
  const offsets = Int32Array.from([0, 4]);
  const delta = createCutDelta(pages),
    counts = createCutCounts(pages, offsets, delta);
  delta.apply([0, 1]);
  counts.apply();
  assert.equal(counts.totals.uncoveredTriangles, 0);
  // The page loses its cache slot, then its bytes, then gets both back.
  offsets[1] = -1;
  counts.touch(1);
  assert.equal(counts.totals.uncoveredTriangles, 6);
  pages[1].array = undefined;
  counts.touch(1);
  assert.equal(counts.totals.uncoveredTriangles, 6, 'a hole counted once, not twice');
  offsets[1] = 8;
  pages[1].array = new Uint32Array(3);
  counts.touch(1);
  assert.deepEqual({ ...counts.totals }, reference(pages, [0, 1], offsets));
  // A page outside the cut weighs on nothing, whatever happens to it.
  delta.apply([]);
  counts.apply();
  offsets[0] = -1;
  counts.touch(0);
  assert.deepEqual({ ...counts.totals }, reference(pages, [], offsets));
});

test('a thousand frames of random cuts and coverages yield the full pass', () => {
  const next = stream(20260917);
  const pages: PageRec[] = [];
  for (let i = 0; i < 24; i++) pages.push(page(1 + Math.floor(next() * 40), next() < 0.3, true));
  const offsets = new Int32Array(pages.length);
  const delta = createCutDelta(pages),
    counts = createCutCounts(pages, offsets, delta);
  let ids: number[] = [];
  for (let image = 0; image < 1000; image++) {
    if (next() < 0.5) {
      // The cut moves: an increasing sequence, like the compacted list the GPU publishes.
      ids = [];
      for (let id = 0; id < pages.length; id++) if (next() < 0.5) ids.push(id);
      delta.apply(ids);
      counts.apply();
    } else {
      // A page's coverage flips: the rank journal names it, and it alone.
      const id = Math.floor(next() * pages.length);
      if (next() < 0.5) offsets[id] = offsets[id] < 0 ? 0 : -1;
      else pages[id].array = pages[id].array ? undefined : new Uint32Array(3);
      counts.touch(id);
    }
    assert.deepEqual({ ...counts.totals }, reference(pages, ids, offsets), `image ${image}`);
  }
});
