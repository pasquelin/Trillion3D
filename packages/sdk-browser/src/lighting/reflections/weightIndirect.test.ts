// The opaque resolve's indirect light (`resolvedIndirect`) and the lobes' weights (`reflectionCoatShare`, `reflectionBaseShare`),
// run in JavaScript by `shaderRun`: the rough light of a pixel the screen probes read, of one they left unread while they gather and of
// one they never gathered, the environment a ray that leaves the scene reaches (black without a sky light, a mirror's floor of roughness
// with one), and the clear coat's own roughness in its share. `reflectionShare` stands for the lobes' look and weight where the lights
// they are given are read (`weightLook.test.ts` runs it).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { ROUGHNESS_FLOOR } from '../shaderConstants.ts'
import {
  reflectionEnvironmentLobesWgsl,
  reflectionWeighWgsl,
  RESOLVED_INDIRECT_WGSL,
  resolvedReflectionWgsl,
} from './weight.ts'

type Vec3 = [number, number, number]
const near = (a: number[], b: number[], what: string) =>
  a.forEach((c, i) => assert.ok(Math.abs(c - b[i]) < 1e-6, `${what} ${i}: ${a} against ${b}`))

const N = [0, 0, 1]
const V = [0, 0, 1]
/** The target the last pass wrote for a base lobe flagged for the rough light (alpha −1): the rays' answer `rays`; `rough` the environment the sky's cube gives. */
const texels = { rays: [1, 2, 3, -1], rough: [4, 5, 6, 0] }
/** The sum of the lights the two lobes are given, which the weights are applied to. */
const sumOfLobes = (lights: { base: Vec3; coat: Vec3 }) =>
  lights.base.map((c, i) => c + lights.coat[i])

/** `resolvedIndirect` of a pixel over the target above: `read` whether the screen probes left light for the pixel, `only` whether the view's mode is
 *  the probes' occlusion alone, `sky` whether a sky light shines. The probes' light is (0.1, 0.2, 0.3), their rough specular 2 under an occlusion of a half. */
const indirect = (read: boolean, only: boolean, sky = false) =>
  shaderRun<{ resolvedIndirect: (...args: unknown[]) => Vec3[] }>(
    RESOLVED_INDIRECT_WGSL,
    ['resolvedIndirect'],
    {
      surfaceModel: 2,
      view: { reflection: [1, 1, 0, 0] },
      reflectionTarget: {
        load: (_: number[], layer: number) => [texels.rays, [0, 0, 0, 0]][layer],
      },
      reflectionEnvironment: () => texels.rough.slice(0, 3),
      hasCoat: () => false,
      reflectionShare: sumOfLobes,
      mat2x3f: (diffuse: Vec3, rest: Vec3) => [diffuse, rest],
      screenIndirectAt: () => [0, 0, 0, 1],
      screenLights: () => read && !only,
      screenOcclusionOnly: () => only,
      clothDiffuse: (rgb: number[]) => [...rgb, 1],
      screenDiffuse: () => [0.1, 0.2, 0.3],
      bounceLighting: () => [1, 1, 1],
      screenShortRange: () => [0.5, 0.5, 0.5],
      screenShortRangeGiAt: () => [0, 0, 0],
      lambertDiffuse: () => [0, 0, 0],
      screenRoughAt: () => [2, 2, 2],
      screenSpecularOcclusion: () => 0.5,
      skyLit: () => sky,
      indirectF0: (rgb: number[]) => rgb,
    },
  ).resolvedIndirect([0, 0], [0.5, 0.5, 0.5], 0, 0.5, N, V, [0, 0, 0], 1, 1, false)

test('a pixel the screen probes left unread while they gather has no rough light, as it has no diffuse: the rays’ share alone', () => {
  const [diffuse, specular] = indirect(false, false)
  near(diffuse, [0, 0, 0], 'no diffuse')
  near(specular, [1, 2, 3], 'the rays alone, not the environment of the last pass')
})

