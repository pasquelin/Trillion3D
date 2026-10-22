// A lit composition finishes the image — its local exposure, the bloom's glow, its vignette —
// through pipelines compiled off the frame at the first that asks; handed the group that carries
// them, it binds it as group 1. A program that finishes nothing, the unlit view's, has none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompositions } from './compositions.ts'
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from './shaders.ts'
import { lobelessLighting } from './recorder.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { EXPOSURE_RULES } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { ExposureSettings } from '../../post/exposure/meterParams.ts'
import { FINISH } from '../../post/finish/finishLayout.ts'
import { writeFinishParams, type FinishInput } from '../../post/finish/finishParams.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'

test('the finishing compositions compile off the frame at the first that asks, for every input', async () => {
  const { device, renderPipelines, pipelineLayouts } = fakeDevice()
  const compositions = await createCompositions(device, CONTRACT_COMPOSITIONS, 'LIT')
  const compiled = renderPipelines.length,
    failures: unknown[] = []
  assert.throws(() => compositions.pipelines('still', true), /not compiled/)
  assert.equal(
    compositions.composesFinish((...failure) => failures.push(failure)),
    false,
    'compiling',
  )
  await new Promise((resolve) => setTimeout(resolve))
  assert.equal(renderPipelines.length, compiled + 6, 'three inputs, capture and present')
  assert.equal(
    compositions.composesFinish((...failure) => failures.push(failure)),
    true,
  )
  for (const input of ['still', 'accumulated', 'flagless'] as const) {
    const { draw, present } = compositions.pipelines(input, true)
    // The fake device's pipeline is the descriptor it was made from.
    const made = draw as unknown as GPURenderPipelineDescriptor
    assert.match(made.fragment!.module.label!, /^LIT_COMPOSE_FINISH_/)
    assert.equal(compositions.pipelines(input, false).draw === draw, false, 'a pipeline of its own')
    assert.ok(present)
  }
  // The finishing's group is group 1 of every one of them, the image's group 0.
  const layouts = pipelineLayouts.slice(-6).map((layout) => [...layout.bindGroupLayouts].length)
  assert.deepEqual(layouts, [2, 2, 2, 2, 2, 2])
  assert.deepEqual(failures, [])
})

test('a program that finishes nothing never composes it, whatever it is asked', async () => {
  const { device, renderPipelines } = fakeDevice()
  const compositions = await createCompositions(device, UNLIT_COMPOSITIONS, 'UNLIT')
  const compiled = renderPipelines.length
  assert.equal(
    compositions.composesFinish(() => assert.fail('nothing to compile')),
    false,
  )
  await new Promise((resolve) => setTimeout(resolve))
  assert.equal(renderPipelines.length, compiled)
  assert.throws(() => compositions.pipelines('flagless', true), /not compiled/)
})

test('a composition handed the finishing’s group binds it as group 1, one handed none binds one group', async () => {
  const { gpu, lighting } = await lobelessLighting()
  const view = () => ({}) as GPUTextureView
  const image = { color: view(), share: view() },
    finish = {} as GPUBindGroup,
    failures: unknown[] = []
  lighting.composesFinish((...failure) => failures.push(failure))
  await new Promise((resolve) => setTimeout(resolve))
  assert.equal(
    lighting.composesFinish((...failure) => failures.push(failure)),
    true,
  )
  const encoder = gpu.device.createCommandEncoder()
  gpu.passes.length = 0
  lighting.compose(encoder, view(), [0, 0, 0, 1], undefined, { ...image, finish })
  lighting.compose(encoder, view(), [0, 0, 0, 1], undefined, image)
  const passes = gpu.passes.map(({ commands }) => ({
    pipeline: commandArgs(commands, 'setPipeline')[0][0] as GPURenderPipelineDescriptor,
    groups: commandArgs(commands, 'setBindGroup'),
  }))
  assert.match(passes[0].pipeline.fragment!.module.label!, /_COMPOSE_FINISH_ACCUMULATED$/)
  assert.match(passes[1].pipeline.fragment!.module.label!, /_COMPOSE_ACCUMULATED$/)
  assert.deepEqual(passes[0].groups[1], [1, finish])
  assert.equal(passes[1].groups.length, 1, 'no finishing, no second group')
  assert.equal(passes[0].groups[0][1], passes[1].groups[0][1], 'one group per image read')
  assert.deepEqual(failures, [])
  lighting.dispose()
})

/** The finishing's uniform as the shader's `finish`: each field its four words, for the finishing
 *  functions the shipped text runs in doubles. */
function finishScope(options: Partial<ExposureSettings>, input: Partial<FinishInput> = {}) {
  const settings = { ...resolveSettings(EXPOSURE_RULES, {}), ...options } as ExposureSettings
  const words = new Float32Array(FINISH.words)
  writeFinishParams(words, {
    settings,
    vignette: 0.4,
    auto: true,
    local: true,
    glow: false,
    size: [1920, 1080],
    ...input,
  })
  const field = (at: number) => [...words.subarray(at, at + 4)]
  const finish = Object.fromEntries(
    Object.entries(FINISH.at).map(([name, at]) => [name, field(at)]),
  )
  return { finish, words, settings }
}
const smoothstep = (low: number, high: number, x: number) => {
  const t = Math.min(Math.max((x - low) / (high - low), 0), 1)
  return t * t * (3 - 2 * t)
}
/** The multiplier the local exposure gives a pixel, from the layers' definition: the base's
 *  distance to middle grey past its threshold scaled by the contrast, the detail by its strength. */
