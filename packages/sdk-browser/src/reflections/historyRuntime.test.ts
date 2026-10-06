import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts'
import { createReflectionHistory } from './historyRuntime.ts'
import { stillHistoryFrame } from './historyFrame.fixture.ts'
import {
  REFLECTION_CHANGE_FRAMES,
  REFLECTION_CHANGE_KEPT,
  REFLECTION_STILL_FRAMES,
} from './resolveWgsl.ts'

// The last depth and identifiers are the reflection source's (`source.ts`).
const kept = { depth: {} as GPUTextureView, ids: {} as GPUTextureView }

test('first frame rejects history, replay consumes nothing, and a changed source lowers its confidence', () => {
  const gpu = fakeDevice()
  const history = createReflectionHistory(gpu.device, 8, 8, kept)
  const current = gpu.device.createTexture({ size: [8, 8], format: 'rgba16float', usage: 1 })
  const frame = stillHistoryFrame(current, 10)
  let draws = 0
  let viewport: number[] = []
  const encoder = {
    ...gpu.device.createCommandEncoder(),
    beginRenderPass: () => ({
      setViewport: (...values: number[]) => {
        viewport = values
      },
      setPipeline() {},
      setBindGroup() {},
      draw: () => draws++,
      end() {},
    }),
  } as unknown as GPUCommandEncoder
  const encode = () =>
    history.encode(encoder, current.createView(), {} as GPURenderPipeline, {} as GPUBindGroupLayout)
  const valid = () => gpu.writes.at(-1)!.data[36]
  const confidence = () => gpu.writes.at(-1)!.data[37]
  try {
    history.prepare(frame, IDENTITY_MATRIX4)
    assert.equal(valid(), 0)
    const first = encode()
    assert.equal(draws, 1)
    assert.equal(gpu.textureCopies.length, 1)
    history.prepare(frame, IDENTITY_MATRIX4)
    assert.equal(history.reuse, true)
    assert.equal(encode(), first)
    assert.equal(draws, 1)
    assert.equal(gpu.textureCopies.length, 1)
    frame.frame++
    history.prepare(frame, IDENTITY_MATRIX4)
    assert.equal(valid(), 1)
    assert.equal(history.rank, 1)
    assert.notEqual(encode(), first)
    assert.equal(draws, 2)
    assert.equal(confidence(), REFLECTION_STILL_FRAMES)
    // Same displayed frame, but a reflected object or residency changed: never reuse its old mean,
    // never restart from one sample either — the history keeps the change cap.
    frame.epoch[0]++
    history.prepare(frame, IDENTITY_MATRIX4)
    assert.equal(valid(), 1)
    assert.equal(confidence(), REFLECTION_CHANGE_KEPT)
    assert.equal(history.rank, 2)
    assert.equal(history.reuse, false)
    encode()
    assert.equal(draws, 3)
    // The change cap holds until the stale share is gone, then a full window closes it: a held
    // image keeps nothing of the previous reflection.
    for (let i = 1; i < REFLECTION_CHANGE_FRAMES + REFLECTION_STILL_FRAMES; i++) {
      frame.frame++
      history.prepare(frame, IDENTITY_MATRIX4)
      assert.equal(history.settled, false)
      assert.equal(history.reuse, false, `frame ${i} still refines`)
      assert.equal(
        confidence(),
        i < REFLECTION_CHANGE_FRAMES ? REFLECTION_CHANGE_KEPT : REFLECTION_STILL_FRAMES,
      )
      encode()
    }
    assert.equal(history.settled, true, 'the fixed work window is closed')
    const drawsAtCap = draws
    frame.frame++
    history.prepare(frame, IDENTITY_MATRIX4)
    encode()
    assert.equal(draws, drawsAtCap, 'a still source does not refine forever')
    const jittered = [...IDENTITY_MATRIX4]
    jittered[12] = 0.125
    history.prepare(frame, jittered)
    assert.equal(history.reuse, false, 'new jitter must reproject even after the work window')
    encode()
    for (const extent of [
      [4, 3],
      [8, 8],
    ]) {
      history.prepare(frame, jittered, extent)
      assert.equal(history.reuse, false, 'a drawn extent change invalidates frozen history')
      assert.equal(valid(), 0)
      assert.deepEqual(Array.from(gpu.writes.at(-1)!.data.slice(32, 34)), extent)
      encode()
      assert.deepEqual(viewport, [0, 0, ...extent, 0, 1])
    }
    const beforeLight = draws
    const clip = () => gpu.writes.at(-1)!.data[40]
    // A light changing each image (a brazier's flicker): the history is kept whole and clipped,
    // never restarted from one image's samples.
    for (let i = 0; i < 3; i++) {
      frame.lighting[0]++
      frame.frame++
      history.prepare(frame, IDENTITY_MATRIX4)
      assert.equal(history.settled, false)
      assert.equal(valid(), 1)
      assert.equal(clip(), 1)
      assert.equal(confidence(), REFLECTION_STILL_FRAMES)
      encode()
    }
    assert.equal(draws, beforeLight + 3, 'light changes resume in the same frame')
    // No motion brings a previous lighting to the current one: once it stops, the stale share is
    // flushed at the change weight before the still window closes.
    for (let i = 1; i < REFLECTION_CHANGE_FRAMES + REFLECTION_STILL_FRAMES; i++) {
      frame.frame++
      history.prepare(frame, IDENTITY_MATRIX4)
      assert.equal(history.settled, false)
      assert.equal(clip(), 0)
      assert.equal(
        confidence(),
        i < REFLECTION_CHANGE_FRAMES ? REFLECTION_CHANGE_KEPT : REFLECTION_STILL_FRAMES,
      )
      encode()
    }
    assert.equal(history.settled, true)
  } finally {
    history.dispose()
    history.dispose()
    current.destroy()
  }
  assert.equal(gpu.destroyed.length, 8, 'seven owned resources, each destroyed once, plus input')
})

test('resolve uniform refusal releases the complete history', () => {
  const gpu = fakeDevice({
    refuse: (descriptor) =>
      descriptor.label === 'Trillion3D reflection resolve view' ? 'throw' : undefined,
  })
  assert.throws(() => createReflectionHistory(gpu.device, 8, 8, kept), /NO_MEMORY/)
  assert.equal(gpu.destroyed.length, 6)
})
