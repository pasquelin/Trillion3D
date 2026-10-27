import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from './index.ts'
import { geometry } from '../geometry/index.ts'
import { DEFAULT_LIGHTING_CHANNELS } from '../../contracts/lightingChannelsAbi.ts'

const box = () => object.mesh(geometry.box(1, 1, 1))

// The lighting channels of an object (`Object3D.lightingChannels`): channel 0 alone by default, a whole
// set written, the value read frozen, copied with the node.
test('an object is in channel 0 alone by default, and a write takes a whole set', () => {
  const wall = box()
  assert.equal(wall.lightingChannels, DEFAULT_LIGHTING_CHANNELS)
  wall.lightingChannels = { channel0: false, channel1: true, channel2: false }
  assert.deepEqual(wall.lightingChannels, { channel0: false, channel1: true, channel2: false })
  assert.ok(Object.isFrozen(wall.lightingChannels), 'the set read cannot be edited in place')
  const same = { channel0: false, channel1: true, channel2: false }
  wall.lightingChannels = same
  assert.notEqual(wall.lightingChannels, same, 'the set held is the engine’s, not the page’s')
  for (const bad of [{ channel1: true }, null, 3, { channel0: 1, channel1: 0, channel2: 0 }]) {
    assert.throws(() => (wall.lightingChannels = bad as never), RangeError)
    assert.deepEqual(wall.lightingChannels, same, 'a refused write changes nothing')
  }
})

test('a copy takes the channels, and a copy of a default node is in the default again', () => {
  const wall = box()
  wall.lightingChannels = { channel0: false, channel1: false, channel2: true }
  const other = box()
  other.copy(wall)
  assert.deepEqual(other.lightingChannels, wall.lightingChannels)
  other.copy(box())
  assert.equal(other.lightingChannels, DEFAULT_LIGHTING_CHANNELS)
})

// The two switches that hide an object by who looks (`Object3D.ownerNoSee`, `onlyOwnerSee`).
test('the owner switches are off by default, booleans, and copied with the node', () => {
  const hands = box()
  assert.deepEqual([hands.ownerNoSee, hands.onlyOwnerSee], [false, false])
  assert.throws(() => (hands.ownerNoSee = 1 as never), RangeError)
  assert.throws(() => (hands.onlyOwnerSee = 'yes' as never), RangeError)
  hands.ownerNoSee = true
  hands.onlyOwnerSee = true
  const other = box()
  other.copy(hands)
  assert.deepEqual([other.ownerNoSee, other.onlyOwnerSee], [true, true])
  other.copy(box())
  assert.deepEqual([other.ownerNoSee, other.onlyOwnerSee], [false, false])
})
