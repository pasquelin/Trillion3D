import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { destroyRetired } from '../gpu/core/frameRetire.ts'
import {
  VOLUME_HOLDOUT_FORMAT,
  clearVolumeHoldout,
  holdoutAddWgsl,
  volumeHoldoutOf,
} from './volumeHoldout.ts'

/** A runtime whose film settings are `film` and whose images are drawn at `size`. */
const runtime = (film: object, size = [64, 32]) =>
  ({ context: { ...film }, gpu: { targetSize: [...size] } }) as unknown as WebgpuPagesRuntime
const HOLDOUT = { propagateAlpha: true, primitiveAlphaHoldout: true }

test('no holdout target while the alpha holdout is not in effect', () => {
  const { device } = fakeDevice()
  assert.equal(volumeHoldoutOf(runtime({}), device), undefined)
  assert.equal(volumeHoldoutOf(runtime({ propagateAlpha: true }), device), undefined)
  assert.equal(volumeHoldoutOf(runtime({ primitiveAlphaHoldout: true }), device), undefined)
})

test('with the holdout in effect the target is made once at the render grid, again where it moved, given back when it ends', () => {
  const { device, textures, destroyed } = fakeDevice()
  const rt = runtime(HOLDOUT)
  const first = volumeHoldoutOf(rt, device)
  assert.ok(first)
  assert.equal(first.format, VOLUME_HOLDOUT_FORMAT)
  assert.deepEqual(first.size, [64, 32])
  assert.equal(volumeHoldoutOf(rt, device)?.view, first.view, 'kept from image to image')
  assert.equal(textures.length, 1)
  rt.gpu.targetSize[0] = 128
  const second = volumeHoldoutOf(rt, device)
  assert.notEqual(second?.view, first.view)
  assert.equal(textures.length, 2)
  // The old texture may still be named by this image's commands: retired, destroyed after the submit.
  assert.equal(destroyed.length, 0)
  destroyRetired(device)
  assert.deepEqual(destroyed, [textures[0]])
  ;(rt.context as unknown as Record<string, unknown>).primitiveAlphaHoldout = false
  assert.equal(volumeHoldoutOf(rt, device), undefined)
  assert.equal(textures.length, 2, 'ending the holdout makes nothing')
  destroyRetired(device)
  assert.deepEqual(destroyed, [textures[0], textures[1]], 'and gives the target back')
  // A grid with no texel asks for none.
  assert.equal(volumeHoldoutOf(runtime(HOLDOUT, [0, 0]), device), undefined)
})

test('the clear is a pass that clears the target to zero', () => {
  const { device } = fakeDevice()
  const target = volumeHoldoutOf(runtime(HOLDOUT), device)!
  const passes: GPURenderPassDescriptor[] = []
  const encoder = {
    beginRenderPass: (descriptor: GPURenderPassDescriptor) => (
      passes.push(descriptor),
      { end() {} }
    ),
  } as unknown as GPUCommandEncoder
  clearVolumeHoldout(encoder, target)
  assert.equal(passes.length, 1)
  const [attachment] = [...(passes[0].colorAttachments as GPURenderPassColorAttachment[])]
  assert.equal(attachment.view, target.view)
  assert.equal(attachment.loadOp, 'clear')
  assert.deepEqual(attachment.clearValue, [0, 0, 0, 0])
})

test('holdoutAdd loads the pixel’s holdout and stores it with the delta added', () => {
  const stored: unknown[] = []
  const texture = {
    load: () => [0.25],
    // A 2D store has no layer: the value comes second to last.
    store: (coords: number[], a: unknown, b: unknown) => stored.push([coords, b ?? a]),
  }
  const { holdoutAdd } = shaderRun<{ holdoutAdd: (p: number[], delta: number) => void }>(
    wgslProgram('', [holdoutAddWgsl(0, 3)]),
    ['holdoutAdd'],
    { holdout: texture },
  )
  holdoutAdd([3, 4], 0.5)
  assert.deepEqual(stored, [
    [
      [3, 4],
      [0.75, 0, 0, 0],
    ],
  ])
  assert.match(
    holdoutAddWgsl(1, 2).text,
    /@group\(1\) @binding\(2\) var holdout:texture_storage_2d<r32float,read_write>;/,
  )
})
