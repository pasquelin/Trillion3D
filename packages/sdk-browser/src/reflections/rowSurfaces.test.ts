import test from 'node:test';
import assert from 'node:assert/strict';
import { wantsReflections } from './gpu.ts';
import { createWebgpuRowState } from '../webgpu/row/state.ts';
import type { PageRec } from '../page/selection/selection.ts';
import type { PageSurface } from '../page/surface.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

const ROWS = 5000;
const surface = (roughness: number) => ({ lit: true, model: 0, roughness }) as PageSurface;

/** A table of `ROWS` instance rows over two matte surfaces, and how many rows a walk read. */
function instanceRows() {
  const rows = createWebgpuRowState([], ROWS),
    [bark, leaves] = [
      { ...surface(0.9), model: 4 },
      { ...surface(0.8), model: 4 },
    ],
    recs = Array.from({ length: ROWS }, (_, i) => ({ material: i % 7 ? leaves : bark }) as PageRec);
  rows.packedCount = ROWS;
  const read = { rows: 0 };
  rows.packedRecs.splice(
    0,
    ROWS,
    ...recs.map((rec) => new Proxy(rec, { get: (t, k) => (read.rows++, t[k as keyof PageRec]) })),
  );
  const rt = {
    run: { diagnostic: 'beauty' },
    layout: { rows },
    blendState: { blendGpu: [] },
  } as unknown as WebgpuPagesRuntime;
  return { rows, rt, read, leaves };
}

// #410: a world of instances holds hundreds of thousands of rows over a handful of surfaces; the
// reflection targets asked the question once per row, twice per image.
test('reflections read each surface of the rows once, and walk the rows only once written', () => {
  const { rows, rt, read, leaves } = instanceRows();
  assert.equal(wantsReflections(rt), false);
  assert.equal(read.rows, ROWS, 'the first image walks the rows');
  // The host gives a diffuse surface a physical lobe in place: the surface is read again, the rows are not.
  leaves.model = 0;
  assert.equal(wantsReflections(rt), true);
  assert.equal(read.rows, ROWS, 'no row written, no row walked');
  leaves.model = 4;
  // A row written with a mirror is seen at the next image.
  rows.packedRecs[42] = { material: surface(0) } as PageRec;
  rows.markRowDirty(42);
  assert.equal(wantsReflections(rt), true);
  assert.equal(read.rows, 2 * ROWS - 1, 'a written row walks the rows again');
  // A pose rewrites a row's matrix every image a model moves: its occupant is kept.
  rows.markRowWords(7);
  assert.equal(wantsReflections(rt), true);
  assert.equal(read.rows, 2 * ROWS - 1, 'a pose walks no row');
  // A record takes another surface in place under a new table age, before its row is written.
  rows.tableEpoch++;
  assert.equal(wantsReflections(rt), true);
  assert.equal(read.rows, 3 * ROWS - 2, 'a new table age walks the rows again');
});
