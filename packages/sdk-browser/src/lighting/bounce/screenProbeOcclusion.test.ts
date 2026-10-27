// The screen probes' light: the occlusions it goes under and how the lighting reads a pixel the probes did not.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { nearRelative } from '../../../../math/src/float/near.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { SCREEN_INDIRECT_WGSL, screenFoliageStatement } from './screen/indirectWgsl.ts'

test('the probes’ light goes under the short-range occlusion through the multi-bounce of the base colour, taken at the intensity, then at the strength on a pixel with backface diffuse light, the material’s occlusion being in it already; their occlusion alone goes over the world’s light', () => {
  type Seen = [number, number, number, number]
  type Diffuse = [number, number, number, number]
  const names = ['screenDiffuse', 'screenLights', 'screenShortRange', 'lambertDiffuse']
  type Lit = {
    screenDiffuse: (base: number[], diffuse: Diffuse, seen: Seen, foliage: boolean) => number[]
    screenLights: (seen: Seen) => boolean
    screenShortRange: (base: number[], seen: Seen, foliage: boolean) => number[]
    lambertDiffuse: (rgb: number[], metal: number, irradiance: number[], ao: number) => number[]
  }
  const run = (screenProbes: number[]) =>
    shaderRun<Lit & { screenBackGathered: () => boolean }>(
      wgslModule(SCREEN_INDIRECT_WGSL),
      [...names, 'screenBackGathered'],
      { view: { screenProbes }, screenIndirect: {}, textureLoad: () => [0, 0, 0, 0] },
    )
  // The strength is `x`, the albedo cap `y`, the intensity `z`, the mode `w`.
  const lit = run([1, 0.5, 1, 0])
  const multi = (albedo: number[], ao: number) =>
    albedo.map((a) =>
      Math.max(
        ao,
        ((ao * (2.0404 * a - 0.3324) + (-4.7951 * a + 0.6417)) * ao + (2.7552 * a + 0.6903)) * ao,
      ),
    )
  const rgb = [0.8, 0.4, 0.2],
    seen: Seen = [2, 1, 0.5, 0.4]
  const diffuse = (metal: number): Diffuse => [...rgb.map((v) => v * (1 - metal)), 0] as Diffuse
  const capped = rgb.map((v) => Math.min(v, 0.5))
  const base = lit.lambertDiffuse(rgb, 0, [2, 1, 0.5], 1)
  const factor = (made: number[], over = base) => made.map((v, i) => v / over[i])
  const occlusion = multi(capped, 0.4)
  const near3 = (actual: number[], expected: number[], label: string) =>
    expected.forEach((v, i) => nearRelative(actual[i], v, label, 1e-5))
  near3(
    factor(lit.screenDiffuse(rgb, diffuse(0), seen, false)),
    occlusion,
    'the occlusion’s multi-bounce alone',
  )
  assert.ok(lit.screenLights(seen), 'mode 0: the probes’ light')
  assert.deepEqual(
    lit.screenShortRange(rgb, seen, false),
    [1, 1, 1],
    'nothing over the world’s light',
  )
  // The multi-bounce reads the base colour, the metalness not taken out of it.
  const metallic = lit.lambertDiffuse(rgb, 0.5, [2, 1, 0.5], 1)
  near3(
    factor(lit.screenDiffuse(rgb, [...rgb, 0.5] as Diffuse, seen, false), metallic),
    occlusion,
    'the base colour’s multi-bounce on a half metal',
  )
  // The intensity of a half takes half of the short-range occlusion.
  const half = run([1, 0.5, 0.5, 1])
  const halved = occlusion.map((v) => 1 + (v - 1) * 0.5)
  near3(
    factor(half.screenDiffuse(rgb, diffuse(0), seen, false)),
    halved,
    'the intensity is taken after the multi-bounce',
  )
  assert.ok(!half.screenLights(seen), 'mode 1: the probes’ occlusion alone')
  near3(half.screenShortRange(rgb, seen, false), halved, 'over the world’s light')
  assert.deepEqual(
    half.screenShortRange(rgb, [2, 1, 0.5, 0], false),
    [1, 1, 1],
    'none where they left none',
  )
  // The strength on a pixel with backface diffuse light is taken after the multi-bounce and the intensity, on that pixel alone.
  const leafy = run([0.7, 0.5, 0.5, 0])
  near3(
    factor(leafy.screenDiffuse(rgb, diffuse(0), seen, true)),
    halved.map((v) => 1 + (v - 1) * 0.7),
    'the strength after the intensity',
  )
  near3(
    factor(leafy.screenDiffuse(rgb, diffuse(0), seen, false)),
    halved,
    'a pixel with no backface diffuse light takes the intensity alone',
  )
  const mixedAmount = multi(capped, 1 + (0.4 - 1) * 0.7)
  assert.ok(
    Math.abs(
      factor(run([0.7, 0.5, 1, 0]).screenDiffuse(rgb, diffuse(0), seen, true))[0] - mixedAmount[0],
    ) > 1e-3,
    'not the multi-bounce of an amount already mixed toward one',
  )
  // Mode bit 2: the integration applied the occlusion to the light already, the lighting leaves it as it is; bit 1 still says the back is not gathered.
  const applied = run([0.7, 0.5, 1, 4])
  near3(
    factor(applied.screenDiffuse(rgb, diffuse(0), seen, true)),
    [1, 1, 1],
    'the integration’s occlusion alone',
  )
  assert.ok(applied.screenBackGathered(), 'bit 2 does not say the back is not gathered')
})

