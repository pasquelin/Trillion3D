// The arithmetic of the atlas's layout: the size a picture is wanted at, the mip levels of a slot and of the atlas.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  alignSlotSize,
  atlasMipCount,
  newRect,
  slotMaxMipLevel,
  sourceResolution,
  toMip,
} from './layout.ts'

const image = (width: number, height: number) => ({ width, height })

test('a picture is wanted at the share of it the light shows', () => {
  assert.deepEqual(sourceResolution(image(512, 256), [1, 1, 0, 0], 2), { x: 512, y: 256 })
  assert.deepEqual(sourceResolution(image(512, 512), [0.5, 0.25, 0, 0], 4), { x: 256, y: 128 })
  assert.deepEqual(sourceResolution(undefined, [1, 1, 0, 0], 2), { x: 1, y: 1 })
})

test('a picture longer than the ratio has its short side stretched to keep it', () => {
  // 2048 by 256 is 8 to 1: past 2, the height is stretched 4 times (8 / 2).
  assert.deepEqual(sourceResolution(image(2048, 256), [1, 1, 0, 0], 2), { x: 2048, y: 1024 })
  // The other way round, the width.
  assert.deepEqual(sourceResolution(image(256, 2048), [1, 1, 0, 0], 2), { x: 1024, y: 2048 })
  // A ratio of 1 makes every picture square-ish; the ratio is held to 16 at most.
  assert.deepEqual(sourceResolution(image(1024, 256), [1, 1, 0, 0], 1), { x: 1024, y: 1024 })
  assert.deepEqual(sourceResolution(image(4096, 128), [1, 1, 0, 0], 100), { x: 4096, y: 256 })
})

test('mip arithmetic rounds up, and a slot is read to its short side’s log2 less one', () => {
  assert.deepEqual(toMip({ x: 5, y: 7 }, 1), { x: 3, y: 4 })
  assert.deepEqual(toMip({ x: 256, y: 128 }, 3), { x: 32, y: 16 })
  assert.equal(slotMaxMipLevel({ x: 256, y: 128 }), 6)
  assert.equal(slotMaxMipLevel({ x: 3, y: 3 }), 0)
  assert.equal(slotMaxMipLevel({ x: 1, y: 1 }), 0)
  assert.equal(slotMaxMipLevel({ x: 100, y: 300 }), 5)
})

test('a slot is aligned on the power of two of its last level, so that no level leaks into a neighbour', () => {
  const r = newRect()
  r.size = { x: 100, y: 300 }
  alignSlotSize(r)
  // Short side 100: floor(log2) 6, less 1: level 5, a multiple of 32.
  assert.deepEqual(r.size, { x: 128, y: 320 })
  const small = newRect()
  small.size = { x: 3, y: 5 }
  alignSlotSize(small)
  assert.deepEqual(small.size, { x: 3, y: 5 }, 'at level 0 there is nothing to align')
})

test('the atlas has the levels its short side holds, less the last', () => {
  assert.equal(atlasMipCount({ x: 256, y: 256 }), 8)
  assert.equal(atlasMipCount({ x: 4096, y: 4096 }), 12)
  assert.equal(atlasMipCount({ x: 1024, y: 256 }), 8)
})

test('a slot is a whole number of texels at the last level of the size it ends with', () => {
  const rect = newRect()
  rect.size = { x: 63, y: 100 }
  alignSlotSize(rect)
  const max = slotMaxMipLevel(rect.size)
  assert.equal(rect.size.x % 2 ** max, 0)
  assert.equal(rect.size.y % 2 ** max, 0)
})
