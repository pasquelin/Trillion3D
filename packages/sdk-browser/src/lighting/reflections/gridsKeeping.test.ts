// The grids' keeping windows fold at the end of every image they live, the image's own asks included (`keepReflectionGrids`, `grids.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { IDLE_KEEP_IMAGES } from '../../gpu/core/idleKeep.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { keepReflectionGrids } from './frame.ts'
import { createReflectionGrids } from './grids.ts'

const gridsOf = () => {
  installGpuGlobals()
  const { device } = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  })
  return createReflectionGrids(device as unknown as GPUDevice, 'keep', [64, 64])
}

test('images that trace nothing (screen reflections) still fold the windows, so the hit lighting’s state is let go after the window', () => {
  const grids = gridsOf()
  const front = gridsOf()
  const reflection = {
    grids,
    front: { grids: front },
    litAsk: { set: false, grid: [0, 0] as [number, number], vertices: 0 },
  }
  const rt = (frame: number) =>
    ({ gpu: { reflection }, run: { frame } }) as unknown as WebgpuPagesRuntime
  const big = grids.lit([32, 32], 1)
  const bigFront = front.lit([32, 32], 1)
  // The trace records its ask; the one fold at the end of the image takes it and leaves none for the next image.
  Object.assign(reflection.litAsk, { set: true, grid: [32, 32], vertices: 1 })
  keepReflectionGrids(rt(1))
  assert.equal(reflection.litAsk.set, false)
  // The view then switches to screen reflections: no trace, no ask.
  for (let frame = 2; frame <= 3 * IDLE_KEEP_IMAGES; frame++) keepReflectionGrids(rt(frame))
  assert.notEqual(grids.lit([8, 8], 1), big)
  assert.notEqual(front.lit([8, 8], 1), bigFront)
})

test('the hits asked by an image are folded at its end: the window keeps the big buffer the first window asked, and lets it go when the second asks less', () => {
  const grids = gridsOf()
  // An image asks its hits, then ends (`keepLit`).
  const image = (frame: number, edge: number) => {
    const buffer = grids.hits(4, [edge, edge])
    grids.keepLit(frame)
    return buffer
  }
  const big = image(0, 32)
  for (let frame = 1; frame < 2 * IDLE_KEEP_IMAGES; frame++)
    assert.equal(image(frame, 8), big, `kept at image ${frame}`)
  // The second window asked 8 x 8 alone: the big buffer goes at the end of its last image, the next image makes a smaller one.
  assert.equal(image(2 * IDLE_KEEP_IMAGES, 8), big)
  assert.notEqual(image(2 * IDLE_KEEP_IMAGES + 1, 8), big)
})
