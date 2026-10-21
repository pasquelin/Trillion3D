import test from 'node:test'
import assert from 'node:assert/strict'
import { DEPTH_CLEAR } from '../../../camera/depthConvention.ts'
import { HIZ_SHADER } from './shader.ts'
import { packHizPyramid, evaluateHizReduce } from './oracle.fixture.ts'
import { hizBuildPyramid, hizReduceCeil } from '../../../../../sdk-core/src/hiz/oracles.fixture.ts'
import { buildHizPyramid } from '../../../../../../bench/oracles/browser/hizPyramid.ts'
import { hizLevelSizes } from './levelSizes.ts'
import { hizRejects, type HizBounds } from '../../../../../../bench/oracles/browser/hizRejects.ts'

test('Hi-Z level sizes reduce by ceil 2 until a single texel', () => {
  assert.deepEqual(hizLevelSizes(32, 32), [
    [32, 32],
    [16, 16],
    [8, 8],
    [4, 4],
    [2, 2],
    [1, 1],
  ])
  assert.deepEqual(hizLevelSizes(3, 3), [
    [3, 3],
    [2, 2],
    [1, 1],
  ])
  assert.deepEqual(hizLevelSizes(1, 1), [[1, 1]])
})

test('packed GPU pyramid matches the JS ceil-min oracle including a background hole', () => {
  const depth = [
    [0.8, 0.7],
    [0.6, DEPTH_CLEAR],
  ]
  const packed = packHizPyramid(depth)
  const reduced = evaluateHizReduce(packed.data, packed.sizes[0][0], packed.sizes[0][1])
  assert.deepEqual(hizReduceCeil(depth), [[DEPTH_CLEAR]])
  assert.equal(reduced.width, 1)
  assert.equal(reduced.height, 1)
  assert.equal(reduced.data[0], DEPTH_CLEAR)
  assert.deepEqual(
    hizBuildPyramid(depth).map((level) => level.map((row) => [...row])),
    hizBuildPyramid(depth),
  )
})

test('hizRejects never rejects a background hole or a near clip', () => {
  const depth = new Float32Array(4)
  depth.set([0.8, 0.7, 0.6, DEPTH_CLEAR])
  const pyramid = buildHizPyramid(depth, 2, 2)
  const hole: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 1,
    maxY: 1,
    nearestDepth: 0.2,
    clipsNear: false,
  }
  const near: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 1,
    maxY: 1,
    nearestDepth: 0.2,
    clipsNear: true,
  }
  const edge: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 2,
    maxY: 2,
    nearestDepth: 0.2,
    clipsNear: false,
  }
  const closed = buildHizPyramid(new Float32Array([0.8, 0.7, 0.6, 0.5]), 2, 2)
  const occluded: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 1,
    maxY: 1,
    nearestDepth: 0.2,
    clipsNear: false,
  }
  const equal: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 1,
    maxY: 1,
    nearestDepth: 0.5,
    clipsNear: false,
  }
  assert.deepEqual(
    [hole, near, edge].map((bounds) => hizRejects(pyramid, bounds)),
    [false, false, false],
  )
  assert.deepEqual(
    [occluded, equal, near].map((bounds) => hizRejects(closed, bounds)),
    [true, false, false],
  )
})

test('an integer-edge max is inclusive so a hole on that pixel cannot hide', () => {
  const depth = new Float32Array(16)
  depth.fill(0.8)
  depth[2 * 4 + 2] = DEPTH_CLEAR
  const pyramid = buildHizPyramid(depth, 4, 4)
  const bounds: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 2,
    maxY: 2,
    nearestDepth: 0.2,
    clipsNear: false,
  }
  assert.equal(hizRejects(pyramid, bounds), false)
})

test('a covered 33 by 19 footprint can reject through a reduced Hi-Z level', () => {
  const depth = new Float32Array(33 * 19)
  depth.fill(0.8)
  const pyramid = buildHizPyramid(depth, 33, 19)
  const bounds: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 32,
    maxY: 18,
    nearestDepth: 0.2,
    clipsNear: false,
  }
  assert.equal(hizRejects(pyramid, bounds), true)
})

test('a background pixel at the far edge of a large footprint prevents rejection', () => {
  const depth = new Float32Array(33 * 19)
  depth.fill(0.8)
  depth[18 * 33 + 32] = DEPTH_CLEAR
  const pyramid = buildHizPyramid(depth, 33, 19)
  const bounds: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 32,
    maxY: 18,
    nearestDepth: 0.2,
    clipsNear: false,
  }
  assert.equal(hizRejects(pyramid, bounds), false)
})

test('a footprint extending outside the viewport is tested on its clipped part and rejected', () => {
  const depth = new Float32Array(33 * 19)
  depth.fill(0.8)
  const pyramid = buildHizPyramid(depth, 33, 19)
  const bounds: HizBounds = {
    minX: 0,
    minY: 0,
    maxX: 33,
    maxY: 18,
    nearestDepth: 0.2,
    clipsNear: false,
  }
  assert.equal(hizRejects(pyramid, bounds), true)
})

test('Hi-Z compute shader declares this-frame min reduction, background at the far value', () => {
  assert.match(HIZ_SHADER, /@compute[\s\S]*fn buildHiz/)
  assert.match(HIZ_SHADER, /min\(/)
  assert.doesNotMatch(HIZ_SHADER, /far=max\(/)
  // Level 0 binds as one array: the opaque depth, the nearest transparent surface's beside it.
  assert.match(HIZ_SHADER, /var level0:texture_2d_array<f32>/)
  assert.doesNotMatch(HIZ_SHADER, /texture_depth_2d/)
  assert.match(HIZ_SHADER, /texture_storage_2d_array<r32uint,read_write>/)
})
