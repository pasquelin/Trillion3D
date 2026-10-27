// The record of a card holds its object's lighting channels in its flags word, stored, and nothing else of the word moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_LIGHTING_CHANNELS_MASK,
  DEFAULT_LIGHTING_CHANNELS_MASK,
  storedLightingChannels,
} from '../../contracts/lightingChannelsAbi.ts'
import { CARD_CHANNELS_SHIFT, CARD_WORDS, writeCardWords } from './cardRecords.ts'
import type { Card } from './cardTypes.ts'

/** A card in the world's axes, looking along +x, in no atlas: the fields the record reads. */
const CARD = {
  direction: 5,
  axes: [0, 2, 4],
  resBiasX: 2,
  resBiasY: 3,
  axisXFlipped: false,
  visible: true,
  origin: new Float64Array([1, 2, 3]),
  axisX: new Float64Array([1, 0, 0]),
  axisY: new Float64Array([0, 1, 0]),
  axisZ: new Float64Array([0, 0, 1]),
  box: new Float64Array([-1, -1, -1, 1, 1, 1]),
  mips: [],
  minResLevel: 255,
  maxResLevel: 0,
} as unknown as Card

const record = (card: Card | undefined, channels: number) => {
  const buffer = new ArrayBuffer(CARD_WORDS * 4)
  const words = { f32: new Float32Array(buffer), u32: new Uint32Array(buffer) }
  words.u32.fill(0xffffffff)
  writeCardWords(words, 0, card, channels)
  return words.u32
}

const channelsOf = (flags: number) =>
  storedLightingChannels((flags >>> CARD_CHANNELS_SHIFT) & ALL_LIGHTING_CHANNELS_MASK)

test('the lighting channels of a card round-trip through the record, every mask', () => {
  for (let mask = 0; mask <= ALL_LIGHTING_CHANNELS_MASK; mask++)
    assert.equal(channelsOf(record(CARD, mask)[3]), mask)
})

test('the default channels leave the channel bits of the flags word zero, so a word never written says the default', () => {
  const flags = record(CARD, DEFAULT_LIGHTING_CHANNELS_MASK)[3]
  assert.equal((flags >>> CARD_CHANNELS_SHIFT) & ALL_LIGHTING_CHANNELS_MASK, 0)
  assert.equal(channelsOf(0), DEFAULT_LIGHTING_CHANNELS_MASK)
})

test('the channels take bits 20 to 22 of the flags word and move none of its other fields', () => {
  const before = record(CARD, DEFAULT_LIGHTING_CHANNELS_MASK)[3]
  const after = record(CARD, 0b110)[3]
  const channelBits = ALL_LIGHTING_CHANNELS_MASK << CARD_CHANNELS_SHIFT
  assert.equal(CARD_CHANNELS_SHIFT, 20)
  assert.equal((before & ~channelBits) >>> 0, (after & ~channelBits) >>> 0)
  assert.equal(after & 0xff, 2)
  assert.equal((after >>> 8) & 0xff, 3)
  assert.equal((after >>> 16) & 0xf, 5)
})

test('a card that is not there is a zero record whatever the channels', () => {
  assert.ok(record(undefined, 0b110).every((word) => word === 0))
})
