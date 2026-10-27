// The images a capture draws of its view (`captureImages`, `drawCaptureImages`): `cutViewCaptureDelay`
// of them, at least one, the first being the one that finds the cut whole; the temporal pass is on for
// every one of them from four, and off for the last alone below four (the screenshot run-up of the reference).
import test from 'node:test'
import assert from 'node:assert/strict'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { captureImages, drawCaptureImages, startCaptureAccumulation } from './captureAside.ts'

const runtime = (context: object = {}) => ({ context }) as unknown as WebgpuPagesRuntime

test('a capture draws four images by default, and at least one', () => {
  assert.equal(captureImages(runtime()), 4)
  assert.equal(captureImages(runtime({ cutViewCaptureDelay: 9 })), 9)
  assert.equal(captureImages(runtime({ cutViewCaptureDelay: 1 })), 1)
  for (const delay of [0, -5])
    assert.equal(captureImages(runtime({ cutViewCaptureDelay: delay })), 1)
})

/** The `accumulates` each image after the first is asked to draw with, in order. */
async function drawn(images: number) {
  const seen: boolean[] = []
  let drawing = 0
  await drawCaptureImages(images, async (accumulates) => {
    assert.equal(++drawing, 1, 'one image at a time')
    seen.push(accumulates)
    await Promise.resolve()
    drawing--
  })
  return seen
}

test('the images after the first are drawn one after the other, the first being the settle’s', async () => {
  assert.equal((await drawn(4)).length, 3)
  assert.equal((await drawn(1)).length, 0, 'one image: the one that found the cut whole')
  assert.equal((await drawn(9)).length, 8)
})

test('from four images every one keeps the pass; below four the last is drawn without it', async () => {
  assert.deepEqual(await drawn(4), [true, true, true])
  assert.deepEqual(await drawn(8), Array(7).fill(true))
  assert.deepEqual(await drawn(3), [true, false])
  assert.deepEqual(await drawn(2), [false])
  assert.deepEqual(await drawn(1), [])
})

test('a capture of one image gives its view no pass; the others look at the main view’s', async () => {
  const rt = {
    views: { main: { gpu: {} }, active: {} },
    gpu: {},
  } as unknown as WebgpuPagesRuntime
  // The main view has no pass (`temporal` absent): nothing is rigged for any count.
  for (const images of [1, 2, 4]) await startCaptureAccumulation(rt, images)
  assert.deepEqual(rt.gpu, {}, 'no level was handed to the capture’s view')
})
