// The look of the light an opaque surface reflects (`reflectionLook`): the light raised to the contrast about the mid grey and multiplied by the scale, then
// weighed (`resolvedWeighed`). The default look (1, 1) changes nothing; a pixel of the opaque resolve gives it to the blend of the rays' answer and the rough
// light, before the weight; a clear coat gives it to its coat's light and to its base lobe's apart; the front layer and the water give none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { reflectionWeighWgsl, resolvedReflectionWgsl } from './weight.ts'

type Vec3 = [number, number, number]
const MID_GREY = 0.18
/** The look of one channel, as the contrast `c` and the scale `s` give it. */
const looked = (light: number, c: number, s: number) => Math.pow(light / MID_GREY, c) * MID_GREY * s
const near = (a: number[], b: number[], what: string) =>
  a.forEach((c, i) => assert.ok(Math.abs(c - b[i]) < 1e-6, `${what} ${i}: ${a} against ${b}`))

const N = [0, 0, 1]
const V = [0, 0, 1]
/** The weight of the environment BRDF, one half of every channel. */
const WEIGHT = 0.5
const weighed = (reflection: number[]) => ({
  view: { reflection },
  reflectionWeight: () => [WEIGHT, WEIGHT, WEIGHT],
})

test('the default look, a contrast of 1 and a scale of 1, leaves the light as it is', () => {
  const { reflectionLook } = shaderRun<{ reflectionLook: (light: Vec3) => Vec3 }>(
    wgslModule(resolvedReflectionWgsl),
    ['reflectionLook'],
    weighed([1, 1, 0, 0]),
  )
  near(reflectionLook([0.02, 0.18, 40]), [0.02, 0.18, 40], 'the light')
  near(reflectionLook([0, 0, 0]), [0, 0, 0], 'black')
})

test('the contrast pivots on the mid grey and the scale multiplies, each channel on its own; a light below black is black', () => {
  const { reflectionLook } = shaderRun<{ reflectionLook: (light: Vec3) => Vec3 }>(
    wgslModule(resolvedReflectionWgsl),
    ['reflectionLook'],
    weighed([0.5, 2, 0, 0]),
  )
  // The mid grey is the pivot: only the scale moves it. A light four times brighter is twice as bright raised to a half.
  near(reflectionLook([MID_GREY, 4 * MID_GREY, 0]), [2 * MID_GREY, 2 * 2 * MID_GREY, 0], 'pivot')
  near(
    reflectionLook([0.05, 1, 9]),
    [looked(0.05, 0.5, 2), looked(1, 0.5, 2), looked(9, 0.5, 2)],
    'channels',
  )
  near(reflectionLook([-0.5, 0, 0]), [0, 0, 0], 'below black')
})

/** `resolvedWeighed` of a pixel whose rays answered `ray` and whose lobes hold the rough lights `base` and `coat`, on the reflectance 1. */
function weighedLobes(reflection: number[], coated: boolean, ray: Vec3, base: Vec3, coat: Vec3) {
  return shaderRun<{ resolvedWeighed: (...args: unknown[]) => Vec3 }>(
    wgslModule(resolvedReflectionWgsl, reflectionWeighWgsl(coated)),
    ['resolvedWeighed'],
    {
      ...weighed(reflection),
      hasCoat: () => coated,
      indirectF0: () => [1, 1, 1],
      lobes: { coat: 0.5, coatRough: 0.2, coatN: [0, 0, 1] },
      lobeRoughness: (rough: number) => rough,
      ndotvClamped: () => 1,
      environmentBrdfPair: () => [1, 0],
      envBrdfF90: () => 1,
    },
  ).resolvedWeighed(ray, base, coat, [1, 1, 1], 0, 0.5, N, V)
}

test('a bare surface’s light is given its look, then weighed', () => {
  const ray: Vec3 = [0.72, 0.18, 0.045]
  near(
    weighedLobes([0.5, 2, 0, 0], false, ray, [0, 0, 0], [9, 9, 9]),
    ray.map((c) => looked(c, 0.5, 2) * WEIGHT),
    'look, then weight',
  )
})

test('a clear coat’s light and its base lobe’s are given their look apart', () => {
  // The coat's ray and the base lobe's rough light under it; the coat holds a quarter (its strength 0.5 times the weight 0.5), the base lobe the three quarters left.
  const ray: Vec3 = [0.18, 0.045, 0.72]
  const base: Vec3 = [0.72, 0.18, 0.045]
  near(
    weighedLobes([0.5, 1, 0, 0], true, ray, base, [0, 0, 0]),
    base.map((c, i) => looked(c, 0.5, 1) * 0.75 + looked(ray[i], 0.5, 1) * 0.25),
    'two looks',
  )
})

test('the front layer’s and the water’s weight gives no look: the reference gives it to the opaque composite alone', () => {
  const { reflectionShare } = shaderRun<{
    reflectionShare: (traced: object, f0: Vec3, rough: number, N: number[], V: number[]) => Vec3
  }>(wgslModule(reflectionWeighWgsl(false)), ['reflectionShare'], weighed([0.5, 2, 0, 0]))
  const traced = { base: [0.72, 0.18, 0.045], coat: [0, 0, 0] }
  near(
    reflectionShare(traced, [1, 1, 1], 0.5, N, V),
    traced.base.map((c) => c * WEIGHT),
    'weight alone',
  )
  assert.doesNotMatch(wgslModule(reflectionWeighWgsl(true)), /reflectionLook/)
})

/** `resolvedReflection` of an opaque pixel whose rays answered `ray` (their share in), its rough light `rough` left `left` of its base lobe. */
function resolved(reflection: number[], ray: number, rough: number, left: number) {
  return shaderRun<{ resolvedReflection: (...args: unknown[]) => Vec3 }>(
    wgslModule(resolvedReflectionWgsl, reflectionWeighWgsl(false)),
    ['resolvedReflection'],
    {
      ...weighed(reflection),
      surfaceModel: 2,
      reflectionTarget: {
        load: (_: number[], layer: number) =>
          layer === 0 ? [ray, ray, ray, 1 - left] : [rough, rough, rough, 0],
      },
      hasCoat: () => false,
      indirectF0: (rgb: number[]) => rgb,
    },
  ).resolvedReflection([0, 0], [1, 1, 1], 0, 1, N, V, 0.5)
}

test('the opaque resolve gives the look to the blend of the rays’ answer and the rough light, before the weight', () => {
  // The rays' answer 0.72 and the rough light 0.18 of a base lobe the rays answer in a half: a blend of 0.72 + 0.09.
  const blend = 0.72 + 0.5 * 0.18
  const expected = looked(blend, 0.5, 2) * WEIGHT
  near(resolved([0.5, 2, 0, 0], 0.72, 0.18, 0.5), [expected, expected, expected], 'the blend')
  // Not each term on its own: the contrast is not linear.
  const apart = (looked(0.72, 0.5, 2) + looked(0.09, 0.5, 2)) * WEIGHT
  assert.ok(Math.abs(expected - apart) > 1e-3, 'the look of the sum is not the sum of the looks')
  // The default look is the plain blend, weighed.
  const plain = blend * WEIGHT
  near(resolved([1, 1, 0, 0], 0.72, 0.18, 0.5), [plain, plain, plain], 'the default look')
})
