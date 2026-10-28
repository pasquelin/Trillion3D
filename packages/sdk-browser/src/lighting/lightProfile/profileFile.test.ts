// The file of a light profile, as the compiler writes it (`light_profile/format.rs`), and the texels
// the atlas takes from it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PROFILE_SIDE } from './profileCodec.ts'
import { decodeLightProfile, isCompiledProfile, lightProfileUrl } from './profileCodec.ts'

/** A file of the compiler's layout: five little-endian words, then the half-float texels. */
function file(texels: Uint16Array, brightness: number, words: number[] = []) {
  const bytes = new ArrayBuffer(20 + 2 * texels.length)
  const view = new DataView(bytes)
  const head = [0x4549_3354, 1, PROFILE_SIDE, PROFILE_SIDE]
  words.forEach((word, i) => (head[i] = word))
  head.forEach((word, i) => view.setUint32(4 * i, word, true))
  view.setFloat32(16, brightness, true)
  texels.forEach((texel, i) => view.setUint16(20 + 2 * i, texel, true))
  return bytes
}
const SQUARE = PROFILE_SIDE * PROFILE_SIDE

test('a profile file gives its texels, the brightness word of its head left to the light that carries it', () => {
  const texels = new Uint16Array(SQUARE)
  texels[0] = 0x3c00
  texels[SQUARE - 1] = 0x3800
  const profile = decodeLightProfile(file(texels, 1200))
  assert.equal(profile.texels.length, SQUARE)
  assert.equal(profile.texels[0], 0x3c00)
  assert.equal(profile.texels[SQUARE - 1], 0x3800)
  // The same bytes as a view into a larger buffer.
  const bytes = new Uint8Array(file(texels, 1200))
  const inside = new Uint8Array(bytes.length + 6)
  inside.set(bytes, 3)
  assert.deepEqual(decodeLightProfile(inside.subarray(3, 3 + bytes.length)).texels, texels)
})

test('a file of another magic, version, size or length is refused', () => {
  const texels = new Uint16Array(SQUARE)
  assert.throws(
    () => decodeLightProfile(file(texels, 1, [0x1234_5678])),
    /not a light profile file/,
  )
  assert.throws(
    () => decodeLightProfile(file(texels, 1, [0x4549_3354, 2])),
    /version 2, this engine reads 1/,
  )
  assert.throws(
    () => decodeLightProfile(file(texels, 1, [0x4549_3354, 1, 128, 128])),
    /another size/,
  )
  assert.throws(() => decodeLightProfile(file(texels.subarray(1), 1)), /cut/)
  assert.throws(() => decodeLightProfile(new ArrayBuffer(8)), /head/)
})

test('a texel that is not a number or is below 0 is read as 0, and the others as they are', () => {
  const texels = new Uint16Array(SQUARE)
  texels.set([
    0x3c00, // 1
    0x0000, // +0
    0x8000, // -0
    0xbc00, // -1
    0x7e00, // NaN
    0xfe00, // NaN with the sign set
    0x7c00, // +infinity
    0xfc00, // -infinity
    0x0001, // the least denormal
    0x7bff, // the greatest finite
  ])
  assert.deepEqual(
    [...decodeLightProfile(file(texels, 1)).texels.subarray(0, 10)],
    [0x3c00, 0, 0, 0, 0, 0, 0x7c00, 0, 0x0001, 0x7bff],
  )
})

test('only the compiler’s file names are fetched, beside the cache’s manifest', () => {
  assert.ok(isCompiledProfile('light-profile-0123456789abcdef.bin'))
  for (const id of [
    '',
    'lamp.ies',
    '../light-profile-0123456789abcdef.bin',
    '//host/x.bin',
    'light-profile-0123456789ABCDEF.bin',
  ])
    assert.ok(!isCompiledProfile(id), id)
  assert.equal(
    lightProfileUrl('https://host/cache/clusters.json', 'light-profile-0123456789abcdef.bin'),
    'https://host/cache/light-profile-0123456789abcdef.bin',
  )
})
