// A frame with no as-is pixel composes through flagless variants, compiled with the others,
// that bind and read no share. Their `composeColor` is the shipped text run as JavaScript: at every
// flag but the as-is one, and at an accumulated share of 0, it gives the flag-reading one's value.
// The finishing's variant of it, run over vectors, reads the colour fringe and adds the dither.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredLighting } from './deferred.ts'
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from './shaders.ts'
import { AS_IS_FLAG } from '../../materials/surface/surfaceModel.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { shaderFunctions } from '../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { linearToSrgb } from '../../../../math/src/color/color.ts'
import { EXPOSURE_RULES } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { FILM_RULES, type FilmSettings } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { FINISH } from '../../post/finish/finishLayout.ts'
import { writeFinishParams } from '../../post/finish/finishParams.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'

type Compose = { composeColor: (pixel: object) => unknown }
const hdr = {},
  asIs = {},
  background = { rgb: 0.25 }
/** `composeColor` of `source` on one lit value, one channel wide, and the share texel `read`. */
function composed(source: string, value: object, read: object, view: object) {
  const scope = {
    hdr,
    asIs,
    view,
    textureLoad: (texture: object) => (texture === hdr ? value : read),
    // The source at the display's size: its pixel as it is (`sourceValue`), with no colour fringe
    // (`sceneColor`) and no local exposure (`gainOf`), no grain (`finished`) and no dither.
    sourceValue: () => value,
    sceneColor: () => value,
    gainOf: () => 1,
    ditherOf: () => 0,
    finished: (image: object) => image,
    vec2i: (xy: unknown) => xy,
    vec2f: (xy: unknown) => xy,
    vec4f: (...parts: unknown[]) => parts,
    linearToSrgb: (c: number) =>
      c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 0.41666) - 0.055,
    toneMap: (c: number, curve: number) => (curve ? c / (1 + c) : Math.min(c, 1)),
    displayValue: (c: number, curve: number) => scope.linearToSrgb(scope.toneMap(c, curve)),
  }
  return shaderFunctions<Compose>(source, ['composeAt', 'composeColor'], scope).composeColor({
    xy: 0,
  })
}

const channels = [0, -0, 1e-7, 0.002, 0.5, 1, 7.5, 65504, Infinity, NaN]
const coverages = [0, 1e-7, 0.5, 1, NaN]

test('the flagless composition gives the flag-reading one at every share of 0 (OMB-11)', () => {
  const flags = [0, 1, 2, 4, 5]
  assert.ok(!flags.includes(AS_IS_FLAG))
  let checked = 0
  for (const sources of [
    CONTRACT_COMPOSITIONS.plain,
    CONTRACT_COMPOSITIONS.finish,
    UNLIT_COMPOSITIONS.plain,
  ]) {
    assert.doesNotMatch(
      sources.flagless,
      /asIs|@group\(0\) @binding\(2\)/,
      'no share bound nor read',
    )
    for (const rgb of channels)
      for (const a of coverages)
        for (const [z, w, x] of [
          [0, 1, 0],
          [0, 0.3, 4],
          [1, 1, 0],
        ]) {
          const view = {
            background,
            // No sharpening (`view.viewport.w`): the display pixel composed once.
            viewport: { z, w: 0 },
            preExposure: { y: w },
            display: { x },
            source: { xy: 1 },
          }
          const value = { rgb, a },
            flagless = composed(sources.flagless, value, {}, view)
          for (const flag of flags)
            assert.deepEqual(composed(sources.still, value, { r: flag }, view), flagless)
          assert.deepEqual(composed(sources.accumulated, value, { r: 0 }, view), flagless)
          checked++
        }
  }
  assert.equal(checked, 3 * channels.length * coverages.length * 3)
})

