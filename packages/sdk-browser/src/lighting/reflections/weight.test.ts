// The opaque resolve's reflection (`resolvedReflection`, `resolvedReflectionOccluded`) on the target the last pass wrote: layer 0 what the
// rays answer, the radiance of the lobe they serve, with the base lobe's share in its alpha, layer 1 the environment through the base lobe, the rough
// light of both lobes, with the coat's left share in its alpha. The rough light is the same for both lobes and goes under the specular occlusion
// for both. The lights each lobe is given are read here (`reflectionShare` stands for their look and weight, `weightLook.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { resolvedReflectionOccludedWgsl, resolvedReflectionWgsl } from './weight.ts'

type Vec3 = [number, number, number]
interface Texels {
  /** The rays' answer with the base lobe's share in its alpha. */
  rays: number[]
  /** The environment through the base lobe. */
  rough?: number[]
  /** The share of the coat's lobe the rays leave to the rough light; a pixel with a coat when given. */
  coatLeft?: number
}
interface Lights {
  base: Vec3
  coat: Vec3
}

const N = [0, 0, 1]
const V = [0, 0, 1]
/** The lights the last call gave the lobes. */
let given: Lights
/** The target answering `texels` layer by layer, the surface reflecting; `reflectionShare` sums the two lobes' lights. */
const target = (texels: Texels) => ({
  surfaceModel: 2,
  view: { reflection: [1, 1, 0, 0] },
  reflectionTarget: {
    load: (_: number[], layer: number) =>
      layer === 0 ? texels.rays : [...(texels.rough ?? [0, 0, 0]), texels.coatLeft ?? 0],
  },
  hasCoat: () => texels.coatLeft !== undefined,
  indirectF0: (rgb: number[]) => rgb,
  reflectionShare: (lights: Lights) => {
    given = lights
    return lights.base.map((c, i) => c + lights.coat[i])
  },
})
const near = (a: number[], b: number[], what: string) =>
  a.forEach((c, i) => assert.ok(Math.abs(c - b[i]) < 1e-6, `${what} ${i}: ${a} against ${b}`))

const plain = (texels: Texels, occluded = 1) =>
  shaderRun<{ resolvedReflection: (...args: unknown[]) => Vec3 }>(
    resolvedReflectionWgsl,
    ['resolvedReflection'],
    target(texels),
  ).resolvedReflection([0, 0], [0.5, 0.5, 0.5], 0, occluded, N, V, 0.5)

const sky = (
  texels: Texels,
  skySpecular: number,
  skyAdd: Vec3,
  coatSpecular = 1,
  coatAdd: Vec3 = [0, 0, 0],
) =>
  shaderRun<{ resolvedReflectionOccluded: (...args: unknown[]) => Vec3 }>(
    resolvedReflectionOccludedWgsl,
    ['resolvedReflectionOccluded'],
    { ...target(texels), reflectionWeight: () => [0.5, 0.5, 0.5], coatLayerKeep: () => 0.75 },
  ).resolvedReflectionOccluded(
    [0, 0],
    [0.5, 0.5, 0.5],
    0,
    1,
    N,
    V,
    0.5,
    skySpecular,
    skyAdd,
    coatSpecular,
    coatAdd,
  )

test('a pixel the rays answer whole adds nothing of the rough light, its coat’s included', () => {
  assert.deepEqual(plain({ rays: [1, 2, 3, 1], coatLeft: 0 }), [1, 2, 3])
  assert.deepEqual(sky({ rays: [1, 2, 3, 1], coatLeft: 0 }, 0.25, [1, 1, 1]), [1, 2, 3])
})

test('a base lobe flagged for the rough light takes the environment of layer 1 and keeps the rays’ answer', () => {
  // Flagged (alpha −1): the whole of the base lobe is the rough light, and the colour, the rays' answer, is added to it.
  near(plain({ rays: [1, 2, 3, -1], rough: [4, 5, 6] }), [5, 7, 9], 'bare')
  near(plain({ rays: [1, 2, 3, -1], rough: [4, 5, 6] }, 0), [1, 2, 3], 'occluded away')
  // A base lobe the rays answer in a quarter leaves the rest of it, three quarters, to the rough light.
  near(plain({ rays: [1, 2, 3, 0.25], rough: [4, 5, 6] }), [1 + 3, 2 + 3.75, 3 + 4.5], 'a quarter')
})

test('a bare pixel’s base lobe takes the rays’ answer and its rough light, and its coat none', () => {
  plain({ rays: [1, 2, 3, 0.25], rough: [4, 5, 6] })
  near(given.base, [1 + 3, 2 + 3.75, 3 + 4.5], 'the base lobe')
  assert.deepEqual(given.coat, [0, 0, 0])
})

test('a coated pixel’s coat takes the rays’ answer and the share of the rough light it is left, its base lobe under it the rough light alone', () => {
  // The base lobe is flagged for the rough light whole (alpha −1), the coat's lobe a half to it.
  plain({ rays: [1, 2, 3, -1], rough: [4, 5, 6], coatLeft: 0.5 })
  near(given.base, [4, 5, 6], 'the base lobe, the rough light alone')
  near(given.coat, [1 + 2, 2 + 2.5, 3 + 3], 'the coat: the rays and half the rough light')
  // The coat's lobe answered whole leaves it none, under the same occlusion on both lobes.
  plain({ rays: [1, 2, 3, -1], rough: [4, 5, 6], coatLeft: 0 }, 0)
  near(given.base, [0, 0, 0], 'occluded away')
  near(given.coat, [1, 2, 3], 'the rays alone')
  // A surface without a coat reads no coat share.
  plain({ rays: [0, 0, 0, -1], rough: [4, 5, 6] })
  near(given.coat, [0, 0, 0], 'no coat')
})

test('under the sky light’s occlusion each lobe takes its own specular and the tint of what it took: the base lobe’s weighed under the coat, the coat’s by what the coat holds', () => {
  // The base lobe's tint is the weight (0.5) times what the coat lets through (0.75).
  const tint = [0.2, 0.4, 0.6]
  const bare = sky({ rays: [0, 0, 0, -1], rough: [1, 2, 3] }, 0.25, tint as Vec3)
  near(bare, [1 * 0.25 + 0.2 * 0.375, 2 * 0.25 + 0.4 * 0.375, 3 * 0.25 + 0.6 * 0.375], 'base lobe')
  // The coat's rough light, the environment (1, 2, 3) under its own specular occlusion 0.5, plus its tint (0.4, 0.2, 0.1) by what the coat holds (1 - 0.75).
  const coated = sky(
    { rays: [0, 0, 0, -1], rough: [1, 2, 3], coatLeft: 1 },
    0.25,
    tint as Vec3,
    0.5,
    [0.4, 0.2, 0.1],
  )
  near(
    coated,
    bare.map((c, i) => c + [0.5, 1, 1.5][i] + [0.1, 0.05, 0.025][i]),
    'with a coat',
  )
  // The coat's half of its lobe left to the rough light weighs both terms by that half.
  const half = sky(
    { rays: [0, 0, 0, 1], rough: [10, 20, 30], coatLeft: 0.5 },
    0.25,
    tint as Vec3,
    0.5,
    [0.4, 0.2, 0.1],
  )
  near(half, [0.5 * (5 + 0.1), 0.5 * (10 + 0.05), 0.5 * (15 + 0.025)], 'half of the coat')
})
