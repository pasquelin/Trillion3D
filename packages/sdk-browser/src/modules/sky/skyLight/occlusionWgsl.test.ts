// The sky light under the distance-field occlusion, run on the shipped text (`shaderRun`): the visibility the bent normal gives
// the diffuse light, the light read along the bent normal, and the specular occlusion — each against the occlusion's rules
// written out in the test, with the light's settings in the uniform as `writeSkyLightRead` lays them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import {
  resolveSkyLight,
  skyLightContrastCurve,
  type SkyLightPart,
} from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import { skyLightOcclusionWgsl } from './occlusionWgsl.ts'
import { NO_SKY_LIGHT_OCCLUSION, SKY_LIGHT_READ_WORDS, writeSkyLightRead } from './read.ts'

const BINDINGS = { group: 0, cube: 1, sampler: 2, harmonics: 3, params: 4 }
type Vec3 = [number, number, number]
type Visibility = { scale: number; add: Vec3; normal: Vec3 }
type Specular = { specular: number; add: Vec3 }

const length = (v: Vec3) => Math.hypot(...v)
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const saturate = (x: number) => Math.min(Math.max(x, 0), 1)
const smoothstep = (x: number) => x * x * (3 - 2 * x)

/** The uniform as `writeSkyLightRead` lays the occlusion's words: tint and least occlusion, the contrast curve and the
 *  exponent, and the mode (combine, bent normal applied, reciprocal strength, specular mode). */
function light(
  over: {
    combine?: number
    applied?: number
    mode?: number
    strength?: number
    replaced?: number
  } = {},
) {
  const contrast = 0.6
  const curve = skyLightContrastCurve(contrast)
  return {
    tint: [0.1, 0.2, 0.3, 0.25],
    contrast: [contrast, curve.mul, curve.add, 2],
    mode: [over.combine ?? 1, over.applied ?? 1, 1 / (over.strength ?? 1), over.mode ?? 1],
    replaced: [over.replaced ?? 0, 0, 0, 0],
  }
}

/** The occlusion's functions over `skyLight`, the light's diffuse read being `diffuse` and `applied` whether a cube is there. */
function occlusion(skyLight: ReturnType<typeof light>, applied = true) {
  return shaderRun<{
    skyLightVisibility: (n: Vec3, others: number, bent: Vec3) => Visibility
    skyLightDiffuseOccluded: (v: Visibility) => Vec3
    skyLightBackOccluded: (v: Visibility, n: Vec3) => Vec3
    skyLightSpecularOcclusion: (b: Vec3, r: Vec3, rough: number, two: boolean) => Specular
  }>(
    skyLightOcclusionWgsl(BINDINGS),
    [
      'skyLightVisibility',
      'skyLightDiffuseOccluded',
      'skyLightBackOccluded',
      'skyLightSpecularOcclusion',
    ],
    {
      skyLight,
      skyLightApplied: () => applied,
      skyLightDiffuse: (n: Vec3) => n.map((c) => c + 2) as Vec3,
    },
  )
}

/** The visibility of a bent normal of length `len`: the contrast curve, the exponent and the least occlusion. */
function seen(len: number, u: ReturnType<typeof light>) {
  const curve = 1 / (1 + Math.exp(-u.contrast[0] * (len * 10 - 5)))
  const shaped = Math.pow(saturate(curve * u.contrast[1] + u.contrast[2]), u.contrast[3])
  return mix(shaped, 1, u.tint[3])
}

