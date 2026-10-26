import assert from 'node:assert/strict'
import test from 'node:test'
import type { SceneLight } from './contracts.ts'
import { validateSceneLight } from './validate.ts'
import { sameSceneLight } from './equal.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'
import { createSceneLightStore } from './store.ts'
import { brightnessOf } from './fields.ts'
import { LIGHT_UNITS, type LightUnits } from './lightUnits.ts'

const panel = (direction: number[], right: number[]): SceneLight =>
  ({
    id: 'panel',
    kind: 'rect',
    position: [0, 3, 0],
    range: 20,
    color: [1, 1, 1],
    intensity: 4,
    castsShadow: false,
    direction,
    right,
    size: [2, 1],
  }) as SceneLight

/** A point of the cube [−1, 1]³ from three Halton bases. */
const swept = (index: number, bases: number[]) => bases.map((base) => 2 * halton(index, base) - 1)

test('a rect width axis is the right minus its part along the normal, then unit, bit for bit', () => {
  // The former expression, word for word: the dot summed left to right, then each component
  // minus `along` times the normal's, then divided by `Math.hypot`.
  for (let i = 1; i <= 4096; i++) {
    const light = panel(swept(i, [2, 3, 5]), swept(i, [7, 3, 2]))
    const length = Math.hypot(...(light.direction as number[]))
    const normal = (light.direction as number[]).map((n) => n / length)
    const right = light.right as number[]
    const along = right[0] * normal[0] + right[1] * normal[1] + right[2] * normal[2]
    const residual = [0, 1, 2].map((k) => right[k] - along * normal[k])
    const rest = Math.hypot(...residual)
    let validated: SceneLight
    try {
      validated = validateSceneLight(light)
    } catch {
      assert.ok(!(length > 1e-6 && rest > 1e-6), `light ${i} refused`)
      continue
    }
    assert.ok(length > 1e-6 && rest > 1e-6, `light ${i} accepted`)
    assert.deepEqual(validated.direction, normal)
    assert.deepEqual(
      validated.right,
      residual.map((r) => r / rest),
    )
  }
})

test('a rect casts a shadow as a point does, and shadows the fog; it has no source radius', () => {
  const casting = { ...panel([0, -1, 0], [1, 0, 0]), castsShadow: true }
  const kept = validateSceneLight({ ...casting, shadowsFog: true })
  assert.equal(kept.castsShadow, true)
  assert.equal(kept.shadowsFog, true)
  // A point has the same two switches.
  const point = {
    ...casting,
    kind: 'point',
    direction: undefined,
    right: undefined,
    size: undefined,
  }
  assert.equal(validateSceneLight({ ...point, shadowsFog: true } as SceneLight).shadowsFog, true)
  // The radius of a point's or a spot's source is not a rectangle's: it has none.
  assert.throws(
    () => validateSceneLight({ ...casting, emitterRadius: 0.1 }),
    /emitterRadius exists only for a point or a spot/,
  )
})

test('a local light’s shadow resolution scale is a number of at least 0; a sun has none', () => {
  const casting = { ...panel([0, -1, 0], [1, 0, 0]), castsShadow: true }
  for (const scale of [0, 0.5, 1, 8])
    assert.equal(
      validateSceneLight({ ...casting, shadowResolutionScale: scale }).shadowResolutionScale,
      scale,
    )
  assert.equal(
    validateSceneLight(casting).shadowResolutionScale,
    undefined,
    'absent stays absent: 1',
  )
  for (const bad of [-1, NaN, Infinity, '2', null])
    assert.throws(
      () => validateSceneLight({ ...casting, shadowResolutionScale: bad as number }),
      /shadowResolutionScale must be >= 0/,
    )
  const sun = {
    ...{ id: 's', kind: 'directional', direction: [0, -1, 0], color: [1, 1, 1], intensity: 1 },
    ...{ castsShadow: true, shadowResolutionScale: 2 },
  } as SceneLight
  assert.throws(
    () => validateSceneLight(sun),
    /shadowResolutionScale exists only for a point, a spot or a rect/,
  )
  // A light that changes it is another light to the store: the gate reads it.
  assert.equal(sameSceneLight(casting, { ...casting, shadowResolutionScale: 2 }), false)
  assert.equal(
    sameSceneLight(casting, { ...casting, shadowResolutionScale: 1 }),
    true,
    '1 is the default',
  )
})

