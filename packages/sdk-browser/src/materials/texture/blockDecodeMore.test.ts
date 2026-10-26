import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeBc4Level, decodeBc6hLevel, decodeRawLevel } from './blockDecodeMore.ts'
import { tileRecord } from './tileRecords.ts'
import { tileLevelBytes } from './levelReader.ts'
import { convertTexels, cropTexels, decodeFloatLevel, unblockTexels } from './floatTexels.ts'

// Behaviour: a BC4 block of one flat value decodes to that value in R, nothing in G and B, opaque;
// a level of other bytes than its blocks is refused.
test('a flat BC4 block decodes to its value in R, opaque', () => {
  const block = Uint8Array.of(77, 77, 0, 0, 0, 0, 0, 0)
  const texels = decodeBc4Level(block, 4, 4)
  for (let t = 0; t < 16; t++)
    assert.deepEqual([...texels.subarray(t * 4, t * 4 + 4)], [77, 0, 0, 255])
  assert.throws(() => decodeBc4Level(block, 8, 4), /TEXTURE_BLOCK_BYTES/)
})

// Behaviour: for the one-channel pool a BC4 level decodes to one byte a texel, and the eight-bit
// blocks of a `gray` chain to the same bytes, row by row, or to RGBA8 grey; a `displacement`
// chain's value fills all four channels.
test('BC4 and eight-bit blocks decode to one byte a texel, or to RGBA8 by their layout', () => {
  const flat = Uint8Array.of(77, 77, 0, 0, 0, 0, 0, 0)
  assert.deepEqual([...decodeBc4Level(flat, 4, 4, true)], new Array(16).fill(77))
  const block = Uint8Array.from({ length: 16 }, (_, t) => t * 10)
  assert.deepEqual([...decodeRawLevel(block, 4, 4, 'g8', true)], [...block])
  const grey = decodeRawLevel(block, 4, 4, 'g8')
  for (let t = 0; t < 16; t++)
    assert.deepEqual([...grey.subarray(t * 4, t * 4 + 4)], [t * 10, t * 10, t * 10, 255])
  const shifted = decodeRawLevel(block, 4, 4, 'a8')
  for (let t = 0; t < 16; t++)
    assert.deepEqual([...shifted.subarray(t * 4, t * 4 + 4)], new Array(4).fill(t * 10))
  assert.throws(() => decodeRawLevel(block, 8, 4, 'g8'), /TEXTURE_BLOCK_BYTES/)
})

// Behaviour: two blocks side by side land in their own columns, the pool's rows packed.
test('the blocks of a wide level keep their rows apart', () => {
  const left = Uint8Array.from({ length: 16 }, () => 1),
    right = Uint8Array.from({ length: 16 }, () => 2)
  const level = decodeRawLevel(Uint8Array.of(...left, ...right), 8, 4, 'g8', true)
  assert.deepEqual([...level.subarray(0, 8)], [1, 1, 1, 1, 2, 2, 2, 2])
  assert.equal(level.length, 8 * 4)
})

// Behaviour: a flat block the compiler's BC6H encoder wrote (`blocks/tests/two_channel.rs`,
// `half_float_levels_are_bc6h_blocks`: sixteen texels of 0.5, 0.25, 1.0) decodes here, texel for
// texel, to the half-floats of those values within a thousandth, as the compiler's decoder reads it.
test('a BC6H block written by the compiler decodes to its flat colour', () => {
  const block = Uint8Array.of(175, 243, 173, 191, 7, 7, 44, 240, 18, 17, 17, 17, 17, 17, 17, 17)
  const texels = new DataView(decodeBc6hLevel(block, 4, 4).buffer)
  const half = (value: number) => {
    const bits = value & 0xffff,
      exponent = (bits >> 10) & 31,
      fraction = bits & 1023
    return exponent === 0 ? fraction * 2 ** -24 : (1 + fraction / 1024) * 2 ** (exponent - 15)
  }
  for (let t = 0; t < 16; t++)
    [0.5, 0.25, 1.0].forEach((expected, channel) =>
      assert.ok(
        Math.abs(half(texels.getUint16((t * 4 + channel) * 2, true)) - expected) < 1e-3,
        `texel ${t} channel ${channel}`,
      ),
    )
})

// Behaviour: a BC6H level of other bytes than its blocks is refused; a reserved mode reads black.
test('a BC6H level is whole blocks, a reserved mode reads black', () => {
  assert.throws(() => decodeBc6hLevel(new Uint8Array(8), 4, 4), /TEXTURE_BLOCK_BYTES/)
  const reserved = new Uint8Array(16)
  reserved[0] = 0b10011 // mode 0b10011 names no mode
  const texels = decodeBc6hLevel(reserved, 4, 4)
  assert.equal(texels.length, 16 * 8)
  assert.equal(new DataView(texels.buffer).getUint16(0, true), 0)
})

