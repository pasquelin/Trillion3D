// A texture's bytes are counted over its levels, layers and format, block formats rounded to the
// block; a format outside the table has no count, never an estimate.
import test from 'node:test'
import assert from 'node:assert/strict'
import { textureBytesOf } from './textureBytes.ts'

test('a texture is counted over all its levels, layers and format', () => {
  const rgba = textureBytesOf({
    size: { width: 2048, height: 2048, depthOrArrayLayers: 3 },
    format: 'rgba8unorm',
    mipLevelCount: 12,
    usage: 0,
  })
  // 2048² × 4 bytes × (1 + 1/4 + … + 1/4¹¹) × 3 layers.
  let perLayer = 0
  for (let l = 0; l < 12; l++) perLayer += (2048 >> l) ** 2 * 4
  assert.equal(rgba, perLayer * 3)
  assert.equal(textureBytesOf({ size: [64, 32], format: 'depth32float', usage: 0 }), 64 * 32 * 4)
  // A BC7 block is sixteen bytes for sixteen texels: one byte per texel, rounded to the block.
  assert.equal(textureBytesOf({ size: [6, 6], format: 'bc7-rgba-unorm', usage: 0 }), 4 * 16)
  // The ETC2 family's pools, colour and two-channel, cost the same sixteen bytes a block.
  for (const format of ['etc2-rgba8unorm-srgb', 'eac-rg11unorm'] as const)
    assert.equal(textureBytesOf({ size: [6, 6], format, usage: 0 }), 4 * 16, format)
  // A volume also divides its depth at each level; an array does not.
  assert.equal(
    textureBytesOf({
      size: [4, 4, 4],
      format: 'r8unorm',
      mipLevelCount: 2,
      dimension: '3d',
      usage: 0,
    }),
    64 + 8,
  )
  assert.equal(
    textureBytesOf({ size: [4, 4, 4], format: 'r8unorm', mipLevelCount: 2, usage: 0 }),
    64 + 16,
  )
  assert.equal(textureBytesOf({ size: [1, 1], format: 'r8snorm', usage: 0 }), null)
})