test('a direction keeps its unit length however long it is given', () => {
  // `Math.hypot` holds the length where the plain sum of squares overflows to infinity.
  assert.deepEqual(validateSceneLight(panel([0, 0, -1e200], [3e180, 0, 0])).direction, [0, 0, -1])
  assert.deepEqual(validateSceneLight(panel([0, 0, -1e200], [3e180, 0, 0])).right, [1, 0, 0])
  assert.throws(() => validateSceneLight(panel([0, 1e-7, 0], [1, 0, 0])), /zero-length/)
  assert.throws(() => validateSceneLight(panel([0, 1, 0], [0, 2, 0])), /zero-length/)
})

test('the air index of a directional light is 0 or 1, and no other light has one', () => {
  const sun = {
    id: 's',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: false,
  } as SceneLight
  assert.equal(validateSceneLight({ ...sun, atmosphereSunIndex: 1 }).atmosphereSunIndex, 1)
  assert.equal(validateSceneLight(sun).atmosphereSunIndex, undefined, 'absent stays absent: 0')
  for (const index of [2, -1, 0.5, '1', null])
    assert.throws(
      () => validateSceneLight({ ...sun, atmosphereSunIndex: index as 0 }),
      /atmosphereSunIndex expects 0 or 1/,
    )
  const point = {
    ...sun,
    kind: 'point',
    position: [0, 0, 0],
    range: 5,
    direction: undefined,
  } as SceneLight
  assert.throws(
    () => validateSceneLight({ ...point, atmosphereSunIndex: 1 }),
    /exists only for a directional/,
  )
})

test('the shadow distance of a directional light is a finite number of metres, and no other light has one', () => {
  const sun = {
    id: 's',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: true,
  } as SceneLight
  assert.equal(validateSceneLight({ ...sun, shadowDistance: 250 }).shadowDistance, 250)
  assert.equal(validateSceneLight({ ...sun, shadowDistance: 0 }).shadowDistance, 0, 'none')
  assert.equal(validateSceneLight(sun).shadowDistance, undefined, 'absent stays absent: 400')
  for (const distance of [-1, NaN, Infinity, '400', null])
    assert.throws(
      () => validateSceneLight({ ...sun, shadowDistance: distance as number }),
      /shadowDistance: must be a finite number of metres of at least 0/,
    )
  const lamp = { ...sun, kind: 'point', position: [0, 0, 0], range: 5, direction: undefined }
  assert.throws(
    () => validateSceneLight({ ...lamp, shadowDistance: 100 } as SceneLight),
    /shadowDistance exists only for a directional/,
  )
  // A light that changes its distance is another light: its shadow pages restart.
  assert.equal(sameSceneLight(sun, { ...sun, shadowDistance: 250 }), false)
  assert.equal(
    sameSceneLight({ ...sun, shadowDistance: 250 }, { ...sun, shadowDistance: 250 }),
    true,
  )
  // As a light whose cascades or distance-field cascade differ; a default written out is the absent one.
  for (const patch of [
    { shadowCascades: 2 },
    { distanceFieldShadows: false },
    { farShadowCascades: 1 },
  ])
    assert.equal(sameSceneLight(sun, { ...sun, ...patch }), false, JSON.stringify(patch))
  assert.equal(sameSceneLight(sun, { ...sun, shadowCascades: 4, shadowDistance: 400 }), true)
  // A distance written `false`, as a host writes it, is read as none (`validateLightShadow`): the
  // record's own field is a number.
  const fuller = validateSceneLight({
    ...sun,
    shadowCascades: 2,
    distanceFieldShadowDistance: false,
  } as never)
  assert.deepEqual([fuller.shadowCascades, fuller.distanceFieldShadowDistance], [2, 0])
  assert.throws(
    () => validateSceneLight({ ...sun, shadowCascades: 1.5 }),
    /shadowCascades: must be/,
  )
  assert.throws(
    () => validateSceneLight({ ...lamp, distanceFieldShadows: true } as SceneLight),
    /distanceFieldShadows exists only for a directional/,
  )
})

test('a scene’s sharpening is read from 0 to the tonemapper’s 10, as the reference’s clamp has it', () => {
  const store = createSceneLightStore()
  for (const sharpness of [0, 1, 4.5, 10]) {
    store.setEnvironment({ exposure: 1, sharpness })
    assert.equal(store.environment!.sharpness, sharpness)
  }
  for (const sharpness of [-0.1, 10.5, Number.NaN])
    assert.throws(
      () => store.setEnvironment({ exposure: 1, sharpness }),
      /sharpness must be in \[0, 10\]/,
    )
})

