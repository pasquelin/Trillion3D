// The shadow mask's program assembles into a module that names nothing it does not declare, at the bindings its layout
// entries describe; a texel's byte and a trace word are packed as the shipped helpers pack them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { SHADOW_FACTOR_TILE_WORDS, SHADOW_MASK, SHADOW_TRACE, tracedShadowWords } from './layout.ts'
import {
  SHADOW_MASK_BINDINGS,
  SHADOW_MASK_ENTRY,
  SHADOW_MASK_PROGRAM_WGSL,
  SHADOW_MASK_WGSL,
} from './shadowMaskWgsl.ts'

test('the program assembles: every name declared once, none reserved, the braces paired', () => {
  assertProgramAssembles(SHADOW_MASK_PROGRAM_WGSL, SHADOW_MASK_ENTRY)
})

test('its buffers are bound where the kernel lays them: the parameters, then the tables, the context, the tiles’ lights, the masks, the lights, the clouds’ block, the factors, the traces and the light tiles', () => {
  const B = SHADOW_MASK_BINDINGS
  assert.deepEqual(wgslBufferBindings(SHADOW_MASK_PROGRAM_WGSL), [
    { binding: 0, type: 'uniform' },
    { binding: B.tables, type: 'read-only-storage' },
    { binding: B.context, type: 'read-only-storage' },
    { binding: B.tileLights, type: 'read-only-storage' },
    { binding: B.masks, type: 'storage' },
    { binding: B.lights, type: 'read-only-storage' },
    // The clouds' shade is read through a uniform block.
    { binding: B.cloudBlock, type: 'uniform' },
    { binding: B.factors, type: 'read-only-storage' },
    { binding: B.traces, type: 'storage' },
    { binding: B.lightTiles, type: 'storage' },
  ])
  // Eight storage buffers: the guaranteed limit.
  assert.equal(
    wgslBufferBindings(SHADOW_MASK_PROGRAM_WGSL).filter(({ type }) => type !== 'uniform').length,
    8,
  )
})

/** The shipped helpers of the masks and the traces, run in JavaScript (`shaderRun`). */
const helpers = shaderRun<{
  shadowByteOf: (ray: { factor: number; complete: boolean }) => number
  shadowRayOf: (byte: number) => { factor: number; complete: boolean }
  shadowByteIn: (word: number, bit: number) => number
  packShadowTrace: (lightTile: number, coord: number[], downsample: number) => number
  shadowTraceLightTile: (word: number) => number
  shadowTraceCoord: (word: number) => number[]
  shadowTraceDownsample: (word: number) => number
  factorTileWord: (tile: number[], tilesAlong: number) => number
  factorWordOf: (rank: number) => number
  factorBitOf: (rank: number) => number
}>(
  wgslModule(SHADOW_MASK_WGSL),
  [
    'shadowByteOf',
    'shadowRayOf',
    'shadowByteIn',
    'packShadowTrace',
    'shadowTraceLightTile',
    'shadowTraceCoord',
    'shadowTraceDownsample',
    'factorTileWord',
    'factorWordOf',
    'factorBitOf',
  ],
  {},
)

test('a texel’s byte is its factor on 7 bits and the complete bit; read back it is the factor quantised to 1/127', () => {
  // The factor on 7 bits is at most 127 and the complete flag is the bit above it.
  for (const factor of [0, 0.25, 0.5, 0.999, 1]) {
    for (const complete of [false, true]) {
      const byte = helpers.shadowByteOf({ factor, complete })
      assert.ok(byte < 256)
      const ray = helpers.shadowRayOf(byte)
      assert.equal(ray.complete, complete)
      assert.equal(
        Math.fround(ray.factor),
        Math.fround(Math.floor(Math.fround(factor) * 127) / 127),
      )
      assert.ok(Math.abs(ray.factor - factor) <= 1 / 127)
    }
  }
  // A factor past the range cannot reach the complete bit.
  assert.equal(helpers.shadowByteOf({ factor: 3, complete: false }), 127)
  assert.equal(helpers.shadowByteOf({ factor: -1, complete: true }), 128)
  // The 64 texels of a tile fill the words of one mask, and a tile holds sixteen quads of four.
  assert.equal(SHADOW_MASK.tileWords * 32, 64 * SHADOW_MASK.rayBits)
  assert.equal(SHADOW_MASK.quads, 16)
})

test('a mask word holds four texels’ bytes, each read from its own bit', () => {
  const word = 0x80_7f_01_ff
  assert.deepEqual(
    [0, 8, 16, 24].map((bit) => helpers.shadowByteIn(word, bit)),
    [0xff, 0x01, 0x7f, 0x80],
  )
  // The bit counts across the words of a mask: it is taken modulo the word.
  assert.equal(helpers.shadowByteIn(word, 32 + 16), 0x7f)
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

test('the masks and the traces are sized by the light tiles: 16 words a tile, one word a trace for each texel, at least a thousand; two words a light tile', () => {
  assert.equal(tracedShadowWords(100).masks, 1600)
  assert.equal(tracedShadowWords(100).traces, 1 + 64 * 100)
  assert.equal(tracedShadowWords(1).traces, 1 + 1024)
  assert.equal(tracedShadowWords(100).lightTiles, 200)
})
