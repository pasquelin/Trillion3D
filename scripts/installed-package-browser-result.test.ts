// The installed page's no-hole check can fail (#486, audit of #639): it reads the engine's own
// counts, and a frame that draws less than — or other than — the cut it selected fails it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawsItsWholeCut } from './installed-package-browser-result.ts';

test('a frame that draws its whole selected cut passes', () => {
  assert.equal(drawsItsWholeCut({ selectedTriangles: 1200, drawnTriangles: 1200 }), true);
});

test('a hole, a coarser stand-in or a missing count fails', () => {
  assert.equal(drawsItsWholeCut({ selectedTriangles: 1200, drawnTriangles: 1100 }), false);
  assert.equal(drawsItsWholeCut({ selectedTriangles: 1200, drawnTriangles: 300 }), false);
  assert.equal(drawsItsWholeCut({ selectedTriangles: 1200, drawnTriangles: null }), false);
  assert.equal(drawsItsWholeCut({ selectedTriangles: 0, drawnTriangles: 0 }), false);
  assert.equal(drawsItsWholeCut(undefined), false);
});
