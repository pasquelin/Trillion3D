// A light cut keeps a box only if it covers a page its face redraws this frame: an L-shaped
// strip must not select everything its bounding rectangle holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boxMissesLightPages, createLightPages, markLightPages } from './pageOverlap.ts';

// An orthographic face of 8 × 8 pages over [−4, 4] metres: one page per metre, identity view.
const VIEW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const face = () => Object.assign(createLightPages(), { rows: 8, clipScale: 0.25, clipPad: 0 });
const box = (x: number, y: number, half = 0.2) => [
  [x - half, y - half, -1],
  [x + half, y + half, 1],
];

test('an L-shaped strip keeps what it covers and drops the corner its rectangle only bounds', () => {
  const pages = face();
  // The last column and the bottom row: an L of drawn cells, bounded by the whole extent.
  markLightPages(pages, 7, 7, 0, 7);
  markLightPages(pages, 0, 7, 7, 7);
  // Column 7 spans x in [3, 4]; row 7, at the bottom, spans y in [−4, −3].
  const [minA, maxA] = box(3.5, 2.5);
  assert.equal(boxMissesLightPages(pages, minA, maxA, VIEW, 0), false, 'inside the column');
  const [minB, maxB] = box(-2.5, -3.5);
  assert.equal(boxMissesLightPages(pages, minB, maxB, VIEW, 0), false, 'inside the row');
  const [minC, maxC] = box(-2.5, 2.5);
  assert.equal(boxMissesLightPages(pages, minC, maxC, VIEW, 0), true, 'the untouched corner');
  const [minD, maxD] = box(2.9, 2.5, 0.2);
  assert.equal(boxMissesLightPages(pages, minD, maxD, VIEW, 0), false, 'a box reaching the column');
});

test('the margin of one texel keeps a box that grazes a redrawn page', () => {
  const pages = face();
  markLightPages(pages, 7, 7, 0, 7);
  const [min, max] = [
    [2.5, 0, -1],
    [2.999, 0.2, 1],
  ];
  assert.equal(boxMissesLightPages(pages, min, max, VIEW, 0), true);
  pages.clipPad = 2 / 1024;
  assert.equal(boxMissesLightPages(pages, min, max, VIEW, 0), false);
});

test('under a perspective face, a box that reaches behind the light is always kept', () => {
  const pages = face();
  markLightPages(pages, 0, 0, 0, 0);
  // View space looks down −z: a box straddling z = 0 has a depth bound at or behind the eye.
  assert.equal(boxMissesLightPages(pages, [2, 2, -1], [3, 3, 1], VIEW, 1), false);
  assert.equal(boxMissesLightPages(pages, [2, 2, -6], [3, 3, -5], VIEW, 1), true);
});
