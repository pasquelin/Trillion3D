// The random sequence of the grids' tracking: the constants and the steps of the formulas it ports, and the draw's stride.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { VG_RANDOM_SEQUENCE_WGSL } from './randomSequenceWgsl.ts'

const text = wgslModule(VG_RANDOM_SEQUENCE_WGSL).replace(/\s/g, '')

test('the hashes, the scrambling and the seed step carry the constants of the sequence they port', () => {
  for (const constant of [
    '0x21f0aaadu',
    '0xf35a2d97u',
    '0xe0705d72u',
    '0x915f77f5u',
    '0x93d765ddu',
    '5.96046447754e-08',
  ])
    assert.ok(text.includes(constant), constant)
  // The Owen scrambling mirrors its result; the index of a sequence is the frame's bits mirrored, the seed the position's hash.
  assert.match(text, /returnreverseBits\(x\)/)
  assert.match(text, /RandomSequence\(reverseBits\(frame\),strongIntegerHash\(position\)\)/)
})

test('a draw scrambles the index, then the point, and steps the seed five times in all, as the four-dimensional draw does', () => {
  const draw = text.slice(text.indexOf('fnrandomDraw'))
  assert.equal((draw.match(/evolveSobolSeed\(&seed\)/g) ?? []).length, 3)
  assert.match(draw, /skipped<3/)
  assert.match(draw, /f32\(scrambled>>8u\)/)
  assert.equal(text.includes('`'), false)
})
