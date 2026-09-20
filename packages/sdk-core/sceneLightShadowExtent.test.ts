// A cascade map is addressed by absolute page modulo the face: the mask is physical, extent
// rectangles are written through the wrap, a slide marks the entering strip only, and the
// regions cut at the seam carry the translation that lands extent pages on physical pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowDirty } from './sceneLightShadowDirty.ts';
import { createShadowRegions } from './sceneLightShadowRegions.ts';
import { markExtentRect } from './sceneLightShadowPages.ts';

const ROWS = 8;

function rowsOf(dirty: ReturnType<typeof createShadowDirty>, slice: number, face: number) {
  const rows: number[] = [];
  for (let row = 0; row < ROWS; row++) rows.push(dirty.row(slice, face, row));
  return rows;
}

test('markExtentRect wraps an extent rectangle onto the face through the origin page', () => {
  const mask = new Uint8Array(ROWS);
  // Extent columns 6..7 with the origin at physical column 3 land on physical 1..2 (6+3, 7+3 mod 8);
  // extent rows 7 with the origin at physical row 5 lands on physical row 4.
  markExtentRect(mask, 0, ROWS, 3, 5, 6, 7, 7, 7);
  assert.deepEqual([...mask], [0, 0, 0, 0, 0b110, 0, 0, 0]);
});

test('a slide marks the strip that entered, at its physical place, and nothing else', () => {
  const dirty = createShadowDirty();
  // Origin at physical (2, 0): the extent slid right by one page, its last column is new.
  dirty.setExtent(0, 0, 2, 0);
  dirty.slide(0, 0, ROWS, 1, 0, 0, 0);
  assert.equal(dirty.pages(0, 0), ROWS, 'one column of pages');
  // Extent column 7 lives at physical column (7 + 2) mod 8 = 1.
  assert.deepEqual(rowsOf(dirty, 0, 0), new Array(ROWS).fill(0b10));
  assert.equal(dirty.invalidated, ROWS, 'counted at entry');
});

test('a slide by two pages down marks two rows, wrapped at the bottom of the face', () => {
  const dirty = createShadowDirty();
  dirty.setExtent(0, 0, 0, 7);
  dirty.slide(0, 0, ROWS, 0, 2, 0, 0);
  // Extent rows 6 and 7 live at physical rows (6 + 7) mod 8 = 5 and (7 + 7) mod 8 = 6.
  const rows = rowsOf(dirty, 0, 0);
  assert.deepEqual(rows, [0, 0, 0, 0, 0, 0xff, 0xff, 0]);
});

test('a region straddling the seam is cut in two, each side with its own translation', () => {
  const dirty = createShadowDirty();
  const regions = createShadowRegions(8);
  // Origin at physical column 3: physical columns 3..7 are extent 0..4, physical 0..2 are extent 5..7.
  dirty.setExtent(0, 0, 3, 0);
  dirty.whole(0, 0, ROWS, 0, 0);
  assert.equal(
    regions.addFace(dirty, 0, 0, 0, ROWS, () => true),
    true,
  );
  assert.equal(regions.count, 2);
  assert.deepEqual(
    [0, 1].map((r) => [regions.x0Of(r), regions.x1Of(r), regions.shiftXOf(r), regions.shiftYOf(r)]),
    [
      [0, 2, 3 - ROWS, 0],
      [3, 7, 3, 0],
    ],
  );
  assert.equal(regions.pages, ROWS * ROWS, 'the whole face, in two calls');
  assert.equal(dirty.isDirty(0, 0), false);
});

test('without a slide, a whole face stays one region with no translation', () => {
  const dirty = createShadowDirty();
  const regions = createShadowRegions(8);
  dirty.whole(0, 0, ROWS, 0, 0);
  regions.addFace(dirty, 0, 0, 0, ROWS, () => true);
  assert.equal(regions.count, 1);
  assert.deepEqual([regions.shiftXOf(0), regions.shiftYOf(0)], [0, 0]);
});

test('a region refused at the seam leaves the other side waiting', () => {
  const dirty = createShadowDirty();
  const regions = createShadowRegions(8);
  dirty.setExtent(0, 0, 3, 0);
  dirty.whole(0, 0, ROWS, 0, 0);
  let admitted = 0;
  assert.equal(
    regions.addFace(dirty, 0, 0, 0, ROWS, () => admitted++ === 0),
    false,
  );
  assert.equal(regions.count, 1);
  assert.equal(dirty.pages(0, 0), ROWS * ROWS - regions.pages, 'the refused side still waits');
});
