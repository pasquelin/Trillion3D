// The words the atlas's passes read: slot buffers, the picture's share, the pass's figures, and the slots a mip level still holds.
import test from 'node:test'
import assert from 'node:assert/strict'
import { freeSlot, type AtlasRect } from './layout.ts'
import {
  FIGURE_BYTES,
  copyRects,
  figureBytes,
  filterRects,
  holdsMip,
  scaleOffsetWords,
  slotWords,
} from './slotData.ts'

const rect = (x: number, y: number, w: number, h: number): AtlasRect => ({
  origin: { x, y },
  size: { x: w, y: h },
})

test('a slot is four words, its origin then its size, and an empty list is one zero slot a buffer can bind', () => {
  assert.deepEqual([...slotWords([rect(1, 2, 3, 4), rect(5, 6, 7, 8)])], [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual([...slotWords([])], [0, 0, 0, 0])
})

test('the share and offset of each picture are four floats a slot', () => {
  const a = freeSlot()
  a.scaleOffset = [0.5, 0.25, 0.125, 0.75]
  assert.deepEqual([...scaleOffsetWords([a, freeSlot()])], [0.5, 0.25, 0.125, 0.75, 1, 1, 0, 0])
})

test('the pass’s figures are laid out as the shader reads them', () => {
  const bytes = figureBytes({
    atlas: { x: 256, y: 128 },
    hasScaleOffset: true,
    mipBias: 2,
    mip: 3,
    quality: 1,
    source: { x: 512, y: 256 },
  })
  assert.equal(bytes.byteLength, FIGURE_BYTES)
  const f = new Float32Array(bytes)
  const i = new Int32Array(bytes)
  assert.deepEqual([f[0], f[1]], [256, 128])
  assert.deepEqual([i[2], i[3], i[4], i[5]], [1, 2, 3, 1])
  assert.deepEqual([f[6], f[7]], [512, 256])
})

test('a mip level is held by a slot while both sides keep more than one texel', () => {
  assert.equal(holdsMip({ x: 64, y: 64 }, 5), true)
  assert.equal(holdsMip({ x: 64, y: 64 }, 6), false)
  assert.equal(holdsMip({ x: 256, y: 16 }, 3), true)
  assert.equal(holdsMip({ x: 256, y: 16 }, 4), false)
})

test('the slots copied at a level are where they were and where they go, at that level’s size', () => {
  const copies = [
    {
      id: 0,
      srcOrigin: { x: 0, y: 0 },
      dstOrigin: { x: 64, y: 32 },
      size: { x: 64, y: 64 },
      source: { width: 1, height: 1 },
    },
    {
      id: 1,
      srcOrigin: { x: 64, y: 0 },
      dstOrigin: { x: 0, y: 0 },
      size: { x: 8, y: 8 },
      source: { width: 1, height: 1 },
    },
  ]
  const level0 = copyRects(copies, 0)
  assert.equal(level0.to.length, 2)
  const level2 = copyRects(copies, 2)
  assert.equal(level2.to.length, 2)
  assert.deepEqual(level2.to[0], rect(16, 8, 16, 16))
  assert.deepEqual(level2.from[0], rect(0, 0, 16, 16))
  const level3 = copyRects(copies, 3)
  assert.equal(level3.to.length, 1, 'the 8 by 8 slot has no level 3')
})

test('a level is filtered from the one over it, for the slots that hold it', () => {
  const slot = freeSlot()
  slot.rect = rect(64, 128, 32, 32)
  const level1 = filterRects([slot], 1)
  assert.deepEqual(level1.from[0], rect(64, 128, 32, 32))
  assert.deepEqual(level1.to[0], rect(32, 64, 16, 16))
  assert.equal(filterRects([slot], 5).to.length, 0)
})
