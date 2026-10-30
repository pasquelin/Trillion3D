// The grid the hit lighting's buffers are sized on (`grids.ts`): the used grid, the hits' record, the binding limit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import {
  createReflectionGrids,
  litBindingBytes,
  litFits,
  reflectionHitWords,
  usedAxis,
} from './grids.ts'
import { IDLE_KEEP_IMAGES } from '../../gpu/core/idleKeep.ts'

/** The grid of a view of `size` pixels at the blocks `block` and `frontBlock` of its two surfaces: each axis by `usedAxis`. */
const usedGrid = (
  size: readonly [number, number],
  block: readonly [number, number],
  frontBlock: readonly [number, number],
) =>
  [usedAxis(size[0], block[0], frontBlock[0]), usedAxis(size[1], block[1], frontBlock[1])] as const

const device = (binding: number, buffer = binding) =>
  ({ limits: { maxStorageBufferBindingSize: binding, maxBufferSize: buffer } }) as GPUDevice

test('the used grid holds the finer of the two surfaces’ blocks along each axis', () => {
  assert.deepEqual(usedGrid([1920, 1080], [1, 1], [1, 1]), [1920, 1080])
  assert.deepEqual(usedGrid([1920, 1080], [2, 2], [2, 2]), [960, 540])
  assert.deepEqual(usedGrid([1921, 1081], [2, 1], [4, 2]), [961, 1081])
  assert.deepEqual(usedGrid([1920, 1080], [4, 4], [2, 4]), [960, 270])
})

test('a hit’s record is four words, five where the hit lighting keeps the key of its material', () => {
  assert.equal(reflectionHitWords(false), 4)
  assert.equal(reflectionHitWords(true), 5)
})

test('the hit lighting fits where its radiance, the widest of its buffers, fits one storage binding', () => {
  const MB = 1 << 20
  // 4K at one pixel a texel: 8.3 million traces of 32 bytes, past 128 MB; at 2 x 2 pixels a texel, 66 MB.
  assert.equal(litFits(device(128 * MB), usedGrid([3840, 2160], [1, 1], [1, 1])), false)
  assert.equal(litFits(device(128 * MB), usedGrid([3840, 2160], [2, 2], [2, 2])), true)
  assert.equal(litFits(device(1024 * MB), usedGrid([3840, 2160], [1, 1], [1, 1])), true)
  // The device's largest buffer bounds it as well as the binding.
  assert.equal(litFits(device(1024 * MB, 128 * MB), usedGrid([3840, 2160], [1, 1], [1, 1])), false)
})

test('each reflection bounce adds four vec4u to a trace of the hit lighting’s radiance, which must still fit one binding', () => {
  const MB = 1 << 20
  const grid = usedGrid([3840, 2160], [2, 2], [2, 2])
  const texels = 1920 * 1080
  assert.equal(litBindingBytes(grid, 1), texels * 32)
  assert.equal(litBindingBytes(grid, 3), texels * (32 + 2 * 64))
  assert.equal(litFits(device(128 * MB), grid, 1), true)
  assert.equal(litFits(device(128 * MB), grid, 2), false)
  assert.equal(litFits(device(512 * MB), grid, 2), true)
})

test('an axis of the used grid is the finer block’s, and usedGrid is made of its axes', () => {
  assert.equal(usedAxis(1921, 2, 4), 961)
  assert.deepEqual(usedGrid([1921, 1081], [2, 1], [4, 2]), [
    usedAxis(1921, 2, 4),
    usedAxis(1081, 1, 2),
  ])
})

test('the hit lighting’s state is made for the grid and vertices asked, kept while it serves and fits, and made again when it does not', () => {
  installGpuGlobals()
  const { device, buffers } = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  })
  const gpu = device as unknown as GPUDevice
  const radiance = () => buffers.filter((made) => made.label?.includes('hit lighting radiance'))
  const grids = createReflectionGrids(gpu, 'test', [64, 64])
  const first = grids.lit([16, 16], 2)
  assert.equal(radiance().at(-1)?.size, 16 * 16 * (8 + 4 * 4) * 4)
  // A smaller grid and fewer vertices are served by the one kept, nothing is made.
  assert.equal(grids.lit([8, 8], 1), first)
  assert.equal(radiance().length, 1)
  // A larger one makes another sized on the asked alone, not on the most seen.
  const second = grids.lit([32, 8], 1)
  assert.notEqual(second, first)
  assert.equal(radiance().at(-1)?.size, 32 * 8 * 8 * 4)
  // A path of more vertices than the kept one makes another; on a device whose binding holds the widest state alone, that path does not fit (`litFits`).
  const small = createReflectionGrids(gpu, 'small', [64, 64])
  const wide = small.lit([32, 8], 1)
  assert.equal(small.lit([16, 8], 1), wide)
  assert.notEqual(small.lit([32, 8], 2), wide)
  const tight = { limits: { maxStorageBufferBindingSize: 32 * 8 * 8 * 4, maxBufferSize: 1 << 28 } }
  assert.equal(litFits(tight as GPUDevice, [32, 8], 1), true)
  assert.equal(litFits(tight as GPUDevice, [32, 8], 2), false)
})

test('the hit lighting’s state larger than the images ask is let go when a window of images has asked for less, and kept while one asks for it', () => {
  installGpuGlobals()
  const { device, buffers } = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  })
  const grids = createReflectionGrids(device as unknown as GPUDevice, 'keep', [64, 64])
  const radiance = () => buffers.filter((made) => made.label?.includes('hit lighting radiance'))
  const big = grids.lit([32, 32], 1)
  // A window in which a larger grid is asked keeps the state.
  grids.keepLit(1, { grid: [32, 32], vertices: 1 })
  grids.keepLit(IDLE_KEEP_IMAGES + 1, { grid: [8, 8], vertices: 1 })
  assert.equal(grids.lit([8, 8], 1), big)
  // The next window asks 8 x 8 only: at its end the state is let go and the next ask makes one of that size.
  grids.keepLit(2 * IDLE_KEEP_IMAGES + 2, { grid: [8, 8], vertices: 1 })
  const small = grids.lit([8, 8], 1)
  assert.notEqual(small, big)
  assert.equal(radiance().at(-1)?.size, 8 * 8 * 8 * 4)
})

test('the hits’ buffer larger than the images ask is let go when a window of images has asked for less', () => {
  installGpuGlobals()
  const { device } = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  })
  const grids = createReflectionGrids(device as unknown as GPUDevice, 'hits', [64, 64])
  const big = grids.hits(4, [32, 32])
  grids.keepLit(1)
  grids.keepLit(IDLE_KEEP_IMAGES + 1)
  // The first window asked the big one: kept, and a smaller ask is served by it.
  assert.equal(grids.hits(4, [8, 8]), big)
  grids.keepLit(IDLE_KEEP_IMAGES + 2)
  grids.keepLit(2 * IDLE_KEEP_IMAGES + 2)
  // The second window asked 8 x 8 alone: the big buffer went, the next ask makes one of that size.
  assert.notEqual(grids.hits(4, [8, 8]), big)
})
