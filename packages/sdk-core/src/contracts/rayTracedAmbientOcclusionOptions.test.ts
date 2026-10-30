import assert from 'node:assert/strict'
import test from 'node:test'
import { AMBIENT_OCCLUSION_RULES, resolveAmbientOcclusion } from './ambientOcclusionOptions.ts'
import { resolveSettings } from './settingRules.ts'

test('the ray-traced occlusion’s denoiser reads its numbers from the settings, the reference’s defaults where unset', () => {
  const read = (options: Parameters<typeof resolveSettings<typeof AMBIENT_OCCLUSION_RULES>>[1]) =>
    resolveAmbientOcclusion(resolveSettings(AMBIENT_OCCLUSION_RULES, options)).rayTraced
  const names = [
    'denoiser',
    'reconstructionSamples',
    'preConvolution',
    'kernelSpread',
    'temporalAccumulation',
    'historyConvolutionSamples',
    'historyConvolutionSpread',
  ] as const
  const numbers = (settings: ReturnType<typeof read>) => names.map((name) => settings[name])
  assert.deepEqual(numbers(read({})), [true, 16, 2, 4, true, 1, 7])
  assert.deepEqual(
    numbers(
      read({
        rayTracedAmbientOcclusionDenoiser: false,
        rayTracedAmbientOcclusionDenoiserReconstructionSamples: 8,
        rayTracedAmbientOcclusionDenoiserPreConvolution: 3,
        rayTracedAmbientOcclusionDenoiserKernelSpreadFactor: 6,
        rayTracedAmbientOcclusionDenoiserTemporalAccumulation: false,
        rayTracedAmbientOcclusionDenoiserHistoryConvolutionSamples: 4,
        rayTracedAmbientOcclusionDenoiserHistoryConvolutionKernelSpreadFactor: 2,
      }),
    ),
    [false, 8, 3, 6, false, 4, 2],
  )
})
