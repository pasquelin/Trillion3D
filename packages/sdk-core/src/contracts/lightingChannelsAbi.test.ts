import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_LIGHTING_CHANNELS_MASK,
  DEFAULT_LIGHTING_CHANNELS,
  DEFAULT_LIGHTING_CHANNELS_MASK,
  LIGHTING_CHANNEL_COUNT,
  internLightingChannels,
  lightingChannelMask,
  lightingChannelsRefusal,
  storedChannelsOf,
  storedLightingChannels,
} from './lightingChannelsAbi.ts'

/** The channels of `mask`, a plain set: channel `n` is bit `n`. */
const channelsOf = (mask: number) => ({
  channel0: (mask & 1) !== 0,
  channel1: (mask & 2) !== 0,
  channel2: (mask & 4) !== 0,
})

test('the default is channel 0 alone, and a word that holds none says it', () => {
  assert.deepEqual(DEFAULT_LIGHTING_CHANNELS, { channel0: true, channel1: false, channel2: false })
  assert.equal(lightingChannelMask(DEFAULT_LIGHTING_CHANNELS), DEFAULT_LIGHTING_CHANNELS_MASK)
  assert.equal(storedLightingChannels(DEFAULT_LIGHTING_CHANNELS_MASK), 0)
  assert.equal(storedChannelsOf(DEFAULT_LIGHTING_CHANNELS), 0)
  assert.equal(storedChannelsOf(channelsOf(6)), 7)
  assert.equal(storedLightingChannels(storedLightingChannels(5)), 5, 'the same operation back')
})

test('every mask is one frozen set, channel n the bit n', () => {
  assert.equal(ALL_LIGHTING_CHANNELS_MASK, (1 << LIGHTING_CHANNEL_COUNT) - 1)
  for (let mask = 0; mask <= ALL_LIGHTING_CHANNELS_MASK; mask++) {
    const channels = internLightingChannels(channelsOf(mask))
    assert.equal(lightingChannelMask(channels), mask)
    assert.equal(internLightingChannels(channelsOf(mask)), channels, 'the same object a mask')
    assert.ok(Object.isFrozen(channels))
  }
  assert.deepEqual(internLightingChannels(channelsOf(6)), channelsOf(6))
  assert.equal(DEFAULT_LIGHTING_CHANNELS, internLightingChannels(channelsOf(1)))
})

test('a set is the three names, each true or false, and no other', () => {
  assert.equal(lightingChannelsRefusal('lightingChannels', channelsOf(0)), undefined)
  for (const bad of [
    null,
    1,
    {},
    { channel0: true },
    { channel0: true, channel1: 0, channel2: false },
    { channel0: true, channel1: false, channel2: false, channel3: true },
  ])
    assert.match(
      lightingChannelsRefusal('lightingChannels', bad)!,
      /^lightingChannels is \{ channel0/,
    )
})