test('a light kind is one of the contract’s own: a word that only an object inherits is refused too', () => {
  const point = { id: 'p', kind: 'point', position: [0, 1, 0], range: 5, color: [1, 1, 1] } as const
  const lamp = { ...point, intensity: 2, castsShadow: false } as SceneLight
  assert.equal(validateSceneLight(lamp).kind, 'point')
  for (const kind of ['rectArea', 'constructor', 'toString', '__proto__', '', 3])
    assert.throws(
      () => validateSceneLight({ ...lamp, kind } as never),
      { code: 'INVALID_SCENE_LIGHT' },
      String(kind),
    )
})

/** The reference's brightness of a lamp in its centimetre units, from its intensity and unit, kept
 *  out of the engine's code: a point or spot's 1/r² candelas times 100², a capsule's area in cm²
 *  for a nit, the sphere's 4π or the cone's 2π (1 − cos) for a lumen, `2^ev` times 100², 16 a
 *  unitless; a rect's lumen over π, its nit over its face, its radiance that over half the face. */
function referenceBrightness(
  kind: 'point' | 'spot' | 'rect',
  units: LightUnits,
  intensity: number,
  cm: { radius: number; length: number; cos: number; width: number; height: number },
) {
  const area =
    kind === 'rect' ? cm.width * cm.height : 4 * Math.PI * cm.radius * (cm.radius + 0.5 * cm.length)
  const lumen =
    kind === 'rect' ? Math.PI : kind === 'spot' ? 2 * Math.PI * (1 - cm.cos) : 4 * Math.PI
  const scale = {
    candelas: 100 * 100,
    nits: area,
    lumens: (100 * 100) / lumen,
    unitless: 16,
    ev: 0,
  }
  const b = units === 'ev' ? 2 ** intensity * 100 * 100 : intensity * scale[units]
  return kind === 'rect' ? b / (0.5 * cm.width * cm.height) : b / (100 * 100)
}

test('a lamp of each unit shines what the reference makes of it, and a sun its lux', () => {
  // The GPU holds candelas for a point or spot, a radiance for a rect: the reference's brightness
  // of the same lamp, read back to metres (a spot's cone from its clamped outer half-angle).
  const cone = 0.6
  const cm = { radius: 20, length: 40, cos: Math.cos(cone), width: 200, height: 100 }
  const at = { position: [0, 0, 0], range: 10, color: [1, 1, 1], castsShadow: false }
  const lamps = {
    point: { ...at, kind: 'point', emitterRadius: 0.2, emitterLength: 0.4 },
    spot: {
      ...at,
      kind: 'spot',
      direction: [0, -1, 0],
      outerConeAngle: cone,
      innerConeAngle: cone / 2,
      emitterRadius: 0.1,
    },
    rect: { ...at, kind: 'rect', direction: [0, -1, 0], right: [1, 0, 0], size: [2, 1] },
  } as const
  for (const [kind, lamp] of Object.entries(lamps) as [keyof typeof lamps, object][])
    for (const units of LIGHT_UNITS)
      for (const intensity of [0.5, 3, 12]) {
        const light = { ...lamp, id: kind, intensity, intensityUnits: units } as SceneLight
        // The spot's source is a sphere of 10 cm (a nit needs an area), the point's a capsule.
        const shape = kind === 'spot' ? { ...cm, radius: 10, length: 0 } : cm
        const expected = referenceBrightness(kind, units, intensity, shape)
        const got = brightnessOf(validateSceneLight(light))
        assert.ok(Math.abs(got - expected) <= 1e-12 * Math.max(1, expected), `${kind} ${units}`)
      }
  // Off the inverse square the number is taken as it is, in no unit.
  const flat = { ...lamps.point, id: 'p', intensity: 7, intensityUnits: 'lumens' as const }
  assert.equal(brightnessOf({ ...flat, inverseSquared: false } as SceneLight), 7)
  const sun = { id: 's', kind: 'directional', direction: [0, -1, 0], color: [1, 1, 1] } as const
  assert.equal(brightnessOf({ ...sun, intensity: 3, castsShadow: false } as SceneLight), 3)
  assert.equal(brightnessOf({ ...sun, castsShadow: false } as SceneLight), 10, '10 lux by default')
})
