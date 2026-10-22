// The film effects of the display finishing, the shipped WGSL run as JavaScript over the words the
// settings write (`finishScope.fixture.ts`): the vignette's look, the colour fringe, the grain, the
// dither — and that an effect the settings leave off costs the pixel nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { FILM_RULES, type FilmSettings } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { filmOn, grainOn } from './filmParams.ts'
import type { FinishInput } from './finishParams.ts'
import { filmRun, finishScope } from './finishScope.fixture.ts'
import { GLOWED_PIXEL_WGSL, GRAIN_LUMA } from './finishWgsl.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { grainTexels, triangular } from './grain.ts'

const maskOf = (film: FilmSettings, input: Partial<FinishInput> = {}) =>
  filmRun<{ vignetteMask: (uv: number[]) => number[] }>(film, ['vignetteMask'], {}, input)
    .vignetteMask

test('the vignette is the cosine-fourth falloff, 1 at the centre', () => {
  for (const [size, strength] of [
    [[1920, 1080], 0.4],
    [[1000, 1000], 1],
    [[400, 1200], 0.25],
  ] as const) {
    const mask = (uv: number[]) => maskOf({}, { size, vignette: strength })(uv)[0]
    assert.equal(mask([0.5, 0.5]), 1)
    // The corner is on the circle through the corners, whatever the aspect: 1 / (1 + 2 v²)².
    const corner = 1 / (1 + 2 * strength ** 2) ** 2
    const corners = [mask([0, 0]), mask([1, 0]), mask([0, 1]), mask([1, 1])]
    near(corners, [corner, corner, corner, corner], `${size}`, 1e-6)
  }
})

test('the vignette darkens toward its colour, around its centre, or as the oval its size and softness say', () => {
  const mask = (film: FilmSettings, vignette = 0.4) => maskOf(film, { vignette })
  const weight = 1 / (1 + 2 * 0.4 ** 2) ** 2
  const colours = mask({ vignetteColorRed: 1, vignetteColorBlue: 0.5 })([0, 0])
  near(colours, [1, weight, 0.5 + 0.5 * weight], 'colour', 1e-6)
  assert.equal(mask({ vignetteCenterX: 0.8 })([0.65, 0.5])[0], 1)
  // The oval: lerp(1, (1 − d²)^softness, strength); at (0.8, 0.7) of a square image the position
  // from the centre is (0.6, 0.4), the width's half.
  const oval = mask({ vignetteType: 'oval', vignetteSizeX: 2, vignetteSoftness: 3 }, 0.5)
  near(oval([0.8, 0.7])[0], 0.5 + 0.5 * (1 - (0.3 ** 2 + 0.4 ** 2)) ** 3, 'oval', 1e-6)
})

test('the colour fringe reads the red and the green nearer the centre by their wavelengths, the blue where it is', () => {
  type Fringe = { fringeActive: () => boolean; fringeTaps: (uv: number[]) => number[] }
  const fringe = (film: FilmSettings) => filmRun<Fringe>(film, ['fringeActive', 'fringeTaps'])
  const active = (film: FilmSettings) => fringe(film).fringeActive()
  assert.equal(active({}), false)
  assert.equal(active({ chromaticAberration: 0.01 }), false, 'no more than 0.01 draws nothing')
  assert.equal(active({ chromaticAberration: 5, chromaticAberrationQuality: 'off' }), false)
  assert.equal(active({ chromaticAberration: 5, chromaticAberrationMax: 0.005 }), false)
  assert.equal(active({ chromaticAberration: 5, chromaticAberrationMax: 0.5 }), true)
  assert.equal(active({ chromaticAberrationMax: -2 }), true, '−2 forces an extreme one')
  const { fringeTaps } = fringe({ chromaticAberration: 5, chromaticAberrationStartOffset: 0.5 })
  near(fringeTaps([0.6, 0.5]), [0.6, 0.5, 0.6, 0.5], 'under the start offset', 1e-6)
  // At the right edge: 0.5 past the start offset, 5 % of 0.007 a nanometre from the blue's, over 0.5.
  const read = (nanometres: number) => 1 - 0.5 * 0.05 * 0.007 * (nanometres - 464.3)
  const [red, , green] = fringeTaps([1, 0.5])
  near([red, green], [read(611.3), read(549.1)], 'edge', 1e-6)
})

