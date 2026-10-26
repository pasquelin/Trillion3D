import { blocksAcross } from '../../../../sdk-core/src/texture/previewLevels.ts'
import { PREVIEW_BLOCK_BYTES } from '../../../../sdk-core/src/texture/previewFormat.ts'
import { toHalf } from '../../../../math/src/float/half.ts'
import { decodeBc4Channel } from './blockDecode.ts'

/**
 * The layouts a texture's compression setting adds to the stored family (`texture/setting.rs`),
 * read where the pool is not made of them: BC4 blocks of one channel, and the eight-bit blocks of
 * a `gray` or `displacement` chain, decoded to one byte a texel for the one-channel pool or to RGBA8
 * for the lossless one; BC6H blocks of a half-float chain, decoded to half-float texels for a pool
 * that is not BC6H. All run in a page worker with the BC7 and BC5 decoders
 * (`geometry/work/task.ts`).
 */

const BC4_BLOCK_BYTES = 8
/** Bytes of a `gray` or `displacement` block: the sixteen texels of a 4 × 4 square, row by row. */
const RAW_BLOCK_BYTES = 16

/** The texels of `blocks`, a `width` × `height` surface of BC4 blocks: one byte a texel when
 *  `single`, else RGBA8 with the channel in R, 0 in G and B, opaque. Whole blocks wide, rows packed. */
export function decodeBc4Level(blocks: Uint8Array, width: number, height: number, single = false) {
  const across = blocksAcross(width),
    down = blocksAcross(height)
  if (blocks.byteLength !== across * down * BC4_BLOCK_BYTES)
    throw new Error(`TEXTURE_BLOCK_BYTES ${width}x${height}: ${blocks.byteLength}`)
  const texel = single ? 1 : 4
  const pitch = across * 4 * texel
  const out = new Uint8Array(pitch * down * 4)
  for (let by = 0; by < down; by++)
    for (let bx = 0; bx < across; bx++) {
      const at = by * 4 * pitch + bx * 4 * texel
      decodeBc4Channel(blocks, (by * across + bx) * BC4_BLOCK_BYTES, out, at, pitch, 0, texel)
      if (!single) for (let t = 0; t < 16; t++) out[at + (t >> 2) * pitch + (t & 3) * 4 + 3] = 255
    }
  return out
}

/** The texels of `blocks`, a `width` × `height` surface of the eight-bit blocks of a `gray` chain
 *  (`g8`: the channel in RGB, opaque) or a `displacement` one (`a8`: the channel in all four):
 *  one byte a texel when `single`, else RGBA8. Whole blocks wide, rows packed. */
export function decodeRawLevel(
  blocks: Uint8Array,
  width: number,
  height: number,
  codec: 'g8' | 'a8',
  single = false,
) {
  const across = blocksAcross(width),
    down = blocksAcross(height)
  if (blocks.byteLength !== across * down * RAW_BLOCK_BYTES)
    throw new Error(`TEXTURE_BLOCK_BYTES ${width}x${height}: ${blocks.byteLength}`)
  const texel = single ? 1 : 4
  const pitch = across * 4 * texel
  const out = new Uint8Array(pitch * down * 4)
  for (let by = 0; by < down; by++)
    for (let bx = 0; bx < across; bx++)
      for (let t = 0; t < 16; t++) {
        const value = blocks[(by * across + bx) * RAW_BLOCK_BYTES + t]
        const at = (by * 4 + (t >> 2)) * pitch + (bx * 4 + (t & 3)) * texel
        if (single) out[at] = value
        else out.set([value, value, value, codec === 'a8' ? value : 255], at)
      }
  return out
}

// BC6H, unsigned. A mode's header (2 or 5 bits) names it; its endpoints' bits then lie in the
// order of its row below, each field `channel + endpoint : bits` placed at `<< shift`.