// Behaviour: a record of BC4 blocks is half the bytes of one of BC7's, and what it comes out as
// follows from the pool: the same blocks, decoded to bytes, or decoded to RGBA8.
test('a BC4 record holds eight bytes a block, and reads out by its pool', () => {
  const record = tileRecord(256, 256, 0, 0, 'bc4')
  assert.equal(record.bytes, tileRecord(256, 256, 0, 0, 'bc7').bytes / 2)
  assert.equal(tileLevelBytes(record.bytes, { format: 'bc4' }), record.bytes)
  assert.equal(tileLevelBytes(record.bytes, { format: 'bc4', texels: 'r8' }), record.bytes * 2)
  assert.equal(tileLevelBytes(record.bytes, { format: 'bc4', rgba: true }), record.bytes * 8)
  const raw = tileRecord(256, 256, 0, 0, 'g8')
  assert.equal(raw.bytes, tileRecord(256, 256, 0, 0, 'bc7').bytes)
  assert.equal(tileLevelBytes(raw.bytes, { format: 'g8', texels: 'r8' }), raw.bytes)
  assert.equal(tileLevelBytes(raw.bytes, { format: 'g8', rgba: true }), raw.bytes * 4)
  const half = tileRecord(256, 256, 0, 0, 'bc6h')
  assert.equal(tileLevelBytes(half.bytes, { format: 'bc6h', texels: 'rgba16' }), half.bytes * 8)
  assert.equal(tileLevelBytes(half.bytes, { format: 'bc6h' }), half.bytes)
})

// Behaviour: a float level file's squares unpack to rows in the pool's kind of texel: exact in
// 32 bits, rounded to half-floats in 16 with the range held, a one-channel kind widened to grey
// or a four-channel one narrowed to its red; whole blocks wide, and cropped to the level.
test('float squares unpack into the pool kind, rows in order, the range held', () => {
  const values = Float32Array.from({ length: 16 }, (_, t) => t * 1000)
  const blocks = new Uint8Array(values.buffer)
  const wide = decodeFloatLevel(blocks, 4, 4, 'r32f', 'r32')
  assert.deepEqual([...new Float32Array(wide.buffer)], [...values])
  const half = new Uint16Array(decodeFloatLevel(blocks, 4, 4, 'r32f', 'r16').buffer)
  assert.equal(half[1], 0x63d0, '1000 as a half-float')
  const huge = new Float32Array(16).fill(1e6)
  const clamped = new Uint16Array(
    decodeFloatLevel(new Uint8Array(huge.buffer), 4, 4, 'r32f', 'r16').buffer,
  )
  assert.equal(clamped[0], 0x7bff, 'held at the largest finite half-float')
  // Two blocks side by side keep their rows apart; a 5-wide level crops its padding.
  const two = Float32Array.from({ length: 32 }, (_, at) => (at < 16 ? 1 : 2))
  const rows = new Float32Array(unblockTexels(new Uint8Array(two.buffer), 8, 4, 'r32').buffer)
  assert.deepEqual([...rows.subarray(0, 8)], [1, 1, 1, 1, 2, 2, 2, 2])
  const cropped = cropTexels(unblockTexels(new Uint8Array(two.buffer), 8, 4, 'r32'), 5, 4, 'r32')
  assert.equal(cropped.byteLength, 5 * 4 * 4)
  const grey = convertTexels(new Uint8Array(Float32Array.of(0.5).buffer), 'r32', 'rgba8')
  assert.deepEqual([...grey], [128, 128, 128, 255])
  const red = convertTexels(new Uint8Array(Float32Array.of(0.25, 1, 1, 1).buffer), 'rgba32', 'r8')
  assert.deepEqual([...red], [64])
  assert.throws(() => unblockTexels(new Uint8Array(8), 4, 4, 'r32'), /TEXTURE_BLOCK_BYTES/)
})

// Behaviour: a float record is sixteen texels a square, its bytes out follow the pool's kind.
test('a float record reads out in the bytes of the pool kind', () => {
  const record = tileRecord(256, 256, 0, 0, 'r32f')
  assert.equal(record.bytes, tileRecord(256, 256, 0, 0, 'bc7').bytes * 4)
  assert.equal(tileLevelBytes(record.bytes, { format: 'r32f', texels: 'r32' }), record.bytes)
  assert.equal(tileLevelBytes(record.bytes, { format: 'r32f', texels: 'r16' }), record.bytes / 2)
  assert.equal(tileLevelBytes(record.bytes, { format: 'r32f', rgba: true }), record.bytes)
  const half = tileRecord(256, 256, 0, 0, 'rgba16f')
  assert.equal(tileLevelBytes(half.bytes, { format: 'rgba16f', texels: 'rgba32' }), half.bytes * 2)
})
