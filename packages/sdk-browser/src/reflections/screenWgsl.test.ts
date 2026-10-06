import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BOUNDED_SCREEN_REFLECTION_WGSL,
  TRANSLUCENT_SCREEN_REFLECTION_WGSL,
  withScreenReflections,
} from './screenWgsl.ts'
import {
  MIRROR_TRANSITION_END,
  TRANSLUCENT_SCREEN_REFLECTION_MAX_ROUGHNESS,
  mirrorWeightShader,
} from './modelShader.ts'
import { ROUGHNESS_FLOOR } from '../lighting/shaderConstants.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { REFLECTION_SOURCE_WGSL } from './sourceWgsl.ts'
import { ENVIRONMENT, FILTERED, RAY, resolvedDisplay } from './receivers.fixture.ts'
import { functionText } from '../bounce/wgslBody.fixture.ts'
import { DIRECT_LIGHTING_SHADER } from '../gpu/core/shaderTexts.fixture.ts'

test('a screen hit replaces the fallback; a miss or a disabled pass reads it, once', () => {
  const read = (options: Parameters<typeof resolvedDisplay>[0], rough: number) => {
    const { calls, at } = resolvedDisplay(options)
    return { value: at(rough), fallback: calls.fallback }
  }
  assert.deepEqual(read({}, 0), { value: RAY, fallback: 0 })
  assert.deepEqual(read({ hit: false }, 0), { value: ENVIRONMENT, fallback: 1 })
  assert.deepEqual(read({ enabled: 0 }, 0), { value: ENVIRONMENT, fallback: 1 })
  assert.deepEqual(read({}, 0.2), { value: FILTERED, fallback: 0 })
  assert.deepEqual(read({ hit: false }, 0.2), { value: ENVIRONMENT, fallback: 1 })
  assert.deepEqual(read({ weight: () => 0.5 }, 0.2), { value: [6, 6, 6], fallback: 0 })
  // In the roughness fade one read serves both the lobe share the trace left and the fade.
  assert.deepEqual(read({}, 0.45), { value: [4, 4, 4], fallback: 1 })
  assert.deepEqual(read({ hit: false }, 0.45), { value: ENVIRONMENT, fallback: 1 })
})

test('the source reprojects the last lit image and lights nothing itself', () => {
  const body = functionText(REFLECTION_SOURCE_WGSL, 'reprojectReflectionSource')
  assert.match(body, /previousUv\(/)
  assert.doesNotMatch(REFLECTION_SOURCE_WGSL, /lightSurface|mirrorLighting|bounceLighting|fogged/)
})

test('the final direct resolve adds screen reflections over the environment, with no proxy', () => {
  const shader = withScreenReflections(DIRECT_LIGHTING_SHADER, true)
  assert.match(functionText(shader, 'lightSurface'), /mirrorLighting/)
  assert.match(functionText(shader, 'mirrorLighting'), /resolvedRadiance/)
  assert.match(functionText(shader, 'reflectedRadiance'), /return environmentReflection\(R,rough\)/)
  assert.doesNotMatch(shader, /rayRadiance/)
})

test('the water mirror walks the depth bounds; a miss reads the filtered probes, no proxy ray', () => {
  const read = (hit: boolean) => {
    let walks = 0,
      filteredAt: number | undefined
    const { calls, at } = resolvedDisplay({
      shader: BOUNDED_SCREEN_REFLECTION_WGSL,
      functions: ['boundedReflectionRay'],
      globals: {
        shadowFootprint: 0,
        screenReflection: () => (walks++, hit ? [...RAY, 1] : [0, 0, 0, 0]),
        filteredReflectedRadiance: (...args: number[]) => ((filteredAt = args[3]), FILTERED),
      },
    })
    const value = at(0)
    return { value, walks, fullWalks: calls.traced, fallback: calls.fallback, filteredAt }
  }
  const none = { walks: 1, fullWalks: 0, fallback: 0 }
  assert.deepEqual(read(true), { ...none, value: RAY, filteredAt: undefined })
  assert.deepEqual(read(false), {
    ...none,
    value: FILTERED,
    filteredAt: Number(MIRROR_TRANSITION_END),
  })
})

test('a blended surface traces its mirror ray once: the full walk in the mirror transition, its march past it', () => {
  const { mirrorWeight } = shaderRun<{ mirrorWeight: (rough: number) => number }>(
    mirrorWeightShader('wgsl'),
    ['mirrorWeight'],
    {},
  )
  const floor = Number(ROUGHNESS_FLOOR)
  const end = Number(MIRROR_TRANSITION_END)
  // A fallback that tells the roughness it is read at.
  const fallback = (rough: number) => [1 + rough, 2 + rough, 3 + rough]
  const atFloor = fallback(floor)
  let hit = true,
    marchHit = true,
    walks = 0,
    marches = 0
  const { at } = resolvedDisplay({
    shader: TRANSLUCENT_SCREEN_REFLECTION_WGSL,
    weight: mirrorWeight,
    globals: {
      screenReflection: () => (walks++, hit ? [...RAY, 1] : [0, 0, 0, 0]),
      translucentReflectionMarch: () => (marches++, marchHit ? [...FILTERED, 1] : [0, 0, 0, 0]),
      reflectedRadiance: (...args: number[]) => fallback(args[3]!),
    },
  })
  const read = (hits: boolean, rough: number, marchHits = hits) => {
    hit = hits
    marchHit = marchHits
    walks = marches = 0
    return { value: at(rough), walks, marches }
  }
  for (let k = 1; k < 8; k++) {
    const rough = floor + ((end - floor) * k) / 8
    const weight = mirrorWeight(rough)
    assert.ok(weight > 0 && weight < 1, `${rough} lies in the transition`)
    assert.deepEqual(
      read(true, rough),
      { value: RAY, walks: 1, marches: 0 },
      `${rough}: the walk's hit`,
    )
    const missed = read(false, rough)
    assert.deepEqual([missed.walks, missed.marches], [1, 0], `${rough}: one walk`)
    // Where the two tracers disagree the walk alone answers.
    assert.deepEqual(read(true, rough, false).value, RAY)
    assert.deepEqual(read(false, rough, true).value, missed.value)
    fallback(rough).forEach((x, i) => {
      const mixed = x + (atFloor[i]! - x) * weight
      assert.ok(Math.abs(missed.value[i]! - mixed) < 1e-12, `${rough}: ${missed.value[i]}`)
    })
  }
  // A mirror walks; a surface past the transition marches, a miss on the fallback at its roughness;
  // one past the translucent fade traces nothing.
  const faded = Number(TRANSLUCENT_SCREEN_REFLECTION_MAX_ROUGHNESS)
  for (const [hits, rough, value, walked, marched] of [
    [true, floor, RAY, 1, 0],
    [false, floor, atFloor, 1, 0],
    [true, end, FILTERED, 0, 1],
    [false, end, fallback(end), 0, 1],
    [true, 0.1, FILTERED, 0, 1],
    [false, 0.1, fallback(0.1), 0, 1],
    [true, faded, fallback(faded), 0, 0],
  ] as const) {
    assert.deepEqual(read(hits, rough), { value, walks: walked, marches: marched }, `${rough}`)
  }
})
