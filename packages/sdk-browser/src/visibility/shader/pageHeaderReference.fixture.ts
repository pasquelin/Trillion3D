// The header of a `WGP3` page written from the format alone (`cluster/format.ts`): the words of
// the header and the stream order, never the shader (`pageHeaderReference.test.ts`).
import { BLOCK_CORNERS, CLUSTER_HEADER_WORDS, MORPH_WORDS } from '../../cluster/format.ts'
import { TRIANGLE_BLOCK, WIDTH_BITS } from '../../cluster/format.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

export type Header = Record<string, number | number[]>
const bitsFor = (range: number) => 32 - Math.clz32(range)
const words32 = (count: number, bits: number) => Math.ceil((count * bits) / 32)

/** The header of the page at `base` of `words`, field by field, as the format lays it out. */
export function reference(words: Uint32Array, base: number): Header {
  const w = (i: number) => words[base + i]
  const f32 = (i: number) => new Float32Array(new Uint32Array([w(i)]).buffer)[0]
  const widths = (word: number, n: number) =>
    Array.from({ length: n }, (_, c) => (word >>> (6 * c)) & 63)
  const step = (word: number) => 2 ** (word >> 24)
  const [vertexCount, indexCount, flags, positionCount] = [w(2), w(3), w(4), w(22)]
  const indexBits = bitsFor(vertexCount - 1),
    prefixBits = bitsFor(Math.floor(w(21) / BLOCK_CORNERS))
  const recordBits = indexBits + WIDTH_BITS + prefixBits,
    linkBits = bitsFor(positionCount - 1)
  const [posBits, uvBits, uv1Bits, colorBits] = [5, 9, 12, 15].map((i, k) =>
    widths(w(i), [3, 2, 2, 4][k]),
  )
  const morphCount = (w(23) >>> 6) & 255
  let at = CLUSTER_HEADER_WORDS + MORPH_WORDS * morphCount
  const streams = at
  const stream = (present: boolean, count: number, bits: number) => {
    const start = at
    if (present) at += words32(count, bits)
    return start
  }
  const blocks = stream(true, ceilDiv(indexCount / 3, TRIANGLE_BLOCK), recordBits)
  const corners = stream(true, w(21), 1)
  const pos = posBits.map((bits) => stream(true, positionCount, bits))
  const links = at
  stream(positionCount < vertexCount, vertexCount, linkBits)
  const normal = stream((flags & 1) !== 0, vertexCount, 16)
  const uv = uvBits.map((bits) => stream((flags & 2) !== 0, vertexCount, bits))
  const uv1 = uv1Bits.map((bits) => stream((flags & 4) !== 0, vertexCount, bits))
  const color = colorBits.map((bits) => stream((flags & 8) !== 0, vertexCount, bits))
  return {
    ...{ vertexCount, indexCount, flags, indexBits, prefixBits, recordBits, positionCount },
    ...{ linkBits, posBits, posStep: step(w(5)), posMin: [6, 7, 8].map(f32), skinBits: w(23) & 63 },
    ...{ morphCount, skinBase: (w(23) >>> 14) & 0xffff, streams, blocks, corners, pos, links },
    ...{ uvBits, uvStep: step(w(9)), uvMin: [10, 11].map(f32), uv1Bits, uv1Step: step(w(12)) },
    ...{
      uv1Min: [13, 14].map(f32),
      colorBits,
      colorStep: step(w(15)),
      colorMin: [16, 17, 18, 19].map(f32),
    },
    ...{ quantizationError: f32(20), influences: w(24), normal, uv, uv1, color, skin: at },
  }
}
/** The fields a shader row reads once its corners and positions are decoded: all but the
 *  attribute grids and the streams past the links. */
export const POINT = Object.keys(reference(new Uint32Array(25).fill(1), 0)).filter(
  (k) => !/^(flags|uv|uv1|color|normal|skin|influences|quantizationError)/.test(k),
)
