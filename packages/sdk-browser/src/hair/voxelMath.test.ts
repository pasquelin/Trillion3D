// The numbers of the voxel volume: the pages, their levels, the voxel width as the adaptive size keeps it.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  roundVoxelSize,
  voxelAggregateLevel,
  voxelPageCount,
  voxelPageLevels,
  voxelPageResolution,
  voxelPageStride,
} from './voxelMath.ts'

test('a page is a power of two from 8 to 256 voxels a side, and holds its levels down to one voxel', () => {
  assert.deepEqual([1, 2, 9, 32, 33, 300].map(voxelPageResolution), [8, 8, 16, 32, 64, 256])
  assert.equal(voxelPageLevels(32), 6)
  // 32^3 + 16^3 + 8^3 + 4^3 + 2^3 + 1.
  assert.equal(voxelPageStride(32), 32768 + 4096 + 512 + 64 + 8 + 1)
  assert.equal(voxelAggregateLevel(32), 3, 'the level of 4 voxels a side')
  assert.equal(voxelAggregateLevel(8), 1)
})

test('the volume holds the pages the settings name, cut to what a storage binding holds', () => {
  const stride = voxelPageStride(32) * 4
  assert.equal(voxelPageCount(14, 32, Infinity), 14 ** 3)
  assert.equal(voxelPageCount(14, 32, stride * 100), 100)
  assert.equal(voxelPageCount(14, 32, 1), 1, 'one page at least')
})

test('the adaptive size is rounded to a hundredth of a millimetre', () => {
  assert.equal(roundVoxelSize(0.0030004), 0.003)
  assert.equal(roundVoxelSize(0.0030051), 0.00301)
})
