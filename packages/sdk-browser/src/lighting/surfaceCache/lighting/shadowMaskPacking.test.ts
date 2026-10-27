// The shadow mask's packing: a texel's entry (a byte, two in the coloured atlas's format) and a trace word are packed as the shipped helpers pack them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { SHADOW_FACTOR_TILE_WORDS, SHADOW_QUADS, SHADOW_TRACE, shadowMaskOf } from './layout.ts'
import { shadowMaskBlockOf } from './shadowMaskWgsl.ts'

type Factor = number | number[]
type Ray = { factor: Factor; complete: boolean }

/** The shipped helpers of the masks and the traces of a format, run in JavaScript (`shaderRun`). */
const helpersOf = (block: ReturnType<typeof shadowMaskBlockOf>) =>
  shaderRun<{
    shadowByteOf: (ray: Ray) => number
    shadowRayOf: (byte: number) => Ray
    shadowByteIn: (word: number, bit: number) => number
    shadowBit: (coord: number[]) => number
    isVisibleToLight: (factor: Factor) => boolean
    shadowReaches: (factor: Factor) => boolean
    lightFunctionShade: (given: number[]) => Factor
    packShadowTrace: (lightTile: number, coord: number[], downsample: number) => number
    shadowTraceLightTile: (word: number) => number
    shadowTraceCoord: (word: number) => number[]
    shadowTraceDownsample: (word: number) => number
    factorTileWord: (tile: number[], tilesAlong: number) => number
    factorWordOf: (rank: number) => number
    factorBitOf: (rank: number) => number
  }>(
    wgslModule(block),
    [
      'shadowByteOf',
      'shadowRayOf',
      'shadowByteIn',
      'shadowBit',
      'isVisibleToLight',
      'shadowReaches',
      'lightFunctionShade',
      'packShadowTrace',
      'shadowTraceLightTile',
      'shadowTraceCoord',
      'shadowTraceDownsample',
      'factorTileWord',
      'factorWordOf',
      'factorBitOf',
    ],
    { LG_TILE: 8 },
  )
const helpers = helpersOf(shadowMaskBlockOf('grey'))
const coloured = helpersOf(shadowMaskBlockOf('colour'))

test('a texel’s byte is its factor on 7 bits and the complete bit; read back it is the factor quantised to 1/127', () => {
  // The factor on 7 bits is at most 127 and the complete flag is the bit above it.
  for (const factor of [0, 0.25, 0.5, 0.999, 1]) {
    for (const complete of [false, true]) {
      const byte = helpers.shadowByteOf({ factor, complete })
      assert.ok(byte < 256)
      const ray = helpers.shadowRayOf(byte)
      assert.equal(ray.complete, complete)
      assert.equal(
        Math.fround(ray.factor as number),
        Math.fround(Math.floor(Math.fround(factor) * 127) / 127),
      )
      assert.ok(Math.abs((ray.factor as number) - factor) <= 1 / 127)
    }
  }
  // A factor past the range cannot reach the complete bit.
  assert.equal(helpers.shadowByteOf({ factor: 3, complete: false }), 127)
  assert.equal(helpers.shadowByteOf({ factor: -1, complete: true }), 128)
  // The 64 texels of a tile fill the words of one mask, and a tile holds sixteen quads of four.
  const grey = shadowMaskOf('grey')
  assert.equal(grey.tileWords * 32, 64 * grey.rayBits)
  assert.equal(grey.rayBits, 8)
  assert.equal(grey.factorBits, 7)
  assert.equal(SHADOW_QUADS, 16)
})

test('the grey format is what it was: a scalar factor, its byte the factor truncated to 7 bits under the complete bit, the mean of a function’s channels', () => {
  assert.match(shadowMaskBlockOf('grey').text, /struct ShadowRay\{factor:f32,complete:bool\}/)
  for (let step = 0; step <= 200; step++) {
    const factor = step / 200
    for (const complete of [false, true])
      assert.equal(
        helpers.shadowByteOf({ factor, complete }),
        Math.floor(Math.fround(factor) * 127) | (complete ? 128 : 0),
      )
  }
  assert.equal(helpers.isVisibleToLight(0.01), false)
  assert.equal(helpers.isVisibleToLight(0.0101), true)
  assert.equal(helpers.shadowReaches(0), false)
  assert.equal(helpers.shadowReaches(1e-9), true)
  assert.ok(Math.abs((helpers.lightFunctionShade([0.3, 0.6, 0.9]) as number) - 0.6) < 1e-6)
})

test('the coloured format keeps the factor a colour: 5 bits a channel, red lowest, and the complete bit above them in two bytes a texel', () => {
  assert.match(shadowMaskBlockOf('colour').text, /struct ShadowRay\{factor:vec3f,complete:bool\}/)
  const mask = shadowMaskOf('colour')
  assert.deepEqual([mask.rayBits, mask.factorBits, mask.tileWords], [16, 15, 32])
  assert.equal(mask.tileWords * 32, 64 * mask.rayBits)
  const channel = (c: number) => Math.floor(Math.fround(c) * 31)
  const random = lcgRandom(3101)
  for (let k = 0; k < 200; k++) {
    const factor = [random(), random(), random()]
    for (const complete of [false, true]) {
      const entry = coloured.shadowByteOf({ factor, complete })
      assert.ok(entry < 65536)
      // The reference's layout: red in bits 0 to 4, green 5 to 9, blue 10 to 14, the complete bit 15.
      assert.equal(entry & 31, channel(factor[0]))
      assert.equal((entry >> 5) & 31, channel(factor[1]))
      assert.equal((entry >> 10) & 31, channel(factor[2]))
      assert.equal((entry >> 15) & 1, complete ? 1 : 0)
      const ray = coloured.shadowRayOf(entry)
      assert.equal(ray.complete, complete)
      ;(ray.factor as number[]).forEach((c, i) => {
        assert.equal(Math.fround(c), Math.fround(channel(factor[i]) / 31))
        assert.ok(Math.abs(c - factor[i]) <= 1 / 31)
      })
    }
  }
  // A factor past the range holds a channel; it cannot reach the next channel or the complete bit.
  assert.equal(coloured.shadowByteOf({ factor: [3, 3, 3], complete: false }), 0x7fff)
  assert.equal(coloured.shadowByteOf({ factor: [-1, -1, -1], complete: true }), 0x8000)
  const full = coloured.shadowRayOf(0x7fff)
  assert.deepEqual(full.factor, [1, 1, 1])
  assert.equal(full.complete, false)
  // A settled texel with no light is the complete bit alone, a shadowed one the same as in the grey format.
  assert.equal(coloured.shadowByteOf({ factor: [0, 0, 0], complete: true }), 0x8000)
})

