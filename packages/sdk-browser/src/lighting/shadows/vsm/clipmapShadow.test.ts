// A sun's shadow settings and the edge of its far-shadow test, at the clipmap: the light's own
// settings are part of its cache key; the edge follows its distance, its cascades and the view's scale
// (`sunCascadesOf`), and moves no cached page.
import test from 'node:test'
import assert from 'node:assert/strict'
import { VSM_MAP_UNCACHED } from './constants.ts'
import { createVsmClipmap } from './clipmap.ts'
import { sunCascadesOf } from './frame/vsmFarShadow.ts'
import {
  resolveLightShadow,
  type LightShadowOptions,
} from '../../../../../sdk-core/src/contracts/lightShadowOptions.ts'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { SHADOW_RULES } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { SUN, PROJECTION, VIEW } from './clipmap.fixture.ts'

test("a sun's own shadow settings are part of its cache key: another one draws every page again, the same ones none", () => {
  const cache = new VsmCacheManager()
  const sun = (shadow: LightShadowOptions | undefined) =>
    createVsmClipmap(
      cache,
      { ...SUN, shadow: shadow && resolveLightShadow(shadow) },
      { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] },
      { width: 1024, height: 1024 },
    )
  for (let n = 0; n < 2; n++) {
    cache.frameStamp = n
    sun({ shadowDistance: 400 }).cacheEntry.markRendered(n)
  }
  cache.frameStamp = 2
  const cached = (shadow: LightShadowOptions | undefined) =>
    sun(shadow).cacheEntry.mapCaches.every(
      ({ projectionData: d }) => (d.flags & VSM_MAP_UNCACHED) === 0,
    )
  assert.equal(cached({ shadowDistance: 400 }), true, 'the same settings: cached')
  assert.equal(cached(undefined), true, 'the default is 400 metres')
  assert.equal(cached({ shadowDistance: 250 }), false, '400 to 250: the light is re-created')
  cache.frameStamp = 3
  sun({ shadowDistance: 250 }).cacheEntry.markRendered(3)
  cache.frameStamp = 4
  assert.equal(cached({ shadowDistance: 250 }), true, 'held again')
  assert.equal(cached({ shadowDistance: 0 }), false, '250 to none: re-created too')
  // Any other of the light's own settings re-creates it as well, as the light's property does.
  for (const [k, patch] of [
    { shadowCascades: 3 },
    { shadowCascadeExponent: 2 },
    { distanceFieldShadows: false },
    { distanceFieldShadowDistance: 300 },
  ].entries()) {
    cache.frameStamp = 5 + 2 * k
    sun({ shadowDistance: 0 }).cacheEntry.markRendered(cache.frameStamp)
    cache.frameStamp++
    assert.equal(cached({ shadowDistance: 0, ...patch }), false, JSON.stringify(patch))
  }
})

test("a sun's far-shadow distance is the edge of its shadow distance, its settings and the view's scale, none when the culling is off", () => {
  const sun: SceneLight = {
    id: 'sun',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: true,
  }
  // The scene has distance fields, the project's setting that makes the cascade after the near levels.
  const edge = (context: object, light: SceneLight) =>
    sunCascadesOf(
      { context: { distanceFields: [{}], ...context } } as unknown as WebgpuPagesRuntime,
      light,
      0,
      resolveSettings(SHADOW_RULES, context),
    ).edge
  // The edge of the last near level, its overlap into the next included: D + 0.0675 D at no near.
  assert.ok(Math.abs(edge({}, sun) - 427) < 1e-9, 'the defaults: 400 metres, scale 1: 427')
  assert.ok(Math.abs(edge({}, { ...sun, shadowDistance: 90 }) - 96.075) < 1e-9)
  assert.ok(Math.abs(edge({ shadowDistanceScale: 0.6 }, sun) - 256.2) < 1e-9)
  assert.equal(edge({ shadowFarField: false }, sun), 400, 'no far field follows: the distance')
  assert.equal(
    edge({ distanceFields: [] }, sun),
    400,
    'a scene with no distance field: none follows',
  )
  assert.equal(edge({}, { ...sun, shadowCascades: 0 }), 0, 'a light with no near level: none')
  assert.equal(
    edge({}, { ...sun, distanceFieldShadows: false }),
    400,
    'its cascade off: the distance',
  )
  assert.equal(edge({ shadowNearLevels: 0 }, sun), 0, 'no near level: none')
  assert.equal(edge({ shadowDistanceScale: 1.5 }, sun), 600, 'past 512 metres: the distance itself')
  assert.equal(edge({ shadowDistanceScale: 0 }, sun), 0, 'a scale of 0: none')
  assert.equal(edge({ farShadowCulling: false }, sun), 0, 'culling off: none')
  assert.equal(edge({}, { ...sun, shadowDistance: 0 }), 0, 'a light of none')
  const lamp: SceneLight = { ...sun, kind: 'point', position: [0, 3, 0], range: 8 }
  assert.equal(edge({}, lamp), 0, 'a local light has no far-shadow distance')
})
