// A lamp's units: the conversion between them is the reference's, a lamp naming no intensity holds the
// light of 8 candelas in its unit, and the store packs the number the lighting reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_FIELD, baseOf, brightnessOf, defaultIntensityOf } from './fields.ts'
import { LIGHT_UNITS, lightUnitsFactor } from './lightUnits.ts'
import { createSceneLightStore } from './store.ts'
import type { SceneLight } from './contracts.ts'

test("the unit conversion is the reference's, and a lamp naming no intensity is the light of 8 candelas in its unit", () => {
  // Unitless 16 per 100² candelas; a lumen over 2π (1 − cos); a nit 1; EV the candela's scale.
  const near = (a: number, b: number, why: string) =>
    assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), `${why}: ${a} against ${b}`)
  near(5000 * lightUnitsFactor('unitless', 'candelas', -1), 8, 'unitless to candelas')
  near(lightUnitsFactor('unitless', 'lumens', -1), (16 * 4 * Math.PI) / 1e4, 'a point lumen')
  near(lightUnitsFactor('unitless', 'lumens', 0.5), (16 * Math.PI) / 1e4, 'a rect lumen')
  near(lightUnitsFactor('unitless', 'nits', 0.3), 16, 'a nit has no area here')
  near(lightUnitsFactor('candelas', 'ev', 0.3), 1, 'an EV is converted as a candela')
  near(lightUnitsFactor('lumens', 'candelas', 1), 1 / (2 * Math.PI * 1e-4), 'the cone clamped')
  assert.equal(lightUnitsFactor('nits', 'nits', 0.2), 1)
  const spot = { kind: 'spot', outerConeAngle: 0.6, innerConeAngle: 0.3 } as const
  for (const kind of ['point', 'rect'] as const)
    assert.equal(defaultIntensityOf({ kind }), 5000, `${kind}: 5000 unitless`)
  assert.equal(defaultIntensityOf(spot), 5000)
  near(defaultIntensityOf({ ...spot, intensityUnits: 'candelas' }), 8, 'the same light, 8 candelas')
  assert.equal(defaultIntensityOf({ kind: 'directional' }), 10)
  near(
    defaultIntensityOf({ ...spot, intensityUnits: 'lumens' }),
    8 * 2 * Math.PI * (1 - Math.cos(0.6)),
    'spot lumens',
  )
  // An inner cone as wide as the outer one takes the outer cone a milliradian past it, as the
  // reference clamps.
  const sharp = {
    kind: 'spot',
    outerConeAngle: 0.6,
    innerConeAngle: 0.6,
    intensityUnits: 'lumens',
  } as const
  near(defaultIntensityOf(sharp), 8 * 2 * Math.PI * (1 - Math.cos(0.601)), 'a sharp cone')
  // EV and nits are reached by a change of unit that keeps the light (not by the factor alone):
  // an EV of log2 8 = 3, and 8 candelas over the source's area in nits.
  near(defaultIntensityOf({ kind: 'point', intensityUnits: 'ev' }), 3, 'point EV')
  const bulb = { kind: 'point', intensityUnits: 'nits', emitterRadius: 0.2 } as const
  near(defaultIntensityOf(bulb), 8 / (4 * Math.PI * 0.04), 'point nits')
  // Off the inverse square the unit is not read and the number is kept: 8.
  near(defaultIntensityOf({ ...bulb, inverseSquared: false }), 8, 'nits, no inverse square')
  // The same light in every unit: 8 candelas from a point or a spot, a rect's 8 over half its face.
  const base = { id: 'l', position: [0, 0, 0], range: 5, color: [1, 1, 1], castsShadow: false }
  const shapes = {
    point: { ...base, kind: 'point', emitterRadius: 0.2, emitterLength: 0.3 },
    spot: { ...base, ...spot, direction: [0, -1, 0], emitterRadius: 0.1 },
    rect: { ...base, kind: 'rect', direction: [0, -1, 0], right: [1, 0, 0], size: [2, 0.5] },
  }
  for (const units of LIGHT_UNITS)
    for (const [kind, shape] of Object.entries(shapes)) {
      const expected = kind === 'rect' ? 8 / 0.5 : 8
      near(
        brightnessOf({ ...shape, intensityUnits: units } as SceneLight),
        expected,
        `${kind} ${units}`,
      )
    }
  // The store packs that number: a 2 m × 1 m rect of 8 candelas shines a radiance of 8 / 1.
  const store = createSceneLightStore()
  const rect = { ...base, kind: 'rect', direction: [0, -1, 0], right: [1, 0, 0], size: [2, 1] }
  const slot = store.add(rect as SceneLight)
  assert.equal(store.packed[baseOf(slot) + LIGHT_FIELD.intensity], 8)
})