/** Per mode: whether endpoints 1.. are deltas of endpoint 0, partition bits, endpoint bits, delta
 *  bits per channel, and the fields in the order the block holds them. */
type Mode = {
  delta: boolean
  partition: boolean
  bits: number
  deltaBits: [number, number, number]
  fields: string
}
const mode = (
  delta: boolean,
  partition: boolean,
  bits: number,
  deltaBits: [number, number, number],
  fields: string,
): Mode => ({ delta, partition, bits, deltaBits, fields })

/** Fields: `r0:10` the next ten bits are the low bits of endpoint 0's red; `r0:1<10` one bit placed at bit 10. */
const MODES: Record<number, Mode> = {
  0: mode(
    true,
    true,
    10,
    [5, 5, 5],
    'g2:1<4 b2:1<4 b3:1<4 r0:10 g0:10 b0:10 r1:5 g3:1<4 g2:4 g1:5 b3:1 g3:4 b1:5 b3:1<1 b2:4 r2:5 b3:1<2 r3:5 b3:1<3',
  ),
  1: mode(
    true,
    true,
    7,
    [6, 6, 6],
    'g2:1<5 g3:1<4 g3:1<5 r0:7 b3:1 b3:1<1 b2:1<4 g0:7 b2:1<5 b3:1<2 g2:1<4 b0:7 b3:1<3 b3:1<5 b3:1<4 r1:6 g2:4 g1:6 g3:4 b1:6 b2:4 r2:6 r3:6',
  ),
  2: mode(
    true,
    true,
    11,
    [5, 4, 4],
    'r0:10 g0:10 b0:10 r1:5 r0:1<10 g2:4 g1:4 g0:1<10 b3:1 g3:4 b1:4 b0:1<10 b3:1<1 b2:4 r2:5 b3:1<2 r3:5 b3:1<3',
  ),
  3: mode(false, false, 10, [10, 10, 10], 'r0:10 g0:10 b0:10 r1:10 g1:10 b1:10'),
  6: mode(
    true,
    true,
    11,
    [4, 5, 4],
    'r0:10 g0:10 b0:10 r1:4 r0:1<10 g3:1<4 g2:4 g1:5 g0:1<10 g3:4 b1:4 b0:1<10 b3:1<1 b2:4 r2:4 b3:1 b3:1<2 r3:4 g2:1<4 b3:1<3',
  ),
  7: mode(true, false, 11, [9, 9, 9], 'r0:10 g0:10 b0:10 r1:9 r0:1<10 g1:9 g0:1<10 b1:9 b0:1<10'),
  10: mode(
    true,
    true,
    11,
    [4, 4, 5],
    'r0:10 g0:10 b0:10 r1:4 r0:1<10 b2:1<4 g2:4 g1:4 g0:1<10 b3:1 g3:4 b1:5 b0:1<10 b2:4 r2:4 b3:1<1 b3:1<2 r3:4 b3:1<4 b3:1<3',
  ),
  11: mode(
    true,
    false,
    12,
    [8, 8, 8],
    'r0:10 g0:10 b0:10 r1:8 r0:1<11 r0:1<10 g1:8 g0:1<11 g0:1<10 b1:8 b0:1<11 b0:1<10',
  ),
  14: mode(
    true,
    true,
    9,
    [5, 5, 5],
    'r0:9 b2:1<4 g0:9 g2:1<4 b0:9 b3:1<4 r1:5 g3:1<4 g2:4 g1:5 b3:1 g3:4 b1:5 b3:1<1 b2:4 r2:5 b3:1<2 r3:5 b3:1<3',
  ),
  15: mode(
    true,
    false,
    16,
    [4, 4, 4],
    'r0:10 g0:10 b0:10 r1:4 r0:1<15 r0:1<14 r0:1<13 r0:1<12 r0:1<11 r0:1<10 g1:4 g0:1<15 g0:1<14 g0:1<13 g0:1<12 g0:1<11 g0:1<10 b1:4 b0:1<15 b0:1<14 b0:1<13 b0:1<12 b0:1<11 b0:1<10',
  ),
  18: mode(
    true,
    true,
    8,
    [6, 5, 5],
    'r0:8 g3:1<4 b2:1<4 g0:8 b3:1<2 g2:1<4 b0:8 b3:1<3 b3:1<4 r1:6 g2:4 g1:5 b3:1 g3:4 b1:5 b3:1<1 b2:4 r2:6 r3:6',
  ),
  22: mode(
    true,
    true,
    8,
    [5, 6, 5],
    'r0:8 b3:1 b2:1<4 g0:8 g2:1<5 g2:1<4 b0:8 g3:1<5 b3:1<4 r1:5 g3:1<4 g2:4 g1:6 g3:4 b1:5 b3:1<1 b2:4 r2:5 b3:1<2 r3:5 b3:1<3',
  ),
  26: mode(
    true,
    true,
    8,
    [5, 5, 6],
    'r0:8 b3:1<1 b2:1<4 g0:8 b2:1<5 g2:1<4 b0:8 b3:1<5 b3:1<4 r1:5 g3:1<4 g2:4 g1:5 b3:1 g3:4 b1:6 b2:4 r2:5 b3:1<2 r3:5 b3:1<3',
  ),
  30: mode(
    false,
    true,
    6,
    [6, 6, 6],
    'r0:6 g3:1<4 b3:1 b3:1<1 b2:1<4 g0:6 g2:1<5 b2:1<5 b3:1<2 g2:1<4 b0:6 g3:1<5 b3:1<3 b3:1<5 b3:1<4 r1:6 g2:4 g1:6 g3:4 b1:6 b2:4 r2:6 r3:6',
  ),
}