test('the dither is the reference’s triangular noise of one display step, its pattern following the image', () => {
  const dither = (film: FilmSettings, input: Partial<FinishInput> = {}) =>
    filmRun<{ ditherOf: (uv: number[]) => number }>(film, ['ditherOf'], {}, input).ditherOf
  // The sine hash fract(sin(x + y · 543.31) · 493013) at the image's offset, made triangular.
  const noise = (uv: number[], [dx, dy]: number[]) => {
    const hash = Math.sin(uv[0] + dx + (uv[1] + dy) * 543.31) * 493013
    return triangular(hash - Math.floor(hash))
  }
  const next = [0.5, Math.fround(1 / 3)] // the Halton point 1
  for (const x of [0.1, 0.37, 0.9]) {
    const uv = [x, 1 - 0.7 * x]
    near(dither({})(uv), noise(uv, [0, 0]) / 255, 'an 8-bit display steps by 1/255')
    near(dither({}, { frame: 1 })(uv), noise(uv, next) / 255, 'the next image')
    assert.equal(dither({}, { frame: 8 })(uv), dither({})(uv), 'the ninth image is the first')
    near(dither({ quantizationDitheringBits: 6 })(uv), noise(uv, [0, 0]) / 63, 'bits')
    assert.equal(dither({ quantizationDitheringBits: 24 })(uv), 0, 'from 24 bits none is drawn')
  }
})

test('the grain multiplies the light by its texture times its decode, by the share of the luminance zone', () => {
  type Grain = { grained: (light: number[], coverage: number, uv: number[]) => number[] }
  const film = {
    filmGrainIntensity: 0.5,
    filmGrainIntensityShadows: 0.2,
    filmGrainIntensityHighlights: 0.4,
  }
  const raw = [0.25, 0.5, 1, 1]
  const scope = { grainImage: 'grain', grainSampler: 'repeat', textureSampleLevel: () => raw }
  const { grained, finish } = filmRun<Grain>(film, ['grained'], scope)
  near(finish.grainLevels, [0.1, 0.5, 0.2, 0], 'the zones', 1e-7)
  // The luminance the reference reads: the grading gamut's matrix applied to its luminance row.
  near(GRAIN_LUMA, [0.040555, 0.73297, -0.031568], 'luminance', 1e-5)
  for (const [at, share] of Object.entries({ 0: 0.1, 0.3: 0.5, 2: 0.2 })) {
    const light = GRAIN_LUMA.map(() => Number(at) / GRAIN_LUMA.reduce((sum, w) => sum + w))
    const factor = (c: number) => 1 + (raw[c] * finish.grainDecode[c] - 1) * share
    const expected = light.map((v, c) => v * factor(c))
    near(grained(light, 1, [0.3, 0.4]), expected, at, 1e-6)
  }
})

test('the grain’s zones stay finite where their edges meet: no luminance reads NaN', () => {
  type Grain = { grainWeight: (light: number[]) => number }
  const film = { filmGrainIntensity: 1, filmGrainShadowsMax: 0, filmGrainHighlightsMin: 0.5 }
  // smoothstep is undefined where its edges meet: the words keep a step between them.
  const { grainWeight, finish } = filmRun<Grain>({ ...film, filmGrainHighlightsMax: 0.5 }, [
    'grainWeight',
  ])
  assert.ok(finish.grainBounds[0] > 0 && finish.grainBounds[2] > finish.grainBounds[1])
  const white = GRAIN_LUMA.map(() => 0.5 / GRAIN_LUMA.reduce((sum, w) => sum + w))
  for (const light of [[0, 0, 0], white, [2, 2, 2]]) assert.ok(Number.isFinite(grainWeight(light)))
})

