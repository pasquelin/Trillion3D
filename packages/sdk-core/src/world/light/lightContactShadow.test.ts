// A light's contact shadows and its indirect lighting factor, each its own setting with its default
// (`LIGHT_CONTACT_SHADOW_RULES`), every kind's: a write reaches the world at once, a clone keeps them,
// the record holds those that differ from the default and gives them back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Light, light } from './light.ts'
import { lampRecord, lightFromRecord } from './lightRecord.ts'
import { Group } from '../object/object3d.ts'
import { countingLink } from '../object/sceneLink.fixture.ts'

test('a light casts no contact shadow by default, and the settings it is given are its own', () => {
  for (const lamp of [light.point(), light.spot(), light.directional(), light.rectArea()]) {
    assert.deepEqual(
      [lamp.contactShadowLength, lamp.contactShadowLengthInWorldSpace],
      [0, false],
      lamp.kind,
    )
    assert.deepEqual(
      [lamp.contactShadowCastingIntensity, lamp.contactShadowNonCastingIntensity],
      [1, 0],
    )
    assert.equal(lamp.indirectLightingIntensity, 1)
  }
  const named = light.point({
    contactShadowLength: 0.05,
    contactShadowLengthInWorldSpace: true,
    contactShadowCastingIntensity: 0.5,
    contactShadowNonCastingIntensity: 0.25,
    indirectLightingIntensity: 2,
  })
  assert.deepEqual(
    [
      named.contactShadowLength,
      named.contactShadowLengthInWorldSpace,
      named.indirectLightingIntensity,
    ],
    [0.05, true, 2],
  )
  assert.equal(named.clone().contactShadowCastingIntensity, 0.5, 'a clone keeps them')
  assert.equal(named.clone().indirectLightingIntensity, 2)
})

test('a write is checked by its rule and reaches the world at once', () => {
  const lamp = light.point()
  const scene = new Group(),
    { link, heard } = countingLink()
  scene._link = link
  scene.add(lamp)
  const before = heard.length
  lamp.contactShadowLength = 0.02
  lamp.indirectLightingIntensity = 0
  assert.equal(heard.length, before + 2)
  assert.throws(() => (lamp.contactShadowLength = -1), /contactShadowLength/)
  assert.throws(() => (lamp.contactShadowCastingIntensity = 2), /from 0 to 1/)
  assert.throws(() => light.point({ indirectLightingIntensity: -1 }), /at least 0/)
})

test('the settings that differ from the default reach the record, and come back from it', () => {
  const plain = new Light('point', { position: [0, 2, 0] })
  const plainRecord = lampRecord(plain, 'p', () => 9)!
  for (const field of [
    'contactShadowLength',
    'contactShadowLengthInWorldSpace',
    'contactShadowCastingIntensity',
    'contactShadowNonCastingIntensity',
    'indirectLightingIntensity',
  ])
    assert.equal(field in plainRecord, false, field)
  const set = new Light('spot', {
    position: [0, 2, 0],
    contactShadowLength: 0.03,
    indirectLightingIntensity: 0.5,
  })
  const record = lampRecord(set, 's', () => 9)!
  assert.deepEqual(
    [
      record.contactShadowLength,
      record.indirectLightingIntensity,
      'contactShadowCastingIntensity' in record,
    ],
    [0.03, 0.5, false],
  )
  const back = lightFromRecord({ ...record, contactShadowLengthInWorldSpace: true })
  assert.deepEqual(
    [
      back.contactShadowLength,
      back.contactShadowLengthInWorldSpace,
      back.indirectLightingIntensity,
    ],
    [0.03, true, 0.5],
  )
})
