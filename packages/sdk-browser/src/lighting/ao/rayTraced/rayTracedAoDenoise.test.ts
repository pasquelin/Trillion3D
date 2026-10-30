// The ray-traced occlusion's denoiser: a view rests only once its history has settled (a tenth of the limit is left), and a pass that is switched off leaves the rays' own occlusion.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { RayTracedAmbientOcclusionSettings } from '../../../../../sdk-core/src/contracts/rayTracedAmbientOcclusionOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { ambientOcclusionSettling } from '../frame.ts'
import { denoiseRayTracedAo, RAY_TRACED_AO_SETTLING_IMAGES } from './rayTracedAoDenoise.ts'

const runtime = (frame: number, changedAt: number, denoised: boolean) =>
  ({
    gpu: {
      ambientOcclusion: { output: {}, denoised, settings: { method: 'disc', horizon: {} } },
    },
    run: { frame, gate: { hold: { noise: { changedAt } } } },
  }) as unknown as WebgpuPagesRuntime

test('a view settles after nine tenths of the 256 samples its history is held to', () => {
  assert.equal(RAY_TRACED_AO_SETTLING_IMAGES, 231)
  assert.equal(ambientOcclusionSettling(runtime(230, 0, true)), true)
  assert.equal(ambientOcclusionSettling(runtime(231, 0, true)), false)
})

test('a view whose occlusion is not accumulated rests at once', () => {
  assert.equal(ambientOcclusionSettling(runtime(1, 0, false)), false)
})

test('a denoiser switched off, or with no ray, leaves the rays’ occlusion and accumulates nothing', () => {
  const rt = { gpu: {} } as unknown as WebgpuPagesRuntime
  const options = { denoiser: false, samples: 1, temporalAccumulation: true }
  const run = (settings: Partial<RayTracedAmbientOcclusionSettings>) =>
    denoiseRayTracedAo(
      rt,
      {} as GPUCommandEncoder,
      {} as never,
      { ...options, ...settings } as RayTracedAmbientOcclusionSettings,
      {} as GPUTextureView,
    )
  assert.equal(run({}), false)
  assert.equal(run({ denoiser: true, samples: 0 }), false)
})
