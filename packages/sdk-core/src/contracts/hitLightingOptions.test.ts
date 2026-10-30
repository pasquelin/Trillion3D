// The reflections' hit lighting settings (`hitLightingOptions.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HIT_LIGHTING_RULES,
  hitLightingOf,
  hitLightingProbesRun,
  type HitLightingValues,
} from './hitLightingOptions.ts'

const defaults = () =>
  Object.fromEntries(
    HIT_LIGHTING_RULES.map((rule) => [rule.field, rule.default]),
  ) as unknown as HitLightingValues

test('the defaults are the reference ones: off, soft shadows, sky light for standalone reflections only', () => {
  const hit = hitLightingOf(defaults())
  assert.equal(hit.on, false)
  assert.equal(hit.forced, false)
  assert.equal(hit.bucket, true)
  assert.equal(hit.direct, true)
  assert.equal(hit.shadowMode, 2)
  assert.equal(hit.skylight, false)
  assert.equal(hit.translucencyMode, 1)
})

test('the setting turns the pass on, a lighting mode forces every hit, the scalability switch forbids both', () => {
  const v = { ...defaults(), reflectionHardwareRayTracingHitLighting: true }
  assert.deepEqual([hitLightingOf(v).on, hitLightingOf(v).forced], [true, false])
  const forced = { ...defaults(), hardwareRayTracingLightingMode: 'hitLighting' as const }
  assert.deepEqual([hitLightingOf(forced).on, hitLightingOf(forced).forced], [true, true])
  const barred = { ...v, ...forced, hardwareRayTracingHitLightingAllowed: false }
  assert.deepEqual([hitLightingOf(barred).on, hitLightingOf(barred).forced], [false, false])
})

test('the reflection bounces default to one, a single ray with no mirror seen in a mirror, and are bounded by 64', () => {
  assert.equal(hitLightingOf(defaults()).bounces, 1)
  assert.equal(hitLightingOf({ ...defaults(), reflectionMaxBounces: 5 }).bounces, 5)
  const rule = HIT_LIGHTING_RULES.find((r) => r.field === 'reflectionMaxBounces')
  assert.deepEqual(rule && 'range' in rule && rule.range, [1, 64])
})

test('the refraction events default to none, need the project switch, and size the path in vertices', () => {
  const none = hitLightingOf(defaults())
  assert.deepEqual([none.refractions, none.vertices], [0, 1])
  const traced = { ...defaults(), reflectionMaxBounces: 3, reflectionMaxRefractionBounces: 2 }
  assert.deepEqual([hitLightingOf(traced).refractions, hitLightingOf(traced).vertices], [2, 9])
  const barred = { ...traced, reflectionRayTracedTranslucentRefractions: false }
  assert.deepEqual([hitLightingOf(barred).refractions, hitLightingOf(barred).vertices], [0, 3])
  const rule = HIT_LIGHTING_RULES.find((r) => r.field === 'reflectionMaxRefractionBounces')
  assert.deepEqual(rule && 'range' in rule && rule.range, [0, 63])
  const project = HIT_LIGHTING_RULES.find(
    (r) => r.field === 'reflectionRayTracedTranslucentRefractions',
  )
  assert.equal(project?.default, true)
})

test('the screen probes and the radiance cache light their hits only in the mode that is hit lighting, not the reflections-only one, and only where it is allowed', () => {
  assert.equal(hitLightingOf(defaults()).probes, false)
  const lit = { ...defaults(), hardwareRayTracingLightingMode: 'hitLighting' as const }
  assert.equal(hitLightingOf(lit).probes, true)
  const reflectionsOnly = {
    ...defaults(),
    hardwareRayTracingLightingMode: 'hitLightingForReflections' as const,
  }
  assert.deepEqual(
    [hitLightingOf(reflectionsOnly).forced, hitLightingOf(reflectionsOnly).probes],
    [true, false],
  )
  assert.equal(hitLightingOf({ ...lit, hardwareRayTracingHitLightingAllowed: false }).probes, false)
  // With neither the direct lighting nor the sky light the hit's own light is read as it stands: no pass runs.
  assert.equal(hitLightingProbesRun(hitLightingOf(lit)), true)
  const bare = { ...lit, hardwareRayTracingHitLightingDirectLighting: false }
  assert.equal(hitLightingProbesRun(hitLightingOf(bare)), false)
  assert.equal(
    hitLightingProbesRun(hitLightingOf({ ...bare, hardwareRayTracingHitLightingSkylight: 'on' })),
    true,
  )
})

test('the light grid defaults are the reference ones: 256 cells a side, 128 lights a cell, the automatic axis', () => {
  const { lightGrid } = hitLightingOf(defaults())
  assert.deepEqual(lightGrid, { resolution: 256, maxCount: 128, axis: 3 })
  assert.equal(hitLightingOf({ ...defaults(), rayTracingLightGridAxis: 2 }).lightGrid.axis, 2)
  const rule = HIT_LIGHTING_RULES.find((r) => r.field === 'rayTracingLightGridResolution')
  assert.deepEqual(rule && 'range' in rule && rule.range, [1, 2048])
})