function layered(
  logExposed: number,
  base: number,
  grey: number,
  s: ExposureSettings,
  thresholds = true,
) {
  let centred = base - grey
  const high = centred > 0,
    contrast = high ? s.localExposureHighlightContrast : s.localExposureShadowContrast
  const threshold = high ? s.localExposureHighlightThreshold : s.localExposureShadowThreshold
  const strength = high
    ? s.localExposureHighlightThresholdStrength
    : s.localExposureShadowThresholdStrength
  const kept = high ? Math.max(0, centred - threshold) : Math.min(0, centred + threshold)
  const t = smoothstep(threshold, threshold + 1 / (1 - strength), Math.abs(centred))
  const shift = thresholds ? (centred - kept) * (1 - t) : 0
  centred -= shift
  const detail = (logExposed - base) * s.localExposureDetailStrength
  return 2 ** (grey + shift + centred * contrast + detail - logExposed)
}

test('the finishing’s vignette is the cosine-fourth falloff, 1 at the centre', () => {
  for (const [size, strength] of [
    [[1920, 1080], 0.4],
    [[1000, 1000], 1],
    [[400, 1200], 0.25],
  ] as const) {
    const { finish } = finishScope({}, { size, vignette: strength })
    const { vignetteMask } = shaderRun<{ vignetteMask: (uv: number[]) => number }>(
      CONTRACT_COMPOSITIONS.finish.accumulated,
      ['vignetteMask'],
      { finish },
    )
    assert.equal(vignetteMask([0.5, 0.5]), 1)
    // The corner is on the circle through the corners, whatever the aspect: 1 / (1 + 2 v²)².
    const corner = 1 / (1 + 2 * strength ** 2) ** 2
    for (const uv of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ])
      assert.ok(Math.abs(vignetteMask(uv) - corner) < 1e-6, `${size} ${uv}`)
    assert.ok(vignetteMask([0.25, 0.5]) > corner && vignetteMask([0.25, 0.5]) < 1)
  }
})

test('the local exposure moves a pixel by its layers, as their definition says, the thresholds too', () => {
  const grid = { cell: [0, 0] }
  const run = (options: Partial<ExposureSettings>, exposure: number) => {
    const { finish, settings } = finishScope(options)
    finish.look[1] = exposure
    const scope = {
      finish,
      grid: 'grid',
      blurredLog: 'blurred',
      finishSampler: 'sampler',
      textureSampleLevel: (texture: string) =>
        texture === 'grid' ? [...grid.cell, 0, 0] : [-1.5, 0, 0, 0],
    }
    const fns = shaderRun<{
      localGain: (logLight: number, uv: number[]) => number
      baseLog: (logLight: number, uv: number[]) => number
    }>(CONTRACT_COMPOSITIONS.finish.accumulated, ['localGain', 'baseLog'], scope)
    return { ...fns, settings, grey: finish.base[0] }
  }
  // The grey is 0.18 × 2² (the exposure's bias, 1, plus the local one, 0 — the unit of two).
  const exposure = 0.5
  for (const options of [
    {},
    { localExposureHighlightThreshold: 0.5, localExposureHighlightThresholdStrength: 0.5 },
    { localExposureShadowThreshold: 1, localExposureShadowThresholdStrength: 0 },
    { localExposureDetailStrength: 0.25, localExposureBlurBlend: 0 },
    { localExposureBlurBlend: 1, localExposureMiddleGreyBias: -1 },
  ] as Partial<ExposureSettings>[]) {
    const { localGain, baseLog, settings, grey } = run(options, exposure)
    const expectedGrey = Math.log2(0.18 * 2 * 2 ** settings.localExposureMiddleGreyBias)
    assert.ok(Math.abs(grey - expectedGrey) < 1e-6)
    for (const bilateral of [-6, -2, -0.5, 1, 3]) {
      // A cell holding pixels (weight 64): its ratio is the bilateral log luminance.
      grid.cell = [bilateral * 64, 64]
      for (const light of [-7, -3, -1, 0.5, 2, 5]) {
        const logExposed = light + Math.log2(exposure)
        const blend = settings.localExposureBlurBlend
        const base = bilateral * (1 - blend) + -1.5 * blend + Math.log2(exposure)
        assert.ok(Math.abs(baseLog(light, [0.3, 0.6]) - base) < 1e-6, 'the base layer')
        const expected = layered(logExposed, base, grey, settings)
        const gain = localGain(light, [0.3, 0.6])
        assert.ok(Math.abs(gain - expected) < 1e-6 * Math.max(1, expected), `${bilateral} ${light}`)
      }
    }
    // A cell with no pixel in it: the blurred luminance alone is the base layer.
    grid.cell = [0, 0]
    assert.ok(Math.abs(baseLog(1, [0.5, 0.5]) - (-1.5 + Math.log2(exposure))) < 1e-9)
  }
})
