import test from 'node:test';
import assert from 'node:assert/strict';
import { HIZ_BACKGROUND, hizBuildPyramid, hizReduceCeil } from '../sdk-core/index.ts';
import { buildHizPyramid, hizRejects, type HizBounds } from './hiz.ts';
import {
  evaluateHizReduce,
  evaluateHizTest,
  hizLevelSizes,
  HIZ_SHADER,
  packHizPyramid,
} from './gpuHiz.ts';

/** Level 0 of the flat pyramid, in the row-of-rows shape `packHizPyramid` still takes. */
function levelZero(pyramid: { data: Float32Array; widths: Int32Array; heights: Int32Array }) {
  const width = pyramid.widths[0],
    height = pyramid.heights[0];
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row = new Array<number>(width);
    for (let x = 0; x < width; x++) row[x] = pyramid.data[y * width + x];
    rows.push(row);
  }
  return rows;
}

test('Hi-Z level sizes reduce by ceil 2 until a single texel', () => {
  assert.deepEqual(hizLevelSizes(32, 32), [
    [32, 32],
    [16, 16],
    [8, 8],
    [4, 4],
    [2, 2],
    [1, 1],
  ]);
  assert.deepEqual(hizLevelSizes(3, 3), [
    [3, 3],
    [2, 2],
    [1, 1],
  ]);
  assert.deepEqual(hizLevelSizes(1, 1), [[1, 1]]);
});

test('packed GPU pyramid matches the JS ceil-max oracle including a background hole', () => {
  const depth = [
    [0.2, 0.3],
    [0.4, HIZ_BACKGROUND],
  ];
  const packed = packHizPyramid(depth);
  const reduced = evaluateHizReduce(packed.data, packed.sizes[0][0], packed.sizes[0][1]);
  assert.deepEqual(hizReduceCeil(depth), [[HIZ_BACKGROUND]]);
  assert.equal(reduced.width, 1);
  assert.equal(reduced.height, 1);
  assert.equal(reduced.data[0], HIZ_BACKGROUND);
  assert.deepEqual(
    hizBuildPyramid(depth).map((level) => level.map((row) => [...row])),
    hizBuildPyramid(depth),
  );
});

test('GPU Hi-Z test kernel matches hizRejects and never rejects a background hole or a near clip', () => {
  const depth = new Float32Array(4);
  depth.set([0.2, 0.3, 0.4, HIZ_BACKGROUND]);
  const pyramid = buildHizPyramid(depth, 2, 2);
  const packed = packHizPyramid(levelZero(pyramid));
  const hole: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 1,
    maxY: 1,
    nearestDepth: 0.8,
    clipsNear: false,
  };
  const near: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 1,
    maxY: 1,
    nearestDepth: 0.8,
    clipsNear: true,
  };
  const edge: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 2,
    maxY: 2,
    nearestDepth: 0.8,
    clipsNear: false,
  };
  const closed = buildHizPyramid(new Float32Array([0.2, 0.3, 0.4, 0.5]), 2, 2);
  const closedPacked = packHizPyramid(levelZero(closed));
  const occluded: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 1,
    maxY: 1,
    nearestDepth: 0.8,
    clipsNear: false,
  };
  const equal: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 1,
    maxY: 1,
    nearestDepth: 0.5,
    clipsNear: false,
  };
  const flags = evaluateHizTest(packed, [hole, near, edge]);
  assert.equal(hizRejects(pyramid, hole), false);
  assert.deepEqual([...flags], [0, 0, 0]);
  const closedFlags = evaluateHizTest(closedPacked, [occluded, equal, near]);
  assert.equal(hizRejects(closed, occluded), true);
  assert.equal(hizRejects(closed, equal), false);
  assert.deepEqual([...closedFlags], [1, 0, 0]);
});

test('an integer-edge max is inclusive so a hole on that pixel cannot hide', () => {
  const depth = new Float32Array(16);
  depth.fill(0.2);
  depth[2 * 4 + 2] = HIZ_BACKGROUND;
  const pyramid = buildHizPyramid(depth, 4, 4);
  const packed = packHizPyramid(levelZero(pyramid));
  const bounds: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 2,
    maxY: 2,
    nearestDepth: 0.8,
    clipsNear: false,
  };
  assert.equal(hizRejects(pyramid, bounds), false);
  assert.deepEqual([...evaluateHizTest(packed, [bounds])], [0]);
});

test('a covered 33 by 19 footprint can reject through a reduced Hi-Z level', () => {
  const depth = new Float32Array(33 * 19);
  depth.fill(0.2);
  const pyramid = buildHizPyramid(depth, 33, 19);
  const bounds: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 32,
    maxY: 18,
    nearestDepth: 0.8,
    clipsNear: false,
  };
  assert.equal(hizRejects(pyramid, bounds), true);
  assert.deepEqual([...evaluateHizTest(packHizPyramid(levelZero(pyramid)), [bounds])], [1]);
});

test('a background pixel at the far edge of a large footprint prevents rejection', () => {
  const depth = new Float32Array(33 * 19);
  depth.fill(0.2);
  depth[18 * 33 + 32] = HIZ_BACKGROUND;
  const pyramid = buildHizPyramid(depth, 33, 19);
  const bounds: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 32,
    maxY: 18,
    nearestDepth: 0.8,
    clipsNear: false,
  };
  assert.equal(hizRejects(pyramid, bounds), false);
  assert.deepEqual([...evaluateHizTest(packHizPyramid(levelZero(pyramid)), [bounds])], [0]);
});

test('a footprint extending outside the viewport is tested on its clipped part and rejected', () => {
  const depth = new Float32Array(33 * 19);
  depth.fill(0.2);
  const pyramid = buildHizPyramid(depth, 33, 19);
  const bounds: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 33,
    maxY: 18,
    nearestDepth: 0.8,
    clipsNear: false,
  };
  assert.equal(hizRejects(pyramid, bounds), true);
  assert.deepEqual([...evaluateHizTest(packHizPyramid(levelZero(pyramid)), [bounds])], [1]);
});

test('Hi-Z compute shader declares this-frame max reduction with background 1', () => {
  assert.match(HIZ_SHADER, /@compute[\s\S]*fn copyDepth/);
  assert.match(HIZ_SHADER, /@compute[\s\S]*fn reduceHiz/);
  assert.match(HIZ_SHADER, /@compute[\s\S]*fn testHiz/);
  assert.match(HIZ_SHADER, /max\(/);
  assert.match(HIZ_SHADER, /texture_2d<f32>/);
  assert.doesNotMatch(HIZ_SHADER, /texture_depth_2d/);
  assert.match(HIZ_SHADER, /array<f32>/);
});
