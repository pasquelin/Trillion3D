// Screen reflections are traced only under the maximum roughness; past it, and wherever
// a trace holds nothing, the environment/probe reflection is read, never black.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { createScreenReflection, reflectionPlan } from './gpu.ts'
import { withScreenReflections } from './screenWgsl.ts'
import { SCREEN_REFLECTION_CUTOFF as CUTOFF } from './modelShader.ts'
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts'
import { contractLighting } from '../lighting/deferred/contractLighting.fixture.ts'
import { REFLECTION_SOURCE_PASS } from './sourcePass.ts'
import { IRRADIANCE_TERMS } from '../../../sdk-core/src/scene/core/irradianceTerms.ts'
import {
  ENVIRONMENT,
  FILTERED,
  RAY,
  physical,
  resolvedDisplay,
  sceneOf,
} from './receivers.fixture.ts'
import { BOUNCE_LIGHTING_SHADER, DIRECT_LIGHTING_PROGRAM } from '../gpu/core/shaderTexts.fixture.ts'
import { DEFERRED_LIGHTING_PASS } from '../stage/passLabels.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'

test('a matte-only scene allocates no reflection target and runs no reflection pass', async () => {
  const h = await contractLighting()
  // A fully rough floor, a paint at the cutoff and a rough forward receiver: all matte. A mirror
  // beside them is what brings the reflection back.
  for (const [surfaces, reflecting] of [
    [[physical(1), physical(CUTOFF)], false],
    [[physical(1), physical(0)], true],
  ] as const) {
    const rt = sceneOf([...surfaces], [physical(0.8)])
    const gpu = fakeDevice()
    const { active, rough, cone } = reflectionPlan(rt)
    const reflection = createScreenReflection(gpu.device, 64, 32, h.target, active, rough, cone)
    assert.equal(reflection.active, reflecting)
    // An inactive reflection keeps only its 1×1 binding placeholder: no target, no history. An
    // active one holds its source and what it is reprojected from: the last image, depth and ids.
    const sizes = gpu.textures.map(({ size }) => size)
    assert.deepEqual(
      sizes,
      reflecting ? Array(4).fill({ width: 64, height: 32 }) : [{ width: 1, height: 1 }],
    )
    assert.equal(reflection.history, undefined)
    assert.equal(reflection.pyramid, undefined)
    h.passes.length = 0
    h.lighting.light(h.encoder, h.target, reflection)
    const passes = [DEFERRED_LIGHTING_PASS]
    assert.deepEqual(h.labels, reflecting ? [REFLECTION_SOURCE_PASS, ...passes] : passes)
    reflection.dispose()
  }
  h.lighting.dispose()
})

test('a surface rougher than the cutoff takes the environment reflection, a polished one the screen trace', () => {
  const { calls, at } = resolvedDisplay()
  assert.deepEqual(at(0), RAY, 'a mirror keeps its exact ray')
  assert.deepEqual(at(0.2), FILTERED, 'polished metal keeps its screen trace')
  assert.equal(calls.traced, 2)
  // The fade at three quarters of the cutoff the shader reads (`wgslF32`).
  const cutoff = Number(wgslF32(CUTOFF))
  assert.deepEqual(at((3 * cutoff) / 4), [4, 4, 4], 'the fade blends toward the environment')
  calls.traced = 0
  for (const rough of [cutoff, 0.8, 1]) assert.deepEqual(at(rough), ENVIRONMENT, `rough ${rough}`)
  assert.equal(calls.traced, 0, 'no trace past the cutoff')
  assert.deepEqual(resolvedDisplay({ enabled: 0 }).at(0.2), ENVIRONMENT, 'no pass, no trace')
})

/** An environment brighter overhead: a constant and a `y` term (`irradianceBasis.ts`). */
const environment = [[2, 2, 2, 0], [1, 1, 1, 0], ...Array.from({ length: 7 }, () => [0, 0, 0, 0])]
const BUILTINS = { directLights: { environment } }
const UP = [0, 1, 0]
/** The environment's radiance straight up, as a mirror sees it: 2·Y₀ + 1·Y₁(up). */
const OVERHEAD = 2 * IRRADIANCE_TERMS[0].basis + IRRADIANCE_TERMS[1].basis

test('a missed or below-horizon sample returns the environment reflection, not black', () => {
  // The shipped direct program with its screen reflections and rough history: every trace misses,
  // every history texel drew only below-horizon samples (no weight).
  const names = [
    'mirrorWeight',
    'reflectionProbeBands',
    'environmentReflection',
    'reflectedRadiance',
    'resolvedReflectionRay',
    'heldReflection',
    'screenReflectionFade',
    'resolvedRadiance',
    'mirrorRadiance',
    'surfaceMirrorLighting',
    'lobeMirror',
    'mirrorLighting',
    // The maths library's, which the bands and the surface's mirror call.
    'roughnessToAlpha2Chain',
    'ndotvClamped',
    'f0Of',
    'splitSumTerm',
    'clipToUvUnflipped',
  ]
  const direct = shaderRun<{
    mirrorLighting: (...args: [number[], number, number, number[], number[], number[]]) => number[]
    reflectedRadiance: (P: number[], N: number[], R: number[], rough: number) => number[]
  }>(withScreenReflections(DIRECT_LIGHTING_PROGRAM, { history: true }), names, {
    ...BUILTINS,
    surfaceModel: 0,
    ltcLookup: () => [1, 0, 0, 0],
    reflectionView: { enabled: [1, 0, 0, 0] },
    screenReflection: () => [0, 0, 0, 0],
    reflectionProject: () => [0, 0, 0, 1],
    reflectionSize: () => [8, 8],
    roughHistory: 'history',
    textureLoad: () => [0, 0, 0, 0],
  })
  // A white metal looking straight down onto an upward normal reflects the sky overhead.
  const metal = (rough: number) => direct.mirrorLighting([1, 1, 1], 1, rough, UP, UP, [0, 0, 0])
  const mirror = metal(ROUGHNESS_FLOOR)
  for (const x of mirror) assert.ok(Math.abs(x - OVERHEAD) < 1e-3, `a missed mirror ray: ${x}`)
  for (const rough of [0.2, (3 * CUTOFF) / 4, 0.8, 1]) {
    const [r, g, b] = metal(rough)
    assert.ok(
      r > 2 * IRRADIANCE_TERMS[0].basis && r < mirror[0],
      `rough ${rough}: a wider lobe, never black`,
    )
    assert.deepEqual([g, b], [r, r])
  }
  // The bounce program before its first probe answers the same environment.
  const bounce = shaderRun<typeof direct>(
    BOUNCE_LIGHTING_SHADER,
    [...names.slice(1, 4), 'roughnessToAlpha2Chain'],
    {
      ...BUILTINS,
      bounce: { counts: [0, 0, 0, 0] },
    },
  )
  const past = (program: typeof direct) => program.reflectedRadiance([0, 0, 0], UP, UP, 0.8)
  assert.deepEqual(past(bounce), past(direct))
})
