// The animation banks' file (`animationBanks.ts`): each bake names the rate its keys are sampled at.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ANIMATION_BANK_BAKE_WORDS,
  ANIMATION_BANK_INVERSE_FLOATS,
  ANIMATION_BANK_KEY_FLOATS,
  ANIMATION_BANKS_HEADER_WORDS,
  ANIMATION_BANKS_MAGIC,
  ANIMATION_BANKS_VERSION,
} from '../../contracts/writtenFormats.ts'
import { decodeAnimationBanks } from './animationBanks.ts'

/** A file of one bake of one joint and `frames` frames at `rate`, no item. */
function file(frames: number, rate: number, version = ANIMATION_BANKS_VERSION) {
  const pool = ANIMATION_BANK_INVERSE_FLOATS + frames * ANIMATION_BANK_KEY_FLOATS
  const words = new Uint32Array(ANIMATION_BANKS_HEADER_WORDS + ANIMATION_BANK_BAKE_WORDS + pool)
  const floats = new Float32Array(words.buffer)
  words.set([ANIMATION_BANKS_MAGIC, version, 1, 0, pool])
  const at = ANIMATION_BANKS_HEADER_WORDS
  words.set([1, frames, 0, ANIMATION_BANK_INVERSE_FLOATS], at)
  floats[at + 4] = rate
  return words.buffer
}

test('a bake holds the rate its keys are sampled at, in frames a second', () => {
  const [bake] = decodeAnimationBanks(file(25, 24)).bakes
  assert.deepEqual([bake.joints, bake.frames, bake.rate], [1, 25, 24])
  assert.equal(
    decodeAnimationBanks(file(7, Math.fround(23.976024))).bakes[0].rate,
    Math.fround(23.976024),
  )
})

test('a bake without a rate, or of another version, is refused', () => {
  for (const rate of [0, -24, Number.NaN, Infinity])
    assert.throws(() => decodeAnimationBanks(file(25, rate)), /bake 0 names floats/, `${rate}`)
  assert.throws(() => decodeAnimationBanks(file(25, 30, 1)), /version/)
})
