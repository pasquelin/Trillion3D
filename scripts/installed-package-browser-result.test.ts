// The installed page's no-hole check can fail (#486, audit of #639): it compares what the engine
// drew with the scene's own full-detail count, which no engine counter copies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawsItsWholeCut } from './installed-package-browser-result.ts';
import { INSTALLED_SCENE_TRIANGLES as FULL } from './installed-package-scene.ts';

test('a frame that draws the scene at full detail passes', () => {
  assert.equal(drawsItsWholeCut({ selectedTriangles: FULL, drawnTriangles: FULL }), true);
});

test('a hole, a coarser stand-in, overdraw or a missing count fails', () => {
  // The engine's two counters agreeing proves nothing: they are one counter on WebGPU.
  for (const drawn of [FULL - 2, FULL / 4, FULL + 2, 0])
    assert.equal(drawsItsWholeCut({ selectedTriangles: drawn, drawnTriangles: drawn }), false);
  assert.equal(drawsItsWholeCut({ selectedTriangles: FULL, drawnTriangles: null }), false);
  assert.equal(drawsItsWholeCut(undefined), false);
});
