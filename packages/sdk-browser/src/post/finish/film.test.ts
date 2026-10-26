// The film effects of the display finishing, the shipped WGSL run as JavaScript over the words the
// settings write (`finishScope.fixture.ts`): the vignette's look, the colour fringe, the grain, the
// dither — and that an effect the settings leave off costs the pixel nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { FILM_RULES, type FilmSettings } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { grainOn } from './filmParams.ts'
import type { FinishInput } from './finishParams.ts'
import { filmRun, finishScope, grainLuma } from './finishScope.fixture.ts'
import { grainTexels } from './grain.ts'

const GRAIN_LUMA = grainLuma()

/** The dither's law of a draw `h`: `s − s · √(1 − |n|)`, `n = 2h − 1`, `s` its sign. */
const triangular = (h: number) => Math.sign(2 * h - 1) * (1 - Math.sqrt(1 - Math.abs(2 * h - 1)))
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
  const off: FilmSettings[] = [
    {},
    { chromaticAberration: 0.01 }, // no more than 0.01 draws nothing
    { chromaticAberration: 5, chromaticAberrationQuality: 'off' },
    { chromaticAberration: 5, chromaticAberrationMax: 0.005 },
  ]
  for (const film of off) assert.equal(fringe(film).fringeActive(), false)
  assert.equal(fringe({ chromaticAberration: 5, chromaticAberrationMax: 0.5 }).fringeActive(), true)
  assert.equal(
    fringe({ chromaticAberrationMax: -2 }).fringeActive(),
    true,
    '−2 forces an extreme one',
  )
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
    // The step of 32 bits is not a switch: it is drawn, and too small for the display to show.
    const tiny = dither({ quantizationDitheringBits: 32 })(uv)
    assert.ok(tiny !== 0 && Math.abs(tiny) < 1e-9, 'a step the display does not hold')
  }
})

test('a new dither on a held 8-bit image averages to the image, not to the light: the pattern is kept at rest', () => {
  const noise = (frame: number, uv: number[]) =>
    filmRun<{ ditherOf: (uv: number[]) => number }>({}, ['ditherOf'], {}, { frame }).ditherOf(uv)
  const level = (light: number) => Math.round(light * 255)
  const frames = [0, 1, 2, 3, 4, 5, 6, 7]
  const mean = (at: (frame: number) => number) => frames.reduce((sum, f) => sum + at(f), 0) / 8
  let [composedAgain, onHeld] = [0, 0]
  for (let i = 0; i < 64; i++) {
    const light = 0.2 + (i + 0.37) / 640,
      uv = [(i + 0.5) / 64, 0.3]
    // The image composed again from its light at each of eight images, then the eye's average.
    const again = mean((f) => level(light + noise(f, uv)))
    // The first image held: a new noise on its 8-bit levels at each of the eight.
    const first = level(light + noise(0, uv)) / 255
    const over = mean((f) => level(first + noise(f, uv)))
    composedAgain += (again - light * 255) ** 2 / 64
    onHeld += (over - light * 255) ** 2 / 64
  }
  assert.ok(onHeld > 1.5 * composedAgain, `${composedAgain} against ${onHeld}`)
})

test('the grain multiplies the light by its texture times its decode, by the share of the luminance zone', () => {
  type Grain = { grained: (light: number[], uv: number[]) => number[] }
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
    near(grained(light, [0.3, 0.4]), expected, at, 1e-6)
  }
})

test('the grain’s bright zone is a smooth step for any order of its edges: reversed, or a step where they meet', () => {
  type Grain = { grainWeight: (light: number[]) => number }
  const bright = {
    filmGrainIntensity: 1,
    filmGrainIntensityShadows: 0,
    filmGrainIntensityMidtones: 0,
  }
  const weight = (min: number, max: number, luma: number) => {
    const film = { ...bright, filmGrainHighlightsMin: min, filmGrainHighlightsMax: max }
    const { grainWeight } = filmRun<Grain>(film, ['grainWeight'])
    return grainWeight(GRAIN_LUMA.map(() => luma / GRAIN_LUMA.reduce((sum, w) => sum + w)))
  }
  // Edges that meet: a step there, never an undefined value.
  assert.deepEqual([weight(0.5, 0.5, 0.4), weight(0.5, 0.5, 0.6)], [0, 1])
  // A top under the start is a reversed ramp: whole at 0.1, 0.74 at a third of the way, none at 0.9.
  near(
    [0.1, 0.3, 0.9].map((luma) => weight(0.5, 0.2, luma)),
    [1, 20 / 27, 0],
    'reversed',
    1e-6,
  )
})

