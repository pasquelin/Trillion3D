import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hizReduceCeil,
  hizBuildPyramid,
  hizFootprintFar,
  hizOccluded,
  HIZ_BACKGROUND,
} from './index.ts';

test('hiz background prevents false rejection', () => {
  assert.deepEqual(
    hizReduceCeil([
      [0.2, 0.3],
      [0.4, 1.0],
    ]),
    [[1.0]],
  );
  assert.deepEqual(
    hizReduceCeil(
      [
        [0.8, 0.7],
        [0.6, 0],
      ],
      true,
    ),
    [[0]],
  );
});

test('hiz odd dimension keeps last column', () => {
  const level = hizReduceCeil([
    [0.2, 0.3, 1],
    [0.4, 0.5, 0.6],
    [0.7, 0.8, 0.9],
  ]);
  assert.deepEqual(level, [
    [0.5, 1],
    [0.8, 0.9],
  ]);
  assert.deepEqual(hizReduceCeil(level), [[1]]);
});

test('hiz pyramid reduces by ceil 2x2 max until a single texel', () => {
  const depth = [
    [0.2, 0.3, 1],
    [0.4, 0.5, 0.6],
    [0.7, 0.8, 0.9],
  ];
  const pyramid = hizBuildPyramid(depth);
  assert.equal(HIZ_BACKGROUND, 1);
  assert.deepEqual(pyramid[0], depth);
  assert.deepEqual(pyramid[1], [
    [0.5, 1],
    [0.8, 0.9],
  ]);
  assert.deepEqual(pyramid[2], [[1]]);
});

test('hiz footprint of a background hole cannot hide a nearer bound', () => {
  const pyramid = hizBuildPyramid([
    [0.2, 0.3],
    [0.4, 1.0],
  ]);
  assert.equal(hizFootprintFar(pyramid, 0, 0, 2, 2, 0), 1);
  assert.equal(hizFootprintFar(pyramid, 0, 0, 2, 2, 1), 1);
  assert.equal(hizOccluded(0.8, hizFootprintFar(pyramid, 0, 0, 2, 2, 1)), false);
});

test('hiz occludes only when the nearest bound is strictly behind every covered far depth', () => {
  const pyramid = hizBuildPyramid([
    [0.2, 0.3],
    [0.4, 0.5],
  ]);
  assert.equal(hizFootprintFar(pyramid, 0, 0, 2, 2, 0), 0.5);
  assert.equal(hizOccluded(0.8, 0.5), true);
  assert.equal(hizOccluded(0.5, 0.5), false);
  assert.equal(hizOccluded(0.4, 0.5), false);
  assert.equal(hizOccluded(0.8, 0.5, 0.3), false);
});

test('hiz empty or out of range footprint does not occlude', () => {
  const pyramid = hizBuildPyramid([
    [0.2, 0.3],
    [0.4, 0.5],
  ]);
  assert.equal(hizOccluded(0.9, hizFootprintFar(pyramid, 2, 2, 2, 3, 0)), false);
  assert.equal(hizOccluded(0.9, hizFootprintFar(pyramid, 0, 0, 0, 2, 0)), false);
});