test('the coloured format sees a texel lit where any channel is above the threshold, and passes the function’s colour to the mask whole', () => {
  assert.equal(coloured.isVisibleToLight([0, 0.5, 0]), true)
  const threshold = Math.fround(0.01)
  assert.equal(coloured.isVisibleToLight([threshold, threshold, threshold]), false)
  assert.equal(coloured.isVisibleToLight([threshold, 0.011, threshold]), true)
  assert.equal(coloured.shadowReaches([0, 0, 1e-9]), true)
  assert.equal(coloured.shadowReaches([0, 0, 0]), false)
  assert.deepEqual(coloured.lightFunctionShade([0.3, 0.6, 0.9]), [0.3, 0.6, 0.9])
  // A gobo's tint goes through the mask and back to the direct light as the colour it was, to 5 bits.
  const tint = [1, 0.5, 0.25]
  const read = coloured.shadowRayOf(coloured.shadowByteOf({ factor: tint, complete: true }))
  ;(read.factor as number[]).forEach((c, i) =>
    assert.equal(Math.fround(c), Math.fround([31, 15, 7][i] / 31)),
  )
  const grey = helpers.shadowRayOf(
    helpers.shadowByteOf({ factor: helpers.lightFunctionShade(tint), complete: true }),
  )
  assert.ok(Math.abs((grey.factor as number) - 1.75 / 3) <= 1 / 127, 'the grey mask only dims')
})

test('a texel’s entry is read from its own bits of the mask’s words: four to a word in the grey format, two in the coloured', () => {
  const word = 0x80_7f_01_ff
  assert.deepEqual(
    [0, 8, 16, 24].map((bit) => helpers.shadowByteIn(word, bit)),
    [0xff, 0x01, 0x7f, 0x80],
  )
  // The bit counts across the words of a mask: it is taken modulo the word.
  assert.equal(helpers.shadowByteIn(word, 32 + 16), 0x7f)
  assert.deepEqual(
    [0, 16].map((bit) => coloured.shadowByteIn(0x8abc_7def, bit)),
    [0x7def, 0x8abc],
  )
  assert.equal(coloured.shadowByteIn(0x8abc_7def, 32 + 16), 0x8abc)
  // A texel's bit is its rank in the tile times the bits of an entry.
  assert.equal(helpers.shadowBit([3, 2]), 8 * (3 + 2 * 8))
  assert.equal(coloured.shadowBit([3, 2]), 16 * (3 + 2 * 8))
})

test('a trace word holds the light tile, the texel along x and y and the downsample level, each in its bits', () => {
  const cases = [
    { lightTile: 0, x: 0, y: 0, downsample: 0 },
    { lightTile: 0xffffff, x: 7, y: 7, downsample: 3 },
    { lightTile: 123456, x: 5, y: 2, downsample: 1 },
  ]
  for (const c of cases) {
    const word = helpers.packShadowTrace(c.lightTile, [c.x, c.y], c.downsample)
    assert.ok(Number.isInteger(word) && word >= 0 && word < 2 ** 32)
    assert.equal(helpers.shadowTraceLightTile(word), c.lightTile)
    assert.deepEqual(helpers.shadowTraceCoord(word), [c.x, c.y])
    assert.equal(helpers.shadowTraceDownsample(word), c.downsample)
    assert.equal(coloured.packShadowTrace(c.lightTile, [c.x, c.y], c.downsample), word)
  }
  // The fields do not overlap: the light tile is the low 24 bits whatever the rest.
  assert.equal(helpers.packShadowTrace(5, [7, 7], 3) & 0xffffff, 5)
  // The fields fill the word: the downsample level, 2 bits, ends at its top bit.
  assert.equal(SHADOW_TRACE.downsampleShift + 2, 32)
  assert.equal(SHADOW_TRACE.coordMask, 7)
  assert.equal(SHADOW_TRACE.quadMask, 6)
})

test('the factor atlas keeps eight words a tile, a light’s bit in the word its rank picks', () => {
  assert.equal(SHADOW_FACTOR_TILE_WORDS, 8)
  assert.equal(helpers.factorTileWord([0, 0], 512), 0)
  assert.equal(helpers.factorTileWord([3, 2], 512), 8 * (2 * 512 + 3))
  // 256 lights fill the eight words; a rank past them wraps.
  assert.deepEqual([0, 31, 32, 255, 256].map(helpers.factorWordOf), [0, 0, 1, 7, 0])
  assert.deepEqual([0, 31, 32, 255].map(helpers.factorBitOf), [1, 2 ** 31, 1, 2 ** 31])
})