/** The sixteen 16-bit-wide two-subset partitions' masks of the first thirty-two (a bit a texel, set: subset 1). */
const PARTITIONS = [
  0xcccc, 0x8888, 0xeeee, 0xecc8, 0xc880, 0xfeec, 0xfec8, 0xec80, 0xc800, 0xffec, 0xfe80, 0xe800,
  0xffe8, 0xff00, 0xfff0, 0xf000, 0xf710, 0x008e, 0x7100, 0x08ce, 0x008c, 0x7310, 0x3100, 0x8cce,
  0x088c, 0x3110, 0x6666, 0x366c, 0x17e8, 0x0ff0, 0x718e, 0x399c,
]
/** The second subset's anchor texel of each of them. */
const ANCHORS = [
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2,
  2, 8, 8, 2, 2,
]
/** Interpolation weights over 64 of the three-bit and four-bit indices. */
const WEIGHTS = [
  [0, 9, 18, 27, 37, 46, 55, 64],
  [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64],
]

/** An endpoint widened to the full 16 bits, by the format's rule: zero and the largest value keep their ends. */
const unquantize = (value: number, bits: number) =>
  bits >= 15
    ? value
    : value === 0
      ? 0
      : value === (1 << bits) - 1
        ? 0xffff
        : (((value << 15) + 0x4000) >> (bits - 1)) & 0xffff
const signExtend = (value: number, bits: number) => {
  const mask = 1 << (bits - 1)
  return ((value ^ mask) - mask) & 0xffff
}
const HALF_ONE = toHalf(1)

/** Reads bits of a 16-byte block from `at`, the first in the lowest. */
function reader(bytes: Uint8Array, offset: number) {
  let place = 0
  return (count: number) => {
    let value = 0
    for (let i = 0; i < count; i++, place++)
      value |= ((bytes[offset + (place >> 3)] >> (place & 7)) & 1) << i
    return value
  }
}