test('an effect the settings leave off is a word the shader tests once: the default pays for none of them', () => {
  const flags = (film: FilmSettings) => {
    const { finish } = finishScope({}, { film: resolveSettings(FILM_RULES, film) })
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
  const steps = (bits: number) => flags({ quantizationDitheringBits: bits })[4] as number
  near(steps(32), 1 / (2 ** 32 - 1), 'always a step', 1e-12)
  near(steps(-3), 1 / 255, 'under 1 bit: the display’s own step', 1e-9)
  near(steps(40), 1 / (2 ** 40 - 1), 'any number of bits', 1e-15)
  // The grain is read as 0 under the quality that has none, and all its zones at 0 draw none.
  const grain0 = {
    filmGrainIntensity: 1,
    filmGrainIntensityShadows: 0,
    filmGrainIntensityMidtones: 0,
  }
  const quality = resolveSettings(FILM_RULES, { filmGrainIntensity: 1, tonemapperQuality: 3 })
  assert.equal(grainOn(quality), false)
  assert.equal(
    grainOn(resolveSettings(FILM_RULES, { ...grain0, filmGrainIntensityHighlights: 0 })),
    false,
  )
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

test('the grain’s texture decodes to a mean of 1 a channel, the dither’s law is triangular', () => {
  const { bytes, decode } = grainTexels()
  assert.equal(bytes.length, 128 * 128 * 4)
  for (let channel = 0; channel < 3; channel++) {
    let sum = 0
    for (let at = channel; at < bytes.length; at += 4) sum += bytes[at] / 255
    near((sum * decode[channel]) / (128 * 128), 1, `channel ${channel}`, 1e-9)
  }
  const noise = Array.from({ length: 20000 }, (_, at) => triangular((at + 0.5) / 20000))
  near(noise.filter((v) => Math.abs(v) < 0.5).length / noise.length, 0.75, '2x − x² within x', 0.01)
  assert.equal(grainTexels(), grainTexels(), 'generated once')
})

test('the grain’s texture is generated to the measured statistics of the reference’s: spread, skew, channels that follow each other, texels that follow their neighbours, a repeat with no seam', () => {
  const { bytes, decode } = grainTexels()
  const side = 128,
    count = side * side
  const planes = [0, 1, 2].map((c) =>
    Array.from({ length: count }, (_, t) => bytes[t * 4 + c] / 255),
  )
  const mean = (v: number[]) => v.reduce((sum, x) => sum + x, 0) / count
  const spreads = planes.map((v) => {
    const m = mean(v)
    return { m, s: Math.sqrt(mean(v.map((x) => (x - m) ** 2))) }
  })
  const moment = (c: number, k: number) =>
    mean(planes[c].map((x) => ((x - spreads[c].m) / spreads[c].s) ** k))
  // The spread over the mean is the strength the decode makes of the grain's multiplier.
  planes.forEach((_, c) => {
    near(spreads[c].m, 0.5, `mean ${c}`, 0.01)
    near(spreads[c].s * decode[c], [0.139, 0.111, 0.154][c], `strength ${c}`, 0.004)
    assert.ok(moment(c, 3) > 0.25 && moment(c, 3) < 0.7, `skewed toward the bright ${c}`)
    assert.ok(moment(c, 4) - 3 > 0.1, `heavier tails than a bell ${c}`)
  })
  const correlation = (a: number, b: number) =>
    mean(planes[a].map((x, i) => (x - spreads[a].m) * (planes[b][i] - spreads[b].m))) /
    (spreads[a].s * spreads[b].s)
  near(correlation(0, 1), 0.62, 'red-green', 0.03)
  near(correlation(0, 2), 0.406, 'red-blue', 0.03)
  near(correlation(1, 2), 0.542, 'green-blue', 0.03)
  // Texels follow their neighbours at one texel's distance, each channel its own way along each
  // axis (the scan's grain is streakier along one), none at two.
  const lag = (c: number, dx: number, dy: number) => {
    let sum = 0
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++)
        sum +=
          (planes[c][y * side + x] - spreads[c].m) *
          (planes[c][((y + dy) % side) * side + ((x + dx) % side)] - spreads[c].m)
    return sum / count / spreads[c].s ** 2
  }
  near(
    [0, 1, 2].map((c) => lag(c, 1, 0)),
    [0.2, 0.15, 0.2],
    'one texel along x',
    0.04,
  )
  near(
    [0, 1, 2].map((c) => lag(c, 0, 1)),
    [0.06, 0.18, 0.3],
    'one texel along y',
    0.04,
  )
  assert.ok(Math.abs(lag(1, 2, 0)) < 0.04 && Math.abs(lag(2, 0, 2)) < 0.06, 'none at two')
  // No seam: neighbours across the edges are as near as inside (a plane that did not wrap, 10 % farther).
  let [inside, across] = [0, 0]
  for (const v of planes)
    for (let i = 0; i < side; i++) {
      across +=
        Math.abs(v[i * side + side - 1] - v[i * side]) + Math.abs(v[count - side + i] - v[i])
      inside += Math.abs(v[i * side + side - 2] - v[i * side + side - 1])
      inside += Math.abs(v[count - 2 * side + i] - v[count - side + i])
    }
  assert.ok(across < 1.07 * inside, `across ${across} against inside ${inside}`)
})
