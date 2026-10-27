// The depth range of each tile of the direct list: the word the cull of the lights reads, two half floats (`tileDepthRangeWgsl.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { f32Bits } from '../../../../../math/src/float/bits.ts'
import { fromHalf, toHalf } from '../../../../../math/src/float/half.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { TILE_DEPTH_RANGE_WGSL } from './tileDepthRangeWgsl.ts'

/** The two depths of a tile's word, the least in the low half. */
const unpacked = (word: number) => [fromHalf(word & 0xffff), fromHalf(word >>> 16)]

test("a tile's depth range is its least and greatest depth rounded to half floats, 0 and 1 where no texel holds a surface or the greatest is 0", () => {
  const { packedDepthRange } = shaderRun<{
    packedDepthRange: (lowest: number, highest: number) => number
  }>(TILE_DEPTH_RANGE_WGSL, ['packedDepthRange'], {})
  const none = 0xffffffff
  assert.deepEqual(unpacked(packedDepthRange(none, 0)), [0, 1], 'no texel')
  assert.deepEqual(
    unpacked(packedDepthRange(f32Bits(0), 0)),
    [0, 1],
    'every depth is 0: the greatest reads as none',
  )
  for (const [least, greatest] of [
    [0.25, 0.75],
    [1 / 3, 2 / 3],
    [12345 / 65535, 54321 / 65535],
  ])
    assert.deepEqual(
      unpacked(packedDepthRange(f32Bits(least), f32Bits(greatest))),
      [fromHalf(toHalf(least)), fromHalf(toHalf(greatest))],
      `${least} ${greatest}`,
    )
})

test('the pass writes a word a tile of the direct list, from the depths of the texels that hold a surface', () => {
  const text = wgslSource(TILE_DEPTH_RANGE_WGSL)
  assert.match(text, /if\(tile>=ctxListed\(LG_LIST_DIRECT\)\)\{return;\}/)
  assert.match(text, /if\(texel\.valid\)\{/)
  assert.match(text, /depthRanges\[tile\]=packedDepthRange\(/)
})
