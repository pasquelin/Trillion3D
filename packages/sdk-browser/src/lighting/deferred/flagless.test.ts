// A frame with no as-is pixel composes through flagless variants, compiled with the others,
// that bind and read no flag. Their `composeColor` is the shipped text run as JavaScript: at every
// flag but the as-is one it gives the flag-reading one's value; at the as-is one the flag-reading
// one draws the surface's base colour over the chain, after the temporal pass (it weighed a share — the flags', or one the temporal pass accumulated — and
// had a still and an accumulated variant). The finishing's variant of it, run over vectors, reads
// the colour fringe and adds the dither.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredLighting } from './deferred.ts'
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from './shaders.ts'
import { AS_IS_FLAG } from '../../materials/surface/surfaceModelWord.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { shaderFunctions } from '../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { linearToSrgb } from '../../../../math/src/color/color.ts'
import { FILM_RULES, type FilmSettings } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { finishScope } from '../../post/finish/finishScope.fixture.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'

type Compose = { composeColor: (pixel: object) => unknown }
const hdr = {},
  background = { rgb: 0.25 }
/** The sRGB transfer as the scope runs it. */
const srgb = (c: number) =>
  c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 0.41666) - 0.055
/** `composeColor` of `source` on one lit value, one channel wide, and the surface texel `read`: its
 *  flag (`r`) and its base colour (`rgb`). */
function composed(source: string, value: object, read: object, view: object) {
  const scope = {
    hdr,
    asIsFlags: {},
    asIsBase: {},
    view,
    textureLoad: (texture: object) => (texture === hdr ? value : read),
    // The source at the display's size: its pixel as it is (`sourceValue`), with no colour fringe
    // (`sceneColor`), no local exposure (`gainOf`), nothing done to it (`shownAt`), no dither.
    sourceValue: () => value,
    sceneColor: () => value,
    gainOf: () => 1,
    shownAt: (image: object) => image,
    ditherAt: () => 0,
    vec2i: (xy: unknown) => xy,
    vec2f: (xy: unknown) => xy,
    vec4f: (...parts: unknown[]) => parts,
    saturate: (c: number) => Math.min(Math.max(c, 0), 1),
    linearToSrgb: srgb,
    toneMap: (c: number, curve: number) => (curve ? c / (1 + c) : Math.min(c, 1)),
    displayValue: (c: number, curve: number) => scope.linearToSrgb(scope.toneMap(c, curve)),
    // The tone table's read, whose texels this scope has not: the same display value.
    toneShown: (c: number, curve: number) => scope.displayValue(c, curve),
  }
  return shaderFunctions<Compose>(
    source,
    ['composeAt', 'composeChain', 'composeColor'],
    scope,
  ).composeColor({
    xy: 0,
  })
}

const channels = [0, -0, 1e-7, 0.002, 0.5, 1, 7.5, 65504, Infinity, NaN]
const coverages = [0, 1e-7, 0.5, 1, NaN]

test('the flagless composition gives the flag-reading one at every flag but the as-is one (OMB-11)', () => {
  const flags = [0, 1, 2, 4, 5]
  assert.ok(!flags.includes(AS_IS_FLAG))
  let checked = 0
  for (const sources of [
    CONTRACT_COMPOSITIONS.plain,
    CONTRACT_COMPOSITIONS.finish,
    UNLIT_COMPOSITIONS.plain,
  ]) {
    // The lit ones bind the tone table at 2, where the others bind the flags and the base colour.
    assert.doesNotMatch(sources.flagless, /asIs/, 'no flag bound nor read')
    for (const rgb of channels)
      for (const a of coverages)
        for (const [z, w, x, carries] of [
          [0, 1, 0, 0],
          [0, 0.3, 4, 1],
          [1, 1, 0, 0],
          [1, 1, 0, 1],
        ]) {
          const view = {
            background,
            // No sharpening (`view.viewport.w`): the display pixel composed once.
            viewport: { z, w: 0 },
            preExposure: { y: w, z: carries },
            display: { x },
            source: { xy: 1 },
            surface: { xy: 1, zw: 0 },
          }
          const value = { rgb, a },
            flagless = composed(sources.flagless, value, {}, view)
          // The alpha is the image's, saturated, where the view carries one, else 1: never a weight of the colour.
          assert.deepEqual((flagless as unknown[])[1], carries ? Math.min(Math.max(a, 0), 1) : 1)
          for (const flag of flags)
            assert.deepEqual(composed(sources.asIs, value, { r: flag, rgb: 0.7 }, view), flagless)
          // An as-is pixel: its base colour with the transfer alone, whatever the image holds; a raw
          // view's output is the chain's.
          assert.deepEqual(
            composed(sources.asIs, value, { r: AS_IS_FLAG, rgb: 0.7 }, view),
            z ? flagless : [srgb(0.7), 1],
          )
          checked++
        }
  }
  assert.equal(checked, 3 * channels.length * coverages.length * 4)
})

