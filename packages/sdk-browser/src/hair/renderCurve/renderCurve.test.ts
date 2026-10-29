// The curve raster pipeline's sizes and its scene tile depth, read from the shipped text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { unresolvedNames } from '../../gpu/core/wgslNames.fixture.ts'
import { renderCurveCommon } from './renderCurveMath.ts'
import { RENDER_CURVE_SCENE_TILE_DEPTH_WGSL } from './sceneTileDepthWgsl.ts'

test('the sizes follow the tiles of the image and the binners', () => {
  const common = renderCurveCommon(1920, 1080, 32, 256, 0.05, 1 << 30)
  assert.deepEqual(common.binTileRes, [60, 34])
  assert.deepEqual(common.rasterTileRes, [240, 135])
  assert.equal(common.maxTileDataCount, 60 * 34 * 32 * 2)
  assert.equal(common.maxSegmentDataCount, 60 * 34 * 32 * 128)
  assert.equal(common.maxZBinDataCount, common.maxTileDataCount)
  assert.equal(common.maxZBinSegmentDataCount, common.maxSegmentDataCount)
  assert.equal(common.maxRasterWorkCount, 60 * 34)
})

test('binners and rasterizers are held to their ranges, a few binners still make room for eight', () => {
  const low = renderCurveCommon(64, 64, 0, 0, 2, 1 << 30)
  assert.equal(low.numBinners, 1)
  assert.equal(low.numRasterizers, 1)
  assert.equal(low.minCoverageThreshold, 1)
  assert.equal(low.maxTileDataCount, 4 * 8 * 2)
  const high = renderCurveCommon(64, 64, 999, 99999, -1, 1 << 30)
  assert.equal(high.numBinners, 256)
  assert.equal(high.numRasterizers, 1024)
  assert.equal(high.minCoverageThreshold, 0)
})

test('the room for segments is held to what a storage buffer of the device holds', () => {
  assert.equal(renderCurveCommon(1920, 1080, 32, 256, 0.05, 1000).maxSegmentDataCount, 1000)
})

test('the scene tile depth keeps the furthest and the nearest depth of a 32 pixel tile as the float bits', () => {
  const code = RENDER_CURVE_SCENE_TILE_DEPTH_WGSL
  assert.match(code, /atomicStore\(&furthest,0xFFFFFFFFu\);/)
  assert.match(code, /atomicStore\(&nearest,0u\);/)
  assert.match(code, /let depth=bitcast<u32>\(textureLoad\(sceneDepth,vec2i\(pixel\),0\)\);/)
  assert.match(code, /atomicMin\(&furthest,depth\);/)
  assert.match(code, /atomicMax\(&nearest,depth\);/)
  assert.match(code, /@workgroup_size\(256\)/)
  assert.match(code, /for\(var k=0u;k<4u;k\+\+\)/)
  assert.deepEqual(unresolvedNames(code), [])
})
