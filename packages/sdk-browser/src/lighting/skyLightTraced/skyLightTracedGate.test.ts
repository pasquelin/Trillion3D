import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RayTracedSkyLightSettings } from '../../../../sdk-core/src/contracts/rayTracedSkyLightOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { setSkyLightSource } from '../../frame/render/skyLightState.ts'
import {
  skyLightHairVoxels,
  skyLightTracedCounts,
  skyLightTracedSettings,
} from './skyLightTracedGate.ts'
import { SKY_RAYS_SIDE } from './skyLightTracedWgsl.ts'

const device = (storageBuffers = 10, binding = 16) =>
  ({
    limits: {
      maxStorageBufferBindingSize: binding,
      maxBufferSize: binding,
      maxStorageBuffersPerShaderStage: storageBuffers,
    },
  }) as unknown as GPUDevice

const runtime = (frame = 1, hair?: object) =>
  ({
    gpu: { viewKey: {}, hair },
    run: { frame },
    context: {},
  }) as unknown as WebgpuPagesRuntime

const hairOf = (jitterMode: number) => ({
  visible: true,
  inputs: { voxel: { jitterMode, densityScaleRaytracing: 2, steppingScaleRaytracing: 3 } },
  voxel: { set: { paramsBuffer: {} } },
})

test('the rays a pixel casts are held to the directions’ buffer only where the generation is decoupled', () => {
  const rt = runtime()
  setSkyLightSource(rt, { part: { light: { samplesPerPixel: 4 } } } as never)
  const settings = (decoupled: boolean) =>
    ({
      rayTracedSkyLightSamplesPerPixel: -1,
      rayTracedSkyLightDecoupleSampleGeneration: decoupled,
      rayTracedSkyLightDenoiser: false,
    }) as unknown as RayTracedSkyLightSettings
  assert.equal(skyLightTracedCounts(rt, device(), SKY_RAYS_SIDE, settings(true)).samples, 1)
  assert.equal(skyLightTracedCounts(rt, device(), SKY_RAYS_SIDE, settings(false)).samples, 4)
})

test('the strands’ voxels are a view’s own held object, refilled in place and not shared with another view', () => {
  const settings = {
    rayTracedSkyLightHairVoxel: true,
    rayTracedSkyLightHairOcclusionThreshold: 2,
  } as RayTracedSkyLightSettings
  const first = runtime(1, hairOf(1))
  const second = runtime(1, hairOf(2))
  const a = skyLightHairVoxels(first, device(), settings)!
  const b = skyLightHairVoxels(second, device(), settings)!
  assert.notEqual(a, b)
  assert.equal(a.jitter, 1)
  assert.equal(b.jitter, 2)
  assert.equal(a.occlusion, 2)
  assert.equal(skyLightHairVoxels(first, device(), settings), a)
  assert.equal(skyLightHairVoxels(first, device(8), settings), undefined)
})

test('a view’s settings are resolved once an image', () => {
  const rt = runtime(5)
  const settings = skyLightTracedSettings(rt)
  settings.rayTracedSkyLightMaxRayDistance = 123
  assert.equal(skyLightTracedSettings(rt).rayTracedSkyLightMaxRayDistance, 123)
  rt.run.frame = 6
  assert.equal(skyLightTracedSettings(rt), settings)
  assert.notEqual(settings.rayTracedSkyLightMaxRayDistance, 123)
})
