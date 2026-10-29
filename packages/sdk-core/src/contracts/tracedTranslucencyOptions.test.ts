// The traced translucency's settings (`tracedTranslucencyOptions.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_RULES } from './reflectionOptions.ts'
import { resolveSettings } from './settingRules.ts'
import {
  tracedDownsampleOf,
  tracedPrimaryEventsOf,
  tracedRefractionOn,
  tracedSecondaryEventsOf,
  tracedTranslucencyOn,
} from './tracedTranslucencyOptions.ts'

const values = (options = {}) => resolveSettings(REFLECTION_RULES, options)

test("the defaults are the reference's: raster translucency, 4 and 2 events", () => {
  const v = values()
  assert.equal(tracedTranslucencyOn(v), false)
  assert.equal(tracedRefractionOn(v), false)
  assert.equal(tracedDownsampleOf(v), 1)
  assert.equal(tracedPrimaryEventsOf(v), 4)
  assert.equal(tracedSecondaryEventsOf(v), 2)
  assert.equal(v.rayTracedTranslucencyMaxRayIntensity, 1000)
  assert.equal(v.rayTracedTranslucencyPathThroughputThreshold, 0.001)
})

test("the translucency is traced by the scene's method or by the setting", () => {
  assert.equal(tracedTranslucencyOn(values({ translucencyType: 'rayTraced' })), true)
  assert.equal(tracedTranslucencyOn(values({ rayTracedTranslucency: 'on' })), true)
  assert.equal(
    tracedTranslucencyOn(values({ translucencyType: 'rayTraced', rayTracedTranslucency: 'off' })),
    false,
  )
})

test('bent rays are not downsampled, and the events follow the scene unless the setting gives its own', () => {
  const v = values({ translucencyRefraction: true, rayTracedTranslucencyDownsampleFactor: 2 })
  assert.equal(tracedRefractionOn(v), true)
  assert.equal(tracedDownsampleOf(v), 1)
  assert.equal(tracedDownsampleOf(values({ rayTracedTranslucencyDownsampleFactor: 2 })), 2)
  assert.equal(tracedPrimaryEventsOf(values({ rayTracedTranslucencyMaxPrimaryHitEvents: 7 })), 7)
  assert.equal(tracedSecondaryEventsOf(values({ translucencyMaxSecondaryHitEvents: 0 })), 0)
})
