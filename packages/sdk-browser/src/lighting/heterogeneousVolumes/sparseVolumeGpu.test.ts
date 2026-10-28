// The sparse volume upload's pure parts: the atlas's size, the tile cells and the fallback voxel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { packedUniforms } from './sparseVolumeGpu.ts'
import { atlasCell, atlasResolutionInTiles, fallbackVoxel } from './sparseVolumeAtlas.ts'
import { floatToHalf } from './halfFloat.ts'

test('the atlas is the smallest cube trimmed along z, then y, then x', () => {
  assert.deepEqual(atlasResolutionInTiles(1), [1, 1, 1])
  assert.deepEqual(atlasResolutionInTiles(8), [2, 2, 2])
  assert.deepEqual(atlasResolutionInTiles(9), [3, 2, 2])
  for (const tiles of [2, 5, 28, 100]) {
    const [x, y, z] = atlasResolutionInTiles(tiles)
    assert.ok(x * y * z >= tiles, String(tiles))
  }
})

test('a tile rank is a cell of the atlas, x fastest, the null tile at the origin', () => {
  assert.deepEqual(atlasCell(0, [3, 3, 1]), [0, 0, 0])
  assert.deepEqual(atlasCell(4, [3, 3, 1]), [1, 1, 0])
})

test('a fallback voxel is the value in the bytes of its format', () => {
  assert.deepEqual([...fallbackVoxel(1, new Float32Array([1, 0, 0, 0]))], [255])
  assert.deepEqual([...fallbackVoxel(4, new Float32Array([1, 0, 0, 0]))], [0, 0x3c])
  assert.equal(floatToHalf(65536), 0x7c00)
  assert.equal(floatToHalf(-2), 0xc000)
})

test('the packed uniforms hold the volume in pages, the lowest page, the atlas texel and the levels', () => {
  const frame = { pageTableMin: [1, 2, 3], mipCount: 4 } as never
  const words = packedUniforms(frame, 5, [32, 48, 16], [36, 36, 18])
  const floats = new Float32Array(words.buffer)
  assert.deepEqual([...floats.slice(0, 3)], [2, 3, 1])
  assert.equal(words[3], 1 | (2 << 11) | (3 << 22))
  assert.deepEqual([...floats.slice(4, 7)], [1 / 36, 1 / 36, 1 / 18].map(Math.fround))
  assert.equal(words[7], 5 | (3 << 16))
})