test('where the probes gather no light the environment the last pass wrote is the pixel’s rough light, under the occlusion of the view', () => {
  const [diffuse, specular] = indirect(false, true)
  near(diffuse, [0.5, 0.5, 0.5], 'the sky light’s diffuse under the probes’ occlusion')
  near(specular, [5, 7, 9], 'the rays and the environment')
})

test('the pixel the probes read takes their rough specular on its own reflectance, under their occlusion, in the place of the environment where a sky light shines', () => {
  // 2 × a half (their occlusion), as the lobe's rough light.
  const probes = 2 * 0.5
  const unlit = indirect(true, false)
  near(unlit[0], [0.1, 0.2, 0.3], 'their diffuse')
  near(
    unlit[1],
    [5 + probes, 7 + probes, 9 + probes],
    'the environment where no sky shines, and the probes',
  )
  const lit = indirect(true, false, true)
  near(lit[1], [1 + probes, 2 + probes, 3 + probes], 'the probes alone where a sky light shines')
})

test('without a sky light the environment a ray reaches is black, so the occlusions it is multiplied by change nothing; with one it is the sky’s at the lobe’s floor of roughness', () => {
  const asked: number[] = []
  const environmentOf = (shining: boolean) =>
    shaderRun<{ reflectionEnvironmentOf: (N: Vec3, V: Vec3, rough: number) => { base: Vec3 } }>(
      wgslModule(reflectionEnvironmentLobesWgsl(false)),
      ['reflectionEnvironmentOf'],
      {
        reflectionView: { light: [40, 0, 0, 0] },
        skyLightApplied: () => shining,
        skyLightReflection: (_: number[], rough: number) => (asked.push(rough), [0.5, 0.25, 0.125]),
      },
    ).reflectionEnvironmentOf([0, 0, 1], [0, 0, 1], 0)
  const dark = environmentOf(false)
  near(dark.base, [0, 0, 0], 'no sky light: black')
  assert.deepEqual(asked, [], 'the sky is not even read')
  // That black is the environment the resolve samples: under any occlusion the resolve adds nothing to the rays.
  for (const occluded of [1, 0.4, 0]) {
    const resolved = shaderRun<{ resolvedReflection: (...args: unknown[]) => Vec3 }>(
      resolvedReflectionWgsl,
      ['resolvedReflection'],
      {
        surfaceModel: 2,
        view: { reflection: [1, 1, 0, 0] },
        reflectionTarget: {
          load: (_: number[], layer: number) =>
            [
              [1, 2, 3, -1],
              [0, 0, 0, 0],
            ][layer],
        },
        reflectionEnvironment: () => dark.base,
        hasCoat: () => false,
        indirectF0: (rgb: number[]) => rgb,
        reflectionShare: sumOfLobes,
      },
    ).resolvedReflection([0, 0], [0.5, 0.5, 0.5], 0, occluded, N, V, 0.5)
    near(resolved, [1, 2, 3], `occluded ${occluded}`)
  }
  near(environmentOf(true).base, [0.5, 0.25, 0.125], 'a sky light shines: its cube')
  // A mirror (roughness 0) reads the sky at the floor of roughness every lobe is held to, never at 0.
  assert.ok(asked.length > 0 && asked.every((rough) => Math.abs(rough - ROUGHNESS_FLOOR) < 1e-6))
})

