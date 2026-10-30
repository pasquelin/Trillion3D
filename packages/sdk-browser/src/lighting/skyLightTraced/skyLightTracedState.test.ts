import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RayTracedSkyLightSettings } from '../../../../sdk-core/src/contracts/rayTracedSkyLightOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { skyLightRaysMost } from './skyLightTracedGate.ts'
import { skyLightImageWeight, skyLightSettlingImages } from './skyLightTracedDenoise.ts'
import { skyLightTracedSettling } from './skyLightTracedFrame.ts'
import { SKY_RAYS_SIDE } from './skyLightTracedWgsl.ts'
import { skyLightTracedViewOf, skyLightViewOf } from './skyLightTracedState.ts'

Object.assign(globalThis, {
  GPUTextureUsage: { STORAGE_BINDING: 8, TEXTURE_BINDING: 4 },
  GPUBufferUsage: { STORAGE: 128 },
})

const device = () => {
  const made: { size: unknown; format?: string }[] = []
  return {
    made,
    limits: { maxStorageBufferBindingSize: 1 << 27, maxBufferSize: 1 << 28 },
    createTexture: (descriptor: { size: unknown; format: string }) => (
      made.push(descriptor),
      { createView: () => ({}), destroy() {} }
    ),
    createBuffer: (descriptor: { size: number }) => (made.push(descriptor), { destroy() {} }),
  }
}

const runtime = (frame: number, changedAt: number) =>
  ({
    gpu: { viewKey: {} },
    run: { frame, gate: { hold: { noise: { changedAt } } } },
  }) as unknown as WebgpuPagesRuntime

test('the directions of 256 by 256 pixels fit the device at 128 rays a pixel of its default 128 MiB binding', () => {
  assert.equal(skyLightRaysMost(device() as unknown as GPUDevice, SKY_RAYS_SIDE), 128)
  const small = { limits: { maxStorageBufferBindingSize: 16, maxBufferSize: 16 } }
  assert.equal(skyLightRaysMost(small as unknown as GPUDevice, SKY_RAYS_SIDE), 1)
})

test('a view casts one ray cell for each block of upscale pixels, and its directions buffer holds a record for each ray', () => {
  const rt = runtime(1, 0)
  const gpu = device()
  const view = skyLightTracedViewOf(rt, gpu as unknown as GPUDevice, 1001, 563, 3, 4, true)
  assert.deepEqual(view.cells, [334, 188])
  assert.deepEqual(
    gpu.made.map(({ size }) => size),
    [[334, 188], [334, 188], SKY_RAYS_SIDE * SKY_RAYS_SIDE * 4 * 16],
  )
  assert.equal(skyLightTracedViewOf(rt, gpu as unknown as GPUDevice, 1001, 563, 3, 4, true), view)
  assert.equal(skyLightViewOf(rt.gpu), view)
})

test('where each pixel draws its own, the directions are one record', () => {
  const gpu = device()
  skyLightTracedViewOf(runtime(1, 0), gpu as unknown as GPUDevice, 64, 64, 1, 4, false)
  assert.equal(gpu.made.at(-1)!.size, 16)
})

test('the denoiser settles a view after nine tenths of the history it is held to, at the weight an image adds', () => {
  const settings = {
    rayTracedSkyLightDenoiserReconstructionSamples: 16,
    rayTracedSkyLightDenoiserPreConvolution: 1,
  } as RayTracedSkyLightSettings
  // 4 rays, 16 reconstruction samples, the 7 taps of one web.
  assert.equal(skyLightImageWeight(settings, 4), 448)
  assert.equal(skyLightSettlingImages(448), 9)
  assert.equal(skyLightSettlingImages(0), 3687)
  const rt = runtime(5, 0)
  const view = skyLightTracedViewOf(rt, device() as unknown as GPUDevice, 8, 8, 1, 4, false)
  view.accumulates = true
  view.imageWeight = 448
  assert.equal(skyLightTracedSettling(rt), true)
  assert.equal(
    skyLightTracedSettling({ ...rt, run: { ...rt.run, frame: 9 } } as WebgpuPagesRuntime),
    false,
  )
  view.accumulates = false
  assert.equal(skyLightTracedSettling(rt), false)
})