test('the lighting reads a pixel the probes did not read as the sky light’s only where their mode is their occlusion alone', () => {
  const frame = (mode: number) =>
    shaderRun<{
      screenLights: (seen: number[]) => boolean
      screenOcclusionOnly: () => boolean
    }>(wgslModule(SCREEN_INDIRECT_WGSL), ['screenLights', 'screenOcclusionOnly'], {
      view: { screenProbes: [0.7, 0.5, 1, mode] },
      screenIndirect: {},
      textureLoad: () => [0, 0, 0, 0],
    })
  const gather = frame(0),
    sky = frame(1)
  assert.ok(!gather.screenLights([0, 0, 0, 0]), 'a pixel with no reading is not lit by the probes')
  assert.ok(!gather.screenOcclusionOnly(), 'and where they gather light it has none')
  assert.ok(sky.screenOcclusionOnly(), 'where they gather none, the sky light’s irradiance')
})

test('a pixel is foliage for the short-range occlusion by its thin double-sided flag or its subsurface model, as its class holds them', () => {
  const flag = /\(surfaceFlag&\d+u\)!=0u/
  assert.match(
    screenFoliageStatement({ thin: true, models: true }),
    /^let foliage=.*\|\|pixelModelId==\d+u;$/,
  )
  assert.match(screenFoliageStatement({ thin: true, models: true }), flag)
  assert.doesNotMatch(screenFoliageStatement({ thin: false, models: true }), flag)
  assert.doesNotMatch(screenFoliageStatement({ thin: true, models: false }), /pixelModelId/)
  assert.equal(screenFoliageStatement({ thin: false, models: false }), 'let foliage=false;')
})

test('the specular occlusion is the reference’s cone against cone, the angle between the reflection and the open sky taken by the degree-one polynomial', () => {
  let word = 0
  const run = shaderRun<{
    screenSpecularOcclusion: (coord: number[], N: number[], V: number[], rough: number) => number
    spBentPack: (v: number[]) => number
    spBentUnpack: (word: number) => number[]
  }>(wgslModule(SCREEN_INDIRECT_WGSL), ['screenSpecularOcclusion', 'spBentPack', 'spBentUnpack'], {
    view: { screenProbes: [1, 0.5, 1, 0] },
    screenIndirect: {},
    textureDimensions: () => [8, 8],
    textureLoad: () => [0, 0, 0, word],
  })
  const unit = (v: number[]) => v.map((x) => x / Math.hypot(...v))
  const smoothstep = (x: number) => {
    const t = Math.min(Math.max(x, 0), 1)
    return t * t * (3 - 2 * t)
  }
  const polynomialAcos = (x: number) => {
    const a = Math.abs(x),
      r = (-0.156583 * a + 0.5 * Math.PI) * Math.sqrt(1 - a)
    return x >= 0 ? r : Math.PI - r
  }
  // The reference's: the bent normal's length is the amount, so its dot with the reflection over the amount is the cosine.
  const reference = (
    N: number[],
    V: number[],
    rough: number,
    bent: number[],
    acos: (x: number) => number,
  ) => {
    const amount = Math.hypot(...bent),
      I = V.map((v) => -v),
      d = N.reduce((s, n, i) => s + n * I[i], 0),
      R = I.map((v, i) => v - 2 * d * N[i])
    const cosine = bent.reduce((s, b, i) => s + b * R[i], 0) / Math.max(amount, 0.001)
    const between = acos(Math.min(Math.max(cosine, -1), 1))
    const arc0 = Math.max(rough, 0.1) * Math.PI,
      arc1 = amount * Math.PI,
      gap = Math.abs(arc0 - arc1)
    const covered = smoothstep(1 - Math.min(Math.max((between - gap) / (arc0 + arc1 - gap), 0), 1))
    return covered * Math.min(Math.max((arc1 - 0.1) / 0.2, 0), 1)
  }
  const N = [0, 0, 1],
    V = unit([0.3, 0, 1])
  let apart = 0
  for (const [rough, direction, amount] of [
    [0.3, unit([0.6, 0.2, 0.5]), 0.5],
    [0.5, unit([-0.4, 0.3, 0.8]), 0.7],
    [0.2, unit([0.2, 0, 1]), 0.35],
  ] as const) {
    word = run.spBentPack(direction.map((x) => x * amount))
    const [x, y, z, kept] = run.spBentUnpack(word)
    const bent = [x * kept, y * kept, z * kept]
    const made = run.screenSpecularOcclusion([1, 1], N, V, rough)
    nearRelative(
      made,
      reference(N, V, rough, bent, polynomialAcos),
      `rough ${rough}, open ${amount}`,
      1e-5,
    )
    apart = Math.max(apart, Math.abs(made - reference(N, V, rough, bent, Math.acos)))
  }
  assert.ok(apart > 1e-3, 'the polynomial’s angle, not the exact one')
  word = 0
  assert.equal(
    run.screenSpecularOcclusion([1, 1], N, V, 0.3),
    1,
    'none where the probes left no occlusion',
  )
})
