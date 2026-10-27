import test from 'node:test'
import assert from 'node:assert/strict'
import { light } from './light.ts'
import { lampRecord, lightFromRecord } from './lightRecord.ts'

// A light is a node: its channels are the node's (`Object3D.lightingChannels`), and a write reaches the
// record the store is given (`lampRecord`).
test('a light’s channels are given to the record when they are not the default', () => {
  const lamp = light.point({ position: [0, 3, 0], distance: 10 })
  const record = () => lampRecord(lamp, 'lamp', () => 10)!
  assert.equal(record().lightingChannels, undefined, 'the default is not written')
  lamp.lightingChannels = { channel0: false, channel1: true, channel2: false }
  assert.deepEqual(record().lightingChannels, { channel0: false, channel1: true, channel2: false })
  assert.deepEqual(
    light.spot({ lightingChannels: { channel0: true, channel1: true, channel2: false } })
      .lightingChannels,
    { channel0: true, channel1: true, channel2: false },
    'a parameter of the light member',
  )
  const copy = light.point()
  copy.copy(lamp)
  assert.deepEqual(copy.lightingChannels, lamp.lightingChannels)
})

test('a lamp rebuilt from its record is in the record’s channels', () => {
  const lamp = lightFromRecord({
    id: 'lamp',
    kind: 'point',
    color: [1, 1, 1],
    intensity: 1,
    position: [0, 1, 0],
    range: 5,
    castsShadow: false,
    lightingChannels: { channel0: false, channel1: false, channel2: true },
  })
  assert.deepEqual(lamp.lightingChannels, { channel0: false, channel1: false, channel2: true })
})
