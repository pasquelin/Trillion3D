import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  skyLightRayCount,
  skyLightTracedOn,
  skyLightUpscale,
  type RayTracedSkyLightSettings,
  type SkyLightRayAsk,
} from './rayTracedSkyLightOptions.ts'
import { resolveSettings } from './settingRules.ts'
import { SHADOW_RULES } from './shadowOptions.ts'

const view = (changes: Partial<RayTracedSkyLightSettings> = {}) =>
  ({ ...resolveSettings(SHADOW_RULES, {}), ...changes }) as unknown as RayTracedSkyLightSettings
const sky = (changes: Partial<SkyLightRayAsk> = {}): SkyLightRayAsk => ({
  castRayTracedShadow: 'useProjectSetting',
  samplesPerPixel: 4,
  transmission: false,
  ...changes,
})

test('the ray-traced sky light is off by default and follows the sky light or the view', () => {
  assert.equal(skyLightTracedOn(view(), sky()), false)
  assert.equal(skyLightTracedOn(view({ rayTracedSkyLight: true }), sky()), true)
  assert.equal(skyLightTracedOn(view(), sky({ castRayTracedShadow: 'enabled' })), true)
  assert.equal(
    skyLightTracedOn(view({ rayTracedSkyLight: true }), sky({ castRayTracedShadow: 'disabled' })),
    false,
  )
  assert.equal(
    skyLightTracedOn(
      view({ rayTracedSkyLightAllowed: false }),
      sky({ castRayTracedShadow: 'enabled' }),
    ),
    false,
  )
})

test('the rays a pixel casts: the view, else the sky light held to 2', () => {
  assert.equal(skyLightRayCount(view(), sky()), 4)
  assert.equal(skyLightRayCount(view(), sky({ samplesPerPixel: 1 })), 2)
  assert.equal(skyLightRayCount(view({ rayTracedSkyLightSamplesPerPixel: 0 }), sky()), 0)
  assert.equal(skyLightRayCount(view({ rayTracedSkyLightSamplesPerPixel: 1 }), sky()), 1)
})

test('the resolution division is whole and only with the denoiser', () => {
  assert.equal(skyLightUpscale(view()), 1)
  assert.equal(skyLightUpscale(view({ rayTracedSkyLightScreenPercentage: 50 })), 2)
  assert.equal(skyLightUpscale(view({ rayTracedSkyLightScreenPercentage: 1 })), 4)
  assert.equal(
    skyLightUpscale(
      view({ rayTracedSkyLightScreenPercentage: 50, rayTracedSkyLightDenoiser: false }),
    ),
    1,
  )
})
