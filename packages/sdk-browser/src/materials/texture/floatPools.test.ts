import test from 'node:test'
import assert from 'node:assert/strict'
import { toHalf } from '../../../../math/src/float/half.ts'
import { channelPoolOf, hdr32Of, poolEncoding } from './blockFormats.ts'
import {
  PREVIEW_ATLAS_DATA,
  PREVIEW_ATLAS_HDR,
} from '../../../../sdk-core/src/texture/previewFormat.ts'

// Behaviour: a float chain is kept in the stored family whatever family the device samples. The
// half-float lane holds 32-bit floats where a chain is kept so and the device filters them, else
// half-floats; the channel pool holds the data atlas's float maps at 32 bits (single-float, filterable)
// or 16, beside no normal map. Each reads its chain's own file; the pool decides the texel kind.
/** The white texel of the opaque lane, as the pool's encoding pins it (`PoolEncoding.whiteOf`). */
const WHITE_TAIL = poolEncoding(undefined).whiteOf('lossless')

test('float chains take 32-bit pools where the device filters them, else 16 bits', () => {
  const chain = (
    stored: 'float32' | 'single-float' | 'half-single' | 'two-channel',
    atlas: number,
  ) => ({
    layouts: { bc7: stored, astc: 'lossless', etc2: 'lossless' } as const,
    atlas,
  })
  const colour = chain('float32', PREVIEW_ATLAS_HDR),
    single = chain('single-float', PREVIEW_ATLAS_DATA),
    half = chain('half-single', PREVIEW_ATLAS_DATA)
  assert.equal(hdr32Of([colour], true), true)
  assert.equal(hdr32Of([colour], false), false, 'a device that does not filter 32 bits')
  assert.equal(hdr32Of([], true), false)
  assert.equal(channelPoolOf('bc7', [single], true), 'r32')
  assert.equal(channelPoolOf('bc7', [single], false), 'r16')
  assert.equal(channelPoolOf('bc7', [half], true), 'r16', 'half-floats need no more')
  assert.equal(channelPoolOf('astc', [single], true), 'r32', 'a floating chain needs no BC')
  assert.equal(
    channelPoolOf('bc7', [single, chain('two-channel', PREVIEW_ATLAS_DATA)], true),
    'two',
  )
  const wide = poolEncoding('bc7', false, 'r32', true)
  assert.equal(wide.formatOf('color', 'hdr'), 'rgba32float')
  assert.equal(wide.texelBytes('hdr'), 16)
  assert.equal(wide.formatOf('data', 'two-channel'), 'r32float')
  assert.deepEqual([wide.texelsOf('hdr'), wide.texelsOf('two-channel')], ['rgba32', 'r32'])
  assert.equal(wide.laneOf(colour), 'hdr')
  assert.equal(wide.laneOf(single), 'two-channel')
  assert.equal(poolEncoding('astc', false, 'r32', true).laneOf(single), 'two-channel')
  assert.equal(wide.levelFormat('hdr', colour), 'rgba32f')
  assert.equal(wide.levelFormat('two-channel', single), 'r32f')
  assert.equal(wide.levelFormat('two-channel', half), 'r16f')
  assert.equal(wide.tapOf('two-channel', 'single-float'), 5)
  // A tail: the exact squares unpacked and cropped; a half-float chain's widened; the fill's white.
  const squares = Float32Array.from({ length: 16 }, (_, t) => t)
  const exact = {
    levels: [new Uint8Array(4)],
    blocks: { bc7: [new Uint8Array(squares.buffer)], astc: [], etc2: [] },
    ...single,
  }
  const at = { width: 4, height: 4, tail: 0 }
  const [level] = wide.tailOf(exact, 'two-channel', at)
  assert.deepEqual([...new Float32Array(level.buffer, level.byteOffset, 16)], [...squares])
  const [white] = wide.tailOf(WHITE_TAIL, 'two-channel', at)
  assert.deepEqual([...new Float32Array(white.buffer, white.byteOffset, 1)], [1])
  const narrow = poolEncoding('bc7', false, 'r16', false)
  assert.equal(narrow.formatOf('data', 'two-channel'), 'r16float')
  assert.equal(narrow.formatOf('color', 'hdr'), 'rgba16float')
  const [sixteen] = narrow.tailOf(exact, 'two-channel', at)
  assert.equal(new DataView(sixteen.buffer, sixteen.byteOffset).getUint16(2, true), toHalf(1))
})