const N: Vec3 = [0, 0, 1]
const near = (a: number, b: number, why: string) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${why}: ${a} against ${b}`)

test('with no bent normal applied, the diffuse light is the others’ occlusion and the normal it was', () => {
  const u = light({ applied: 0 })
  const v = occlusion(u).skyLightVisibility(N, 0.6, [0, 0.5, 0])
  near(v.scale, 0.6, 'scale')
  assert.deepEqual(v.normal, N)
  v.add.forEach((c, i) => near(c, 0.4 * u.tint[i], `tint ${i}`))
})

test('a bent normal scales the diffuse light by its visibility and turns the lookup toward it', () => {
  const u = light({ combine: 1 })
  const bent: Vec3 = [0.3, 0, 0.4]
  const len = length(bent)
  const direction = bent.map((c) => c / len) as Vec3
  const v = occlusion(u).skyLightVisibility(N, 0.8, bent)
  const visibility = seen(len, u) * 0.8
  near(v.scale, visibility * mix(dot(direction, N), 1, len), 'scale')
  v.add.forEach((c, i) => near(c, (1 - visibility) * u.tint[i], `tint ${i}`))
  v.normal.forEach((c, i) => near(c, mix(direction[i], N[i], len), `normal ${i}`))
})

test('the occlusions combine by their least or by their product, as the light says', () => {
  const bent: Vec3 = [0, 0.3, 0.4]
  const own = seen(length(bent), light())
  const least = occlusion(light({ combine: 0 })).skyLightVisibility(N, 0.2, bent)
  const product = occlusion(light({ combine: 1 })).skyLightVisibility(N, 0.2, bent)
  const factor = mix(dot([0, 0.6, 0.8], N), 1, length(bent))
  near(least.scale, Math.min(own, 0.2) * factor, 'least')
  near(product.scale, own * 0.2 * factor, 'product')
})

test('a bent normal as long as the normal and nothing else occluding leaves the light whole', () => {
  const v = occlusion(light()).skyLightVisibility(N, 1, [0, 0, 1])
  near(v.scale, 1, 'scale')
  v.add.forEach((c) => near(c, 0, 'tint'))
  assert.deepEqual(v.normal, N)
})

test('the diffuse light is read along the visibility’s normal, scaled and lifted by the tint; none without a sky light', () => {
  const run = occlusion(light())
  const v: Visibility = { scale: 0.5, add: [0.1, 0.2, 0.3], normal: [0, 0, 1] }
  run
    .skyLightDiffuseOccluded(v)
    .forEach((c, i) => near(c, 0.5 * (v.normal[i] + 2) + v.add[i], `${i}`))
  assert.deepEqual(occlusion(light(), false).skyLightDiffuseOccluded(v), [0, 0, 0])
})

test('the back is read along -normal under the front’s scale and adds no tint; none without a sky light', () => {
  const v: Visibility = { scale: 0.5, add: [0.1, 0.2, 0.3], normal: [1, 0, 0] }
  const back = occlusion(light()).skyLightBackOccluded(v, N)
  back.forEach((c, i) => near(c, 0.5 * (-N[i] + 2), `${i}`))
  assert.deepEqual(occlusion(light(), false).skyLightBackOccluded(v, N), [0, 0, 0])
})

test('the diffuse light, front and back, is none where the ray-traced sky light supplies it, and the specular occlusion stands', () => {
  const v: Visibility = { scale: 0.5, add: [0.1, 0.2, 0.3], normal: [0, 0, 1] }
  const replaced = occlusion(light({ replaced: 1 }))
  assert.deepEqual(replaced.skyLightDiffuseOccluded(v), [0, 0, 0])
  assert.deepEqual(replaced.skyLightBackOccluded(v, N), [0, 0, 0])
  const bent: Vec3 = [0.3, 0, 0.5]
  assert.deepEqual(
    replaced.skyLightSpecularOcclusion(bent, N, 0.5, false),
    occlusion(light()).skyLightSpecularOcclusion(bent, N, 0.5, false),
  )
  const part = resolveSkyLight({}, {} as SkyLightPart['quality'])
  const words = (traced?: boolean) =>
    writeSkyLightRead(
      new Float32Array(SKY_LIGHT_READ_WORDS),
      part,
      1,
      true,
      1,
      NO_SKY_LIGHT_OCCLUSION,
      undefined,
      1,
      traced,
    )
  assert.equal(words(true)[20], 1)
  assert.equal(words()[20], 0)
})

test('the specular occlusion is the bent normal’s length in the first mode and the cones’ intersection in the second', () => {
  const bent: Vec3 = [0.3, 0, 0.5]
  const len = length(bent)
  const R: Vec3 = [0, 0, 1]
  const rough = 0.4
  const first = occlusion(light({ mode: 0 })).skyLightSpecularOcclusion(bent, R, rough, false)
  near(first.specular, mix(len, 1, 0.25), 'length')
  first.add.forEach((c, i) => near(c, (1 - first.specular) * [0.1, 0.2, 0.3][i], `tint ${i}`))
  const reflected = Math.max(rough, 0.1) * Math.PI
  const open = len * Math.PI
  const between = Math.acos(dot(bent, R) / len)
  const apart = Math.abs(reflected - open)
  const cones = smoothstep(1 - saturate((between - apart) / (reflected + open - apart)))
  const second = occlusion(light({ mode: 1 })).skyLightSpecularOcclusion(bent, R, rough, false)
  near(second.specular, mix(mix(0, cones, saturate((open - 0.1) / 0.2)), 1, 0.25), 'cones')
  // A two-sided surface takes the length either way, the strength of the sky light’s specular occlusion scales the open angle.
  near(
    occlusion(light({ mode: 1 })).skyLightSpecularOcclusion(bent, R, rough, true).specular,
    mix(len, 1, 0.25),
    'two-sided',
  )
  const strong = occlusion(light({ mode: 1, strength: 2 })).skyLightSpecularOcclusion(
    bent,
    R,
    rough,
    false,
  )
  assert.notEqual(strong.specular, second.specular)
})

test('a mirror direction past the bent normal’s open sky is occluded, and with no bent normal applied nothing is', () => {
  const bent: Vec3 = [0, 0, 0.9]
  const up = occlusion(light()).skyLightSpecularOcclusion(bent, [0, 0, 1], 0.2, false)
  const down = occlusion(light()).skyLightSpecularOcclusion(bent, [0, 0, -1], 0.2, false)
  assert.ok(down.specular < up.specular, 'looking away from the open sky sees less of it')
  // Almost no sky seen: so short a bent normal has no direction to speak of, the reflection is shadowed outright (the
  // light's least occlusion apart).
  const shut = occlusion(light()).skyLightSpecularOcclusion([0, 0, 0.02], [0, 0, 1], 0.2, false)
  near(shut.specular, 0.25, 'shadowed outright')
  const none = occlusion(light({ applied: 0 })).skyLightSpecularOcclusion(
    bent,
    [0, 0, -1],
    0.2,
    false,
  )
  assert.deepEqual(none, { specular: 1, add: [0, 0, 0] })
})

test('a bent normal and a reflection a rounding apart do not make the angle undefined', () => {
  const bent: Vec3 = [0, 0, 0.5]
  const cone = occlusion(light()).skyLightSpecularOcclusion(bent, [0, 0, 1.0000001], 0.3, false)
  assert.ok(Number.isFinite(cone.specular))
})

test('the tint is the light’s own whether the occlusion is drawn or not, and the plain program lights the sky with the same function', () => {
  const part: SkyLightPart = resolveSkyLight(
    { occlusionTint: [0.1, 0.2, 0.3], minOcclusion: 0.25 },
    {} as SkyLightPart['quality'],
  )
  const words = (use: typeof NO_SKY_LIGHT_OCCLUSION) =>
    writeSkyLightRead(new Float32Array(SKY_LIGHT_READ_WORDS), part, 1, true, 1, use)
  const drawn = words({ ...NO_SKY_LIGHT_OCCLUSION, applied: true })
  const none = words(NO_SKY_LIGHT_OCCLUSION)
  for (const w of [drawn, none]) {
    assert.deepEqual(
      [...w.slice(8, 11)].map((c) => Math.round(c * 10)),
      [1, 2, 3],
    )
  }
  const u = {
    tint: [...none.slice(8, 12)],
    contrast: [...none.slice(12, 16)],
    mode: [...none.slice(16, 20)],
    replaced: [...none.slice(20, 24)],
  } as ReturnType<typeof light>
  const run = occlusion(u)
  // No sky shadowing, material and screen occlusion `others` alone: the diffuse light under it, the tint added for what it lost.
  for (const others of [1, 0.6, 0.1]) {
    const v = run.skyLightVisibility(N, others, N)
    run
      .skyLightDiffuseOccluded(v)
      .forEach((c, i) =>
        near(c, others * (N[i] + 2) + (1 - others) * u.tint[i], `others ${others} channel ${i}`),
      )
  }
})