test('a rough clear coat is weighed on its own roughness and normal, the base lobe under it on the coat’s share', () => {
  const asked: number[] = []
  const run = shaderRun<{
    reflectionCoatShare: (traced: object, V: Vec3) => Vec3
    reflectionBaseShare: (traced: object, f0: Vec3, rough: number, N: Vec3, V: Vec3) => Vec3
  }>(wgslModule(reflectionWeighWgsl(true)), ['reflectionCoatShare', 'reflectionBaseShare'], {
    hasCoat: () => true,
    view: { reflection: [1, 1, 0, 0] },
    lobes: { coat: 0.5, coatRough: 0.9, coatN: [0, 0, 1] },
    // The weight of the environment BRDF is its roughness here, to read which roughness it is asked at.
    reflectionWeight: (_f0: number[], _f90: number, rough: number) => (
      asked.push(rough),
      [rough, rough, rough]
    ),
    lobeRoughness: (rough: number) => rough,
    ndotvClamped: () => 1,
    shadingEnergyPair: () => [1, 0],
    envBrdfF90: () => 1,
  })
  const traced = { base: [2, 2, 2], coat: [1, 2, 3] }
  // The coat's radiance times its strength times its weight at its roughness 0.9.
  near(run.reflectionCoatShare(traced, [0, 0, 1]), [0.45, 0.9, 1.35], 'the coat')
  assert.equal(asked.length, 1)
  assert.ok(Math.abs(asked[0] - 0.9) < 1e-6, `at the coat’s roughness: ${asked}`)
  // The base lobe: its reflectance (1) with nothing of the grazing part left by half a coat (specular F90 times 0), under one minus the coat's
  // own reflectance 0.5 × 0.9.
  near(
    run.reflectionBaseShare(traced, [1, 1, 1], 0.2, [0, 0, 1], [0, 0, 1]),
    [1.1, 1.1, 1.1],
    'the base under the coat',
  )
})

test('a surface whose roughness is 0 still weighs and reads the environment at the floor every lobe is held to', () => {
  const asked: number[] = []
  const run = shaderRun<{
    reflectionEnvironmentOf: (N: Vec3, V: Vec3, rough: number) => { base: Vec3; coat: Vec3 }
  }>(wgslModule(reflectionEnvironmentLobesWgsl(false)), ['reflectionEnvironmentOf'], {
    reflectionView: { light: [40, 0, 0, 0] },
    skyLightApplied: () => true,
    skyLightReflection: (_: number[], rough: number) => (asked.push(rough), [1, 1, 1]),
  })
  const mirror = run.reflectionEnvironmentOf([0, 0, 1], [0, 0, 1], 0)
  near(mirror.base, [1, 1, 1], 'the sky')
  near(mirror.coat, [1, 1, 1], 'a surface with no coat: the base lobe’s environment for both')
  assert.ok(
    asked.every((rough) => Math.abs(rough - ROUGHNESS_FLOOR) < 1e-6),
    `${asked}`,
  )
})

test('each pass weighs on the grazing reflectance of its own rule: the green channel’s for the opaque composite, the greatest channel’s forward', () => {
  const rule = (code: string) =>
    /fn reflectionF90\(f0:vec3f\)->f32\{return (\w+)\(f0\);\}/.exec(code)?.[1]
  assert.equal(rule(wgslModule(reflectionWeighWgsl(true))), 'envBrdfF90')
  assert.equal(rule(wgslModule(reflectionWeighWgsl(false))), 'envBrdfF90')
  assert.equal(rule(wgslModule(reflectionWeighWgsl(true, 'slab'))), 'slabF90')
  assert.equal(rule(wgslModule(reflectionWeighWgsl(false, 'slab'))), 'slabF90')
  // The green channel's grazing value, and the greatest channel's, for a reflectance whose green is the least of its channels.
  const f0 = [0.02, 0.004, 0.01]
  const { envBrdfF90, slabF90 } = shaderRun<{
    envBrdfF90: (f0: number[]) => number
    slabF90: (f0: number[]) => number
  }>(
    wgslModule(reflectionWeighWgsl(true)) + '\n' + wgslModule(reflectionWeighWgsl(true, 'slab')),
    ['envBrdfF90', 'slabF90'],
    {},
  )
  assert.ok(
    Math.abs(envBrdfF90(f0) - 0.2) < 1e-6 && Math.abs(slabF90(f0) - 1) < 1e-6,
    `${envBrdfF90(f0)} ${slabF90(f0)}`,
  )
})
