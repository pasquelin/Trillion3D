// REVERSED depth: background is 0, reduction keeps the FARTHEST of a quad — thus the
// minimum —, and a box is occluded only if its nearest bound is SMALLER than
// the farthest occluder of its footprint.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hizReduceCeil,
  hizBuildPyramid,
  hizFootprintFar,
  hizOccluded,
  HIZ_NOTHING,
} from './index.ts';

test('a background hole prevents any rejection: reduction keeps the farthest', () => {
  assert.deepEqual(
    hizReduceCeil([
      [0.8, 0.7],
      [0.6, 0],
    ]),
    [[0]],
  );
});

test('hiz odd dimension keeps last column', () => {
  const level = hizReduceCeil([
    [0.8, 0.7, 0],
    [0.6, 0.5, 0.4],
    [0.3, 0.2, 0.1],
  ]);
  assert.deepEqual(level, [
    [0.5, 0],
    [0.2, 0.1],
  ]);
  assert.deepEqual(hizReduceCeil(level), [[0]]);
});

test('hiz pyramid reduces by ceil 2x2 min until a single texel', () => {
  const depth = [
    [0.8, 0.7, 0],
    [0.6, 0.5, 0.4],
    [0.3, 0.2, 0.1],
  ];
  const pyramid = hizBuildPyramid(depth);
  assert.deepEqual(pyramid[0], depth);
  assert.deepEqual(pyramid[1], [
    [0.5, 0],
    [0.2, 0.1],
  ]);
  assert.deepEqual(pyramid[2], [[0]]);
});

test('hiz footprint of a background hole cannot hide a nearer bound', () => {
  const pyramid = hizBuildPyramid([
    [0.8, 0.7],
    [0.6, 0],
  ]);
  assert.equal(hizFootprintFar(pyramid, 0, 0, 2, 2, 0), 0);
  assert.equal(hizFootprintFar(pyramid, 0, 0, 2, 2, 1), 0);
  assert.equal(hizOccluded(0.2, hizFootprintFar(pyramid, 0, 0, 2, 2, 1)), false);
});

test('hiz occludes only when the nearest bound is strictly behind every covered far depth', () => {
  const pyramid = hizBuildPyramid([
    [0.8, 0.7],
    [0.6, 0.5],
  ]);
  assert.equal(hizFootprintFar(pyramid, 0, 0, 2, 2, 0), 0.5);
  assert.equal(hizOccluded(0.2, 0.5), true);
  assert.equal(hizOccluded(0.5, 0.5), false);
  assert.equal(hizOccluded(0.6, 0.5), false);
  assert.equal(hizOccluded(0.2, 0.5, 0.3), false);
});

test('hiz empty or out of range footprint does not occlude', () => {
  const pyramid = hizBuildPyramid([
    [0.8, 0.7],
    [0.6, 0.5],
  ]);
  assert.equal(hizFootprintFar(pyramid, 2, 2, 2, 3, 0), HIZ_NOTHING);
  assert.equal(hizOccluded(0.1, hizFootprintFar(pyramid, 2, 2, 2, 3, 0)), false);
  assert.equal(hizOccluded(0.1, hizFootprintFar(pyramid, 0, 0, 0, 2, 0)), false);
});