test('a flagless frame composes with its own pipelines and binds no share, compiling none', async () => {
  const gpu = fakeDevice(),
    { device, renderPipelines } = gpu
  const encoder = device.createCommandEncoder()
  const taken = (name: string) => gpu.passes.flatMap(({ commands }) => commandArgs(commands, name))
  const view = () => ({}) as GPUTextureView
  const flags = view(),
    views = [view(), view(), view(), flags]
  const lighting = await createDeferredLighting(device)
  lighting.bind(
    { views: () => views, stores: () => [views[0], flags] } as unknown as SurfaceBuffer,
    view(),
    view(),
    false,
  )
  const compiled = renderPipelines.length,
    image = { color: view(), share: view() }
  for (const asIs of [false, true]) {
    lighting.compose(encoder, view(), [0, 0, 0, 1], undefined, undefined, asIs)
    lighting.compose(encoder, view(), [0, 0, 0, 1], undefined, image, asIs)
  }
  assert.equal(renderPipelines.length, compiled, 'every variant was compiled with its program')
  const labels = taken('setPipeline').map(
    ([pipeline]) => (pipeline as GPURenderPipelineDescriptor).fragment!.module.label,
  )
  assert.deepEqual(labels, [
    'UNLIT_COMPOSE_FLAGLESS',
    'UNLIT_COMPOSE_FLAGLESS',
    'UNLIT_COMPOSE_STILL',
    'UNLIT_COMPOSE_ACCUMULATED',
  ])
  const bindings = taken('setBindGroup').map(([, group]) =>
    [...(group as GPUBindGroupDescriptor).entries].map((entry) => entry.resource),
  )
  assert.equal(bindings[0].length, 2, 'the lit image and the view, no flags')
  assert.equal(bindings[1].length, 2, 'the accumulated colour and the view, no share')
  assert.equal(bindings[2][2], flags, 'a frame with an as-is pixel reads the flags')
  assert.equal(bindings[3][2], image.share, 'and an accumulated one its share')
  lighting.dispose()
})

test('a finishing composition reads the fringe’s taps, and adds the dither to the colour before the coverage weighs it', () => {
  type Run = { composeColor: (pixel: number[]) => number[]; ditherOf: (uv: number[]) => number }
  // An image of 8 × 4 texels, a ramp: each channel steps by its own amount along x and y.
  const ramp = (x: number, y: number) => [0.1 * x + 0.05, 0.2 * y + 0.05, 0.02 * (x + y) + 0.1]
  const view = {
    source: [1, 1, 7, 3],
    viewport: [8, 4, 0, 0],
    preExposure: [1, 1, 0, 0],
    display: [0, 0, 0, 0],
    background: [0, 0, 0, 1],
  }
  const settings = resolveSettings(EXPOSURE_RULES, {})
  const compose = (film: FilmSettings, alpha = 1) => {
    const input = { settings, film: resolveSettings(FILM_RULES, film), vignette: 0, auto: false }
    const words = new Float32Array(FINISH.words)
    writeFinishParams(words, {
      ...input,
      ...{ local: false, glow: false, size: [8, 4], format: 'rgba8unorm', frame: 0 },
    })
    const finish = Object.fromEntries(
      Object.entries(FINISH.at).map(([name, at]) => [name, [...words.subarray(at, at + 4)]]),
    )
    const textureLoad = (_: unknown, [x, y]: number[]) => [
      ...ramp(x, y).map((v) => v * alpha),
      alpha,
    ]
    const scope = { hdr: 'hdr', view, finish, textureLoad }
    return shaderRun<Run>(
      CONTRACT_COMPOSITIONS.finish.flagless,
      ['composeColor', 'ditherOf'],
      scope,
    )
  }
  const bare = { quantizationDitheringBits: 32 } // a step too small to show
  // The pixel (7, 1) of 8 × 4: q = (0.875, −0.25). The red and the green are read nearer the centre
  // by 5 % of 0.007 a nanometre from the blue's wavelength, the blue where the pixel is.
  const pixel = [7.5, 1.5, 0, 1]
  const q = [pixel[0] / 4 - 1, pixel[1] / 2 - 1]
  const tap = (nanometres: number) =>
    q.map((v, i) => (((1 - 0.05 * 0.007 * (nanometres - 464.3)) * v + 1) / 2) * [8, 4][i] - 0.5)
  const [red, green] = [tap(611.3), tap(549.1)]
  const expected = [ramp(red[0], red[1])[0], ramp(green[0], green[1])[1], ramp(7, 1)[2]]
  const fringed = compose({ ...bare, chromaticAberration: 5 }).composeColor(pixel)
  near(fringed.slice(0, 3), expected.map(linearToSrgb), 'the fringed colour', 1e-6)
  const plain = compose(bare).composeColor(pixel)
  near(plain.slice(0, 3), ramp(7, 1).map(linearToSrgb), 'no fringe', 1e-6)
  // The dither is added to the colour shown, and the coverage weighs it with the rest.
  const dithered = compose({ quantizationDitheringBits: 1 }, 0.5)
  const noise = dithered.ditherOf([pixel[0] / 8, pixel[1] / 4])
  const [shown, undithered] = [dithered.composeColor(pixel), compose(bare, 0.5).composeColor(pixel)]
  near(
    shown.slice(0, 3),
    undithered.slice(0, 3).map((v) => v + noise / 2),
    'dither',
    1e-6,
  )
})