test('an effect the settings leave off is a word the shader tests once: the default pays for none of them', () => {
  const words = (film: FilmSettings) => finishScope({}, { film: resolveSettings(FILM_RULES, film) })
  const flags = (film: FilmSettings) => {
    const { finish } = words(film)
    return [
      finish.tint[3],
      finish.screen[3],
      finish.fringe[3],
      finish.grainLevels,
      finish.dither[0],
    ]
  }
  // The reference's default: the vignette and the dither on, the rest off.
  const [tint, colour, fringe, grain, step] = flags({})
  assert.deepEqual([tint, colour, fringe, grain], [0, 0, 0, [0, 0, 0, 0]])
  near(step as number, 1 / 255, 'step', 1e-9)
  assert.equal(flags({ sceneColorTintRed: 0.5 })[0], 1)
  assert.equal(flags({ vignetteColorBlue: 0.1 })[1], 1)
  assert.equal(flags({ chromaticAberration: 1 })[2], 1)
  assert.deepEqual(flags({ filmGrainIntensity: 1 })[3], [1, 1, 1, 0])
  assert.equal(flags({ quantizationDitheringBits: 32 })[4], 0)
  // The grain is read as 0 under the quality that has none, and all its zones at 0 draw none.
  assert.equal(
    grainOn(resolveSettings(FILM_RULES, { filmGrainIntensity: 1, tonemapperQuality: 3 })),
    false,
  )
  assert.equal(
    grainOn(
      resolveSettings(FILM_RULES, {
        filmGrainIntensity: 1,
        filmGrainIntensityShadows: 0,
        filmGrainIntensityMidtones: 0,
        filmGrainIntensityHighlights: 0,
      }),
    ),
    false,
  )
  // With every effect off — and no vignette, local exposure or glow — the plain composition is used.
  const off = resolveSettings(FILM_RULES, { quantizationDitheringBits: 32 })
  assert.equal(filmOn(off, false), false)
  for (const [film, grain] of [
    [{ sceneColorTintRed: 0.5 }, false],
    [{ chromaticAberration: 1 }, false],
    [{ filmGrainIntensity: 1 }, true],
    [{}, false],
  ] as const)
    assert.equal(filmOn(resolveSettings(FILM_RULES, film), grain), true, JSON.stringify(film))
})

test('a pixel with the film off reads no texture and keeps its light; each effect that is on does its own work', () => {
  type Run = { finished: (source: number[], uv: number[], gain: number) => number[] }
  const reads: unknown[] = []
  const scope = {
    glowImage: 'glow',
    finishSampler: 'sampler',
    grainImage: 'grain',
    grainSampler: 'repeat',
    textureSampleLevel: (image: unknown) => (reads.push(image), [0.5, 0.5, 0.5, 1]),
  }
  const run = (film: FilmSettings, input: Partial<FinishInput> = {}) =>
    filmRun<Run>(film, ['finished'], scope, { vignette: 0, local: false, ...input }).finished
  const source = [0.2, 0.4, 0.8, 1]
  assert.deepEqual(run({})(source, [0.3, 0.6], 1), source, 'the default: the light as it was')
  assert.deepEqual(reads, [], 'no texture read: no glow, no grain')
  assert.deepEqual(run({})(source, [0.3, 0.6], 2), [0.4, 0.8, 1.6, 1], 'the local gain')
  assert.deepEqual(
    run({ sceneColorTintRed: 0.5, sceneColorTintBlue: 2 })(source, [0, 0], 1),
    [0.1, 0.4, 1.6, 1],
  )
  run({ filmGrainIntensity: 1 })(source, [0.3, 0.6], 1)
  assert.deepEqual(reads, ['grain'], 'the grain reads its texture once')
  reads.length = 0
  run({}, { glow: true })(source, [0.3, 0.6], 1)
  assert.deepEqual(reads, ['glow'])
})

