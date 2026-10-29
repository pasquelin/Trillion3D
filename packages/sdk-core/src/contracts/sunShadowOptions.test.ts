// The sun's far-shadow settings (`sunShadowOptions.ts`, `sunCascades.ts`): the edge of its far-shadow
// test. Split from `shadowOptions.test.ts` by subject, as the bound
// on a test file's lines asks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { resolveLightShadow, type LightShadowOptions } from './lightShadowOptions.ts'
import { presetShadows } from './shadowOptions.fixture.ts'
import { type ShadowValues } from './shadowOptions.ts'
import { sunCascades } from './sunCascades.ts'

/** The edge of a sun's far-shadow test: `light` under the view `view`, near plane 0.05. */
const edgeOf = (view: ShadowValues, light: LightShadowOptions = {}, distanceFields = true) =>
  sunCascades(resolveLightShadow(light), 0.05, view, distanceFields).edge

test('the far-shadow edge follows the quality levels, the light and the scene’s distance fields', () => {
  // The edge: the last near level's far end, with its overlap into the cascade that follows. Of N
  // levels each 3 times the one before, the last starts at (3^(N−1) − 1) / (3^N − 1) of the span
  // from the near plane, its overlap a tenth of its length times the scale.
  near(edgeOf(presetShadows('smooth')), 240, 'smooth: one level, no far field: the distance', 1e-9)
  near(edgeOf(presetShadows('balanced')), 280, 'balanced: the same, at 0.7', 1e-9)
  near(edgeOf(presetShadows('fine')), 358.357, 'fine: four levels, an overlap of 0.8', 1e-3)
  near(edgeOf(presetShadows('max')), 427.0, 'max, the defaults: 427.0', 0.01)
  const max = presetShadows('max')
  near(
    sunCascades(resolveLightShadow({}), 0, max, true).edge,
    427,
    'no near plane: 427 exactly',
    1e-9,
  )
  near(edgeOf(max, { shadowDistance: 500 }), 500 + 0.0675 * (500 - 0.05), 'under 512', 1e-9)
  assert.equal(edgeOf(max, { shadowDistance: 512 }), 512, 'at 512, none follows')
  assert.equal(edgeOf(max, { shadowDistance: 600 }), 600, 'past 512: the distance itself')
  assert.equal(edgeOf({ ...max, shadowDistanceScale: 2 }), 800, 'scaled')
  // Two levels: the last starts at 2/8 of the span from the near plane.
  const two = edgeOf({ ...max, shadowNearLevels: 2 })
  near(two, 400 + 0.1 * (400 - (0.05 + 0.25 * 399.95)), 'two', 1e-9)
  assert.equal(edgeOf({ ...max, shadowNearLevels: 4 }), edgeOf(max), 'no more than the light’s')
  assert.equal(edgeOf({ ...max, shadowFarField: false }), 400, 'no far field: the distance')
  assert.equal(edgeOf({ ...max, shadowOverlapScale: 0 }), 400, 'no overlap: the distance')
  near(edgeOf({ ...max, shadowOverlapScale: 2 }), 400 + 0.135 * 399.95, 'twice the overlap', 1e-9)
  for (const none of [
    edgeOf({ ...max, farShadowCulling: false }),
    edgeOf({ ...max, shadowDistanceScale: 0 }),
    edgeOf({ ...max, shadowNearLevels: 0 }),
    edgeOf(max, { shadowDistance: 0 }),
    edgeOf(max, { shadowCascades: 0 }),
  ])
    assert.equal(none, 0, 'no limit')
  // The scene's distance fields are the cascade's project setting: a scene with none ends at 400.
  assert.equal(edgeOf(max, {}, false), 400, 'no distance fields: no cascade follows')
  // The light's own settings: its cascades, their growth and overlap, and its distance-field cascade.
  near(edgeOf(max, { shadowCascades: 2 }), 400 + 0.1 * (400 - (0.05 + 0.25 * 399.95)), 'two', 1e-9)
  near(
    edgeOf(max, { shadowCascadeExponent: 1 }),
    400 + 0.1 * (400 - (0.05 + 0.75 * 399.95)),
    'e1',
    1e-9,
  )
  near(edgeOf(max, { shadowCascadeTransition: 0.2 }), 400 + 0.2 * (400 - 130.03), 'twice', 1e-3)
  assert.equal(edgeOf(max, { distanceFieldShadows: false }), 400, 'its cascade off: none follows')
  assert.equal(edgeOf(max, { distanceFieldShadowDistance: 400 }), 400, 'not past the near levels')
  near(edgeOf(max, { distanceFieldShadowDistance: 401 }), 427, 'past them: it follows', 0.01)
  assert.equal(
    edgeOf({ ...max, distanceFieldDistanceScale: 0.5 }),
    400,
    'its distance, scaled: 256',
  )
  near(edgeOf({ ...max, distanceFieldDistanceScale: 2 }), 427, 'scaled up: it follows', 0.01)
  // Far levels follow the near ones as the cascade does, with no distance field in the scene.
  const far = { farShadowCascades: 2, farShadowDistance: 3000 }
  near(edgeOf(max, far, false), 427, 'far levels extend the last near one', 0.01)
  assert.equal(edgeOf(max, { ...far, farShadowDistance: 400.5 }, false), 400, 'under a metre past')
  assert.equal(edgeOf({ ...max, shadowMaxFarCascades: 0 }, far, false), 400, 'the view takes none')
})
