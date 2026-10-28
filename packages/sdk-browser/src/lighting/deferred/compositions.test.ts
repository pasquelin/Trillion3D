// A lit composition finishes the image — its local exposure, the bloom's glow, its vignette —
// through pipelines compiled off the frame at the first that asks; handed the group that carries
// them, it binds it as group 1. A program that finishes nothing, the unlit view's, has none. A lit
// composition reads the baked tone table, after the share it reads (`compositions.tone.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompositions } from './compositions.ts'
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from './shaders.ts'
import { lobelessLighting } from './recorder.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import type { ExposureValues } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { finishScope } from '../../post/finish/finishScope.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'

test('the finishing compositions compile off the frame at the first that asks, for every input', async () => {
  const { device, renderPipelines } = fakeDevice()
  const compositions = await createCompositions(device, CONTRACT_COMPOSITIONS, 'LIT')
  const compiled = renderPipelines.length,
    failures: unknown[] = []
  assert.throws(() => compositions.pipelines('asIs', true), /not compiled/)
  assert.equal(
    compositions.composesFinish((...failure) => failures.push(failure)),
    false,
    'compiling',
  )
  await new Promise((resolve) => setTimeout(resolve))
  // Two inputs since a debug view's as-is pixels are read from the surfaces whatever the image (a
  // still and an accumulated input read a share each).
  assert.equal(renderPipelines.length, compiled + 4, 'two inputs, capture and present')
  assert.equal(
    compositions.composesFinish((...failure) => failures.push(failure)),
    true,
  )
  for (const input of ['asIs', 'flagless'] as const) {
    const { draw, present } = compositions.pipelines(input, true)
    // The fake device's pipeline is the descriptor it was made from.
    const made = draw as unknown as GPURenderPipelineDescriptor
    assert.match(made.fragment!.module.label!, /^LIT_COMPOSE_FINISH_/)
    assert.equal(compositions.pipelines(input, false).draw === draw, false, 'a pipeline of its own')
    assert.ok(present)
    // The finishing's group is group 1 of both, the image's group 0.
    const groups = (pipeline: unknown) => [
      ...(pipeline as GPURenderPipelineDescriptor & { layout: GPUPipelineLayoutDescriptor }).layout
        .bindGroupLayouts,
    ]
    assert.equal(groups(draw).length, 2)
    assert.equal(groups(present).length, 2)
  }
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
  const image = { color: view() },
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
  // The as-is input: one for every image, the accumulated one gone with its share.
  assert.match(passes[0].pipeline.fragment!.module.label!, /_COMPOSE_FINISH_ASIS$/)
  assert.match(passes[1].pipeline.fragment!.module.label!, /_COMPOSE_ASIS$/)
  assert.deepEqual(passes[0].groups[1], [1, finish])
  assert.equal(passes[1].groups.length, 1, 'no finishing, no second group')
  assert.equal(passes[0].groups[0][1], passes[1].groups[0][1], 'one group per image read')
  assert.deepEqual(failures, [])
  lighting.dispose()
})

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
  s: ExposureValues,
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

test('the local exposure moves a pixel by its layers, as their definition says, the thresholds too', () => {
  const grid = { cell: [0, 0] }
  const run = (options: Partial<ExposureValues>, exposure: number) => {
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
    }>(CONTRACT_COMPOSITIONS.finish.flagless, ['localGain', 'baseLog'], scope)
    return { ...fns, settings, grey: finish.base[0] }
  }
  // The grey is 0.18 × 2² (the exposure's bias, 1, plus the local one, 0 — the unit of two).
  const exposure = 0.5
  const scaled = { localExposureHighlightContrast: 0.8, localExposureShadowContrast: 0.8 }
  for (const options of [
    scaled,
    { localExposureHighlightThreshold: 0.5, localExposureHighlightThresholdStrength: 0.5 },
    { localExposureShadowThreshold: 1, localExposureShadowThresholdStrength: 0 },
    { localExposureDetailStrength: 0.25, localExposureBlurBlend: 0 },
    { localExposureBlurBlend: 1, localExposureMiddleGreyBias: -1 },
  ] as Partial<ExposureValues>[]) {
    const { localGain, baseLog, settings, grey } = run({ ...scaled, ...options }, exposure)
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

test('the local exposure pulls toward the grey the exposure buffer holds, the compensation curve in it', () => {
  const run = (grey: number | undefined) => {
    // The word the GPU copies from the exposure buffer; the fixture's is the grey of the bias.
    const { finish, settings } = finishScope(
      { localExposureHighlightContrast: 0.8, localExposureShadowContrast: 0.8 },
      {},
      grey,
    )
    finish.look[1] = 0.5
    const scope = {
      finish,
      grid: 'grid',
      blurredLog: 'blurred',
      finishSampler: 'sampler',
      textureSampleLevel: (texture: string) =>
        texture === 'grid' ? [0, 0, 0, 0] : [-1.5, 0, 0, 0],
    }
    const { localGain } = shaderRun<{ localGain: (logLight: number, uv: number[]) => number }>(
      CONTRACT_COMPOSITIONS.finish.flagless,
      ['localGain'],
      scope,
    )
    return { gain: localGain(2, [0.3, 0.6]), word: finish.base[0], settings }
  }
  const plain = run(undefined)
  // A compensation curve that lifts the middle grey by a stop and a half over the bias's two.
  const lifted = Math.log2(0.18 * 2 ** 3.5)
  const withCurve = run(lifted)
  assert.ok(Math.abs(plain.word - Math.log2(0.18 * 2)) < 1e-6, 'the bias alone')
  // The base layer is the blurred luminance alone (an empty grid), so the gain is the layers' own
  // definition at the grey the word holds, and no other source moves it.
  const base = -1.5 + Math.log2(0.5)
  const logExposed = 2 + Math.log2(0.5)
  assert.ok(Math.abs(plain.gain - layered(logExposed, base, plain.word, plain.settings)) < 1e-6)
  const expected = layered(logExposed, base, lifted, withCurve.settings)
  assert.ok(Math.abs(withCurve.gain - expected) < 1e-6 * Math.max(1, expected))
  assert.ok(Math.abs(withCurve.gain - plain.gain) > 1e-3, 'the curve moves the gain')
})
