// A directional light's shadow settings beyond its distance: its cascades and the cascade of the
// distance fields, each its own setting with its default (`LIGHT_SHADOW_RULES`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { Light, light } from './light.ts'
import { lampRecord, lightFromRecord } from './lightRecord.ts'
import { Group } from '../object/object3d.ts'
import { countingLink } from '../object/sceneLink.fixture.ts'

test('a directional light’s cascades and distance-field cascade are its own settings, each with its default', () => {
  const sun = light.directional()
  assert.deepEqual(
    [sun.shadowCascades, sun.shadowCascadeExponent, sun.shadowCascadeTransition],
    [4, 3, 0.1],
  )
  assert.deepEqual([sun.farShadowCascades, sun.farShadowDistance], [0, 3000])
  assert.deepEqual([sun.distanceFieldShadows, sun.distanceFieldShadowDistance], [true, 512])
  const named = light.directional({
    ...{ shadowCascades: 2, shadowCascadeExponent: 2, shadowCascadeTransition: 0.2 },
    ...{ farShadowCascades: 1, farShadowDistance: 2000, distanceFieldShadows: false },
    ...{ distanceFieldShadowDistance: false },
  })
  assert.deepEqual(
    [named.shadowCascades, named.shadowCascadeExponent, named.shadowCascadeTransition],
    [2, 2, 0.2],
  )
  assert.deepEqual([named.farShadowCascades, named.farShadowDistance], [1, 2000])
  assert.deepEqual([named.distanceFieldShadows, named.distanceFieldShadowDistance], [false, 0])
  assert.equal(named.clone().farShadowDistance, 2000, 'a clone keeps them')
  const scene = new Group(),
    { link, heard } = countingLink()
  scene._link = link
  scene.add(sun)
  const before = heard.length
  sun.shadowCascades = 3
  sun.distanceFieldShadows = false
  assert.equal(heard.length, before + 2, 'each write reaches the world at once')
  assert.throws(() => (sun.shadowCascades = 1.5), /shadowCascades: must be a whole number/)
})

test('a sun’s cascades reach its record when they differ from the default, and come back; a lamp that is no sun records none', () => {
  for (const kind of ['point', 'spot'] as const) {
    const lamp = new Light(kind, { position: [0, 2, 0] })
    lamp.shadowCascades = 2
    assert.equal('shadowCascades' in lampRecord(lamp, 'l', () => 9)!, false, kind)
  }
  const cut = new Light('directional', { shadowCascades: 2, distanceFieldShadows: false })
  const cutRecord = lampRecord(cut, 'c', () => 9)!
  assert.deepEqual(
    [cutRecord.shadowCascades, cutRecord.distanceFieldShadows, 'farShadowCascades' in cutRecord],
    [2, false, false],
  )
  const kept = lightFromRecord({ ...cutRecord, shadowCascadeExponent: 2 })
  assert.deepEqual(
    [kept.shadowCascades, kept.distanceFieldShadows, kept.shadowCascadeExponent],
    [2, false, 2],
  )
})
