import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SHADOW_RULES,
  type ShadowValues,
} from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { rayTracedSamples } from './rayTracedLights.ts'

const settings = (given: Record<string, unknown> = {}) =>
  resolveSettings(SHADOW_RULES, given as never) as ShadowValues
const light = (fields: Partial<SceneLight> = {}) =>
  ({ id: 'l', kind: 'point', ...fields }) as SceneLight

test('a light keeps its shadow maps unless it asks for rays or the view does', () => {
  assert.equal(rayTracedSamples(settings(), light()), 0)
  assert.equal(rayTracedSamples(settings({ rayTracedShadows: true }), light()), 1)
  assert.equal(rayTracedSamples(settings(), light({ castRayTracedShadow: 'enabled' })), 1)
  assert.equal(
    rayTracedSamples(
      settings({ rayTracedShadows: true }),
      light({ castRayTracedShadow: 'disabled' }),
    ),
    0,
  )
})

test('a kind of light the view leaves out casts none, whatever the light asks', () => {
  const view = settings({ rayTracedShadows: true, rayTracedShadowsRectLights: false })
  assert.equal(rayTracedSamples(view, light({ kind: 'rect' })), 0)
  assert.equal(rayTracedSamples(view, light({ kind: 'spot' })), 1)
})

test('the rays a pixel casts are the light’s, or the view’s from 0', () => {
  const light4 = light({ castRayTracedShadow: 'enabled', rayTracedShadowSamplesPerPixel: 4 })
  assert.equal(rayTracedSamples(settings(), light4), 4)
  assert.equal(rayTracedSamples(settings({ rayTracedShadowsSamplesPerPixel: 2 }), light4), 2)
})