test('the glow comes with the dirt its mask shows and the light it left the image, each a word the shader tests once', () => {
  const reads: unknown[] = []
  const scope = {
    glowImage: 'glow',
    dirtImage: 'dirt',
    finishSampler: 'sampler',
    textureSampleLevel: (image: unknown) => (
      reads.push(image),
      image === 'dirt' ? [0.5, 0.25, 1, 1] : [0.5, 0.5, 0.5, 0.25]
    ),
  }
  const run = (input: Partial<FinishInput>) =>
    filmRun<{ finished: (source: number[], uv: number[], gain: number) => number[] }>(
      {},
      ['finished'],
      scope,
      { vignette: 0, local: false, glow: true, ...input },
    ).finished([0.2, 0.4, 0.8, 1], [0.3, 0.6], 1)
  const near3 = (got: number[], want: number[]) =>
    want.forEach((value, c) => near(got[c], value, `channel ${c}`, 1e-6))
  near3(run({}), [0.7, 0.9, 1.3]) // the light and the glow, added
  assert.deepEqual(reads, ['glow'], 'no mask: no read of it')
  near3(run({ keep: [0.5, 0.25, 1] }), [0.6, 0.6, 1.3]) // the light the glow took, gone
  reads.length = 0
  near3(run({ dirt: [2, 2, 2] }), [1.2, 1.15, 2.3]) // glow × (1 + mask × dirt)
  assert.deepEqual(reads, ['glow', 'dirt'])
})

test('one function adds a glow to a pixel, for the finishing and for the bloom’s own composite: its keep, its dirt, its coverage up to 1', () => {
  const { glowedPixel } = shaderRun<{ glowedPixel: (...args: number[][]) => number[] }>(
    GLOWED_PIXEL_WGSL,
    ['glowedPixel'],
    {},
  )
  const [none, glow, mask] = [
    [0, 0, 0, 0],
    [0.5, 0.5, 0.5, 0.25],
    [0.5, 0.25, 1],
  ]
  const is = (got: number[], want: number[], label: string) => near(got, want, label, 1e-6)
  const added = (base: number[], keep = none, dirt = none) =>
    glowedPixel(base, keep, glow, mask, dirt)
  is(added([0.2, 0.4, 0.8, 0.5]), [0.7, 0.9, 1.3, 0.75], 'the light and the glow, added')
  is(added([0.2, 0.4, 0.8, 1]), [0.7, 0.9, 1.3, 1], 'the coverage up to 1')
  is(added([0.2, 0.4, 0.8, 0.5], [0.5, 0.25, 1, 1]), [0.6, 0.6, 1.3, 0.75], 'what the glow left')
  is(added([0.2, 0.4, 0.8, 0.5], none, [2, 2, 2, 1]), [1.2, 1.15, 2.3, 0.75], 'the dirt')
})

test('the grain’s texture is generated from one triangular law and decodes to a mean of 1 a channel', () => {
  const { bytes, decode } = grainTexels()
  assert.equal(bytes.length, 128 * 128 * 4)
  for (let channel = 0; channel < 3; channel++) {
    let sum = 0
    for (let at = channel; at < bytes.length; at += 4) sum += bytes[at] / 255
    near((sum * decode[channel]) / (128 * 128), 1, `channel ${channel}`, 1e-9)
  }
  // The law is triangular on [−1, 1]: the share of it within x of 0 is 2x − x², 0.75 at a half.
  const noise = Array.from({ length: 20000 }, (_, at) => triangular((at + 0.5) / 20000))
  assert.ok(noise.every((v) => Math.abs(v) <= 1))
  near(noise.filter((v) => Math.abs(v) < 0.5).length / noise.length, 0.75, 'triangular', 0.01)
  near(noise.reduce((sum, v) => sum + v, 0) / noise.length, 0, 'centred', 0.01)
  assert.equal(grainTexels(), grainTexels(), 'generated once')
})