/** Parsed once: a mode's fields as [channel, endpoint, bits, shift]. */
const PARSED = new Map<Mode, [number, number, number, number][]>()
const fieldsOf = (m: Mode) => {
  let parsed = PARSED.get(m)
  if (!parsed) {
    parsed = m.fields.split(' ').map((field) => {
      const [name, rest] = field.split(':')
      const [count, shift] = rest.split('<')
      return ['r', 'g', 'b'].includes(name[0])
        ? ['rgb'.indexOf(name[0]), Number(name[1]), Number(count), Number(shift ?? 0)]
        : [0, 0, 0, 0]
    })
    PARSED.set(m, parsed)
  }
  return parsed
}

/** One BC6H block (unsigned) into sixteen half-float RGBA texels at `out[at]`, rows `pitch` bytes apart. */
function decodeBc6hBlock(
  bytes: Uint8Array,
  offset: number,
  out: DataView,
  at: number,
  pitch: number,
) {
  const read = reader(bytes, offset)
  let id = read(2)
  if (id & 2) id |= read(3) << 2
  const m = MODES[id]
  if (!m) {
    // A reserved mode reads as black.
    for (let t = 0; t < 16; t++) writeTexel(out, at + (t >> 2) * pitch + (t & 3) * 8, 0, 0, 0)
    return
  }
  const ep = [0, 1, 2].map(() => [0, 0, 0, 0])
  for (const [channel, endpoint, count, shift] of fieldsOf(m))
    ep[channel][endpoint] |= read(count) << shift
  const subsets = m.partition ? 2 : 1
  for (let i = 1; i < subsets * 2; i++)
    for (let c = 0; c < 3; c++) {
      if (m.delta) {
        ep[c][i] = signExtend(ep[c][i], m.deltaBits[c])
        ep[c][i] = (ep[c][i] + ep[c][0]) & ((1 << m.bits) - 1)
      }
    }
  for (let i = 0; i < subsets * 2; i++)
    for (let c = 0; c < 3; c++) ep[c][i] = unquantize(ep[c][i], m.bits)
  const part = m.partition ? read(5) : 0
  const indexBits = m.partition ? 3 : 4
  const weights = WEIGHTS[indexBits - 3]
  for (let t = 0; t < 16; t++) {
    const subset = m.partition ? (PARTITIONS[part] >> t) & 1 : 0
    const anchor = t === 0 || (m.partition && subset === 1 && t === ANCHORS[part])
    const w = weights[read(anchor ? indexBits - 1 : indexBits)]
    const channel = (c: number) =>
      (((ep[c][subset * 2] * (64 - w) + ep[c][subset * 2 + 1] * w + 32) >> 6) * 31) >> 6
    writeTexel(out, at + (t >> 2) * pitch + (t & 3) * 8, channel(0), channel(1), channel(2))
  }
}

const writeTexel = (out: DataView, at: number, r: number, g: number, b: number) => {
  out.setUint16(at, r, true)
  out.setUint16(at + 2, g, true)
  out.setUint16(at + 4, b, true)
  out.setUint16(at + 6, HALF_ONE, true)
}

/** The half-float RGBA texels of `blocks`, a `width` × `height` surface of BC6H blocks (unsigned):
 *  eight bytes a texel, whole blocks wide, rows packed. */
export function decodeBc6hLevel(blocks: Uint8Array, width: number, height: number) {
  const across = blocksAcross(width),
    down = blocksAcross(height)
  if (blocks.byteLength !== across * down * PREVIEW_BLOCK_BYTES)
    throw new Error(`TEXTURE_BLOCK_BYTES ${width}x${height}: ${blocks.byteLength}`)
  const pitch = across * 4 * 8
  const out = new Uint8Array(pitch * down * 4)
  const view = new DataView(out.buffer)
  for (let by = 0; by < down; by++)
    for (let bx = 0; bx < across; bx++)
      decodeBc6hBlock(
        blocks,
        (by * across + bx) * PREVIEW_BLOCK_BYTES,
        view,
        by * 4 * pitch + bx * 32,
        pitch,
      )
  return out
}