test('a flagless frame composes with its own pipelines and binds no flag, compiling none', async () => {
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
    image = { color: view() }
  for (const asIs of [false, true]) {
    lighting.compose(encoder, view(), [0, 0, 0, 1], undefined, undefined, asIs)
    lighting.compose(encoder, view(), [0, 0, 0, 1], undefined, image, asIs)
  }
  assert.equal(renderPipelines.length, compiled, 'every variant was compiled with its program')
  const labels = taken('setPipeline').map(
    ([pipeline]) => (pipeline as GPURenderPipelineDescriptor).fragment!.module.label,
  )
  // One as-is variant whatever the image: the still and the accumulated ones read the same flags.
  assert.deepEqual(labels, [
    'UNLIT_COMPOSE_FLAGLESS',
    'UNLIT_COMPOSE_FLAGLESS',
    'UNLIT_COMPOSE_ASIS',
    'UNLIT_COMPOSE_ASIS',
  ])
  const bindings = taken('setBindGroup').map(([, group]) =>
    [...(group as GPUBindGroupDescriptor).entries].map((entry) => entry.resource),
  )
  assert.equal(bindings[0].length, 2, 'the lit image and the view, no flags')
  assert.equal(bindings[1].length, 2, 'the accumulated colour and the view, no flags')
  assert.deepEqual(
    bindings[2].slice(2),
    [flags, views[0]],
    'a frame with an as-is pixel reads the flags and the base colour',
  )
  assert.deepEqual(bindings[3].slice(2), [flags, views[0]], 'an accumulated one the same')
  lighting.dispose()
})

test('a finishing composition reads the fringe’s taps, adds the dither to the colour and carries the alpha beside it', () => {
  type Run = { composeColor: (pixel: number[]) => number[]; ditherAt: (at: number[]) => number }
  // An image of 8 × 4 texels, a ramp: each channel steps by its own amount along x and y.
  const ramp = (x: number, y: number) => [0.1 * x + 0.05, 0.2 * y + 0.05, 0.02 * (x + y) + 0.1]
  const view = {
    source: [1, 1, 7, 3],
    surface: [1, 1, 7, 3],
    viewport: [8, 4, 0, 0],
    preExposure: [1, 1, 0, 0],
    display: [0, 0, 0, 0],
    background: [0, 0, 0, 1],
  }
  /** The finishing's composition of an image of alpha `alpha`, its as-is flag `flag` where it
   *  reads one (the as-is variant, its base colour the ramp), the flagless one else. */
  const compose = (film: FilmSettings, alpha = 1, flag?: number) => {
    const { finish } = finishScope(
      {},
      {
        film: resolveSettings(FILM_RULES, film),
        vignette: 0,
        local: false,
        size: [8, 4],
      },
    )
    const textureLoad = (image: unknown, [x, y]: number[]) =>
      image === 'hdr'
        ? [...ramp(x, y), alpha]
        : image === 'base'
          ? [...ramp(x, y), 1]
          : [flag, 0, 0, 0]
    const variant = flag === undefined ? 'flagless' : 'asIs'
    const scope = { hdr: 'hdr', asIsFlags: 'flags', asIsBase: 'base', view, finish, textureLoad }
    return shaderRun<Run>(
      CONTRACT_COMPOSITIONS.finish[variant],
      ['composeColor', 'ditherAt'],
      scope,
    )
  }
  const bare = { quantizationDitheringBits: 32 } // no dither
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
  // The dither is added to the colour shown, whatever the image's alpha, which no view that carries none shows.
  const dithered = compose({ quantizationDitheringBits: 1 }, 0.5)
  const noise = dithered.ditherAt(pixel)
  const [shown, undithered] = [dithered.composeColor(pixel), compose(bare, 0.5).composeColor(pixel)]
  near(
    shown.slice(0, 3),
    undithered.slice(0, 3).map((v) => v + noise),
    'dither',
    1e-6,
  )
  assert.equal(shown[3], 1, 'an image with no alpha channel is opaque')
  view.preExposure[2] = 1
  assert.equal(
    compose(bare, 0.5).composeColor(pixel)[3],
    0.5,
    'the alpha of an image that carries one',
  )
  view.preExposure[2] = 0
  // A pixel shown as it is (a debug material of the lit image) is exact: its base colour with the
  // transfer alone, no dither.
  const asIs = compose({ quantizationDitheringBits: 1 }, 1, AS_IS_FLAG).composeColor(pixel)
  assert.deepEqual(asIs, compose(bare, 1, AS_IS_FLAG).composeColor(pixel), 'an as-is pixel')
  near(asIs.slice(0, 3), ramp(7, 1).map(linearToSrgb), 'its base colour', 1e-6)
  const lit = compose({ quantizationDitheringBits: 1 }, 1, 0).composeColor(pixel)
  assert.ok(Math.abs(lit[0] - asIs[0]) > 0.01, 'a lit pixel is dithered')
})
