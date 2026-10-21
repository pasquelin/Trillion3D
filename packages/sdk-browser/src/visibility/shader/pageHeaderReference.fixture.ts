// The header of a `WGP3` page written from the format alone (`sdk-core/src/page/format.ts`): the words of
// the header and the stream order, never the shader (`pageHeaderReference.test.ts`).
import {
  BLOCK_CORNERS,
  CENTIMETRES_PER_METRE,
  CLUSTER_HEADER_WORDS,
  FLAG_COLOR,
  FLAG_NORMAL,
  FLAG_TANGENT,
  FLAG_UV,
  FLAG_UV1,
  FLAG_UV2,
  FLAG_UV3,
  MAX_UV_SETS,
  MORPH_WORDS,
} from '../../../../sdk-core/src/page/format.ts'
import { TRIANGLE_BLOCK, WIDTH_BITS } from '../../../../sdk-core/src/page/format.ts'
import { bitLength, ceilDiv } from '../../../../math/src/scalar/integers.ts'

export type Header = Record<string, number | number[]>
const words32 = (count: number, bits: number) => Math.ceil((count * bits) / 32)
const UV_FLAGS = [FLAG_UV, FLAG_UV1, FLAG_UV2, FLAG_UV3]

/** The header of the page at `base` of `words`, field by field, as the format lays it out. */
export function reference(words: Uint32Array, base: number): Header {
  const w = (i: number) => words[base + i]
  const fields = (word: number, count: number, width: number) =>
    Array.from({ length: count }, (_, c) => (word >>> (width * c)) & ((1 << width) - 1))
  // A cell in metres is the cell times a hundredth of the centimetre step: one rounding of the
  // hundredth, then the exact power of two.
  const unit = (word: number) => 2 ** -(word >> 24) * Math.fround(1 / CENTIMETRES_PER_METRE)
  const [vertexCount, indexCount, flags, cornerBits, positionCount] = [
    w(2),
    w(3),
    w(4),
    w(19),
    w(20),
  ]
  const indexBits = bitLength(vertexCount - 1),
    prefixBits = bitLength(Math.floor(cornerBits / BLOCK_CORNERS))
  const recordBits = indexBits + WIDTH_BITS + prefixBits,
    linkBits = bitLength(positionCount - 1)
  const posBits = fields(w(5), 3, 6)
  const sets = Array.from({ length: MAX_UV_SETS }, (_, s) => [w(9 + 2 * s), w(10 + 2 * s)])
  const [uvBitsX, uvBitsY] = [0, 1].map((c) => sets.map((pair) => pair[c] & 31))
  const [uvMinX, uvMinY] = [0, 1].map((c) => sets.map((pair) => pair[c] >>> 5))
  const [colorMin, colorBits] = [fields(w(17), 4, 8), fields(w(18), 4, 4)]
  const [normalBits, tangentBits] = [(w(18) >>> 16) & 15, (w(18) >>> 20) & 15]
  const morphCount = (w(21) >>> 6) & 255
  let at = CLUSTER_HEADER_WORDS + MORPH_WORDS * morphCount
  const streams = at
  const stream = (present: boolean, count: number, bits: number) => {
    const start = at
    if (present) at += words32(count, bits)
    return start
  }
  const blocks = stream(true, ceilDiv(indexCount / 3, TRIANGLE_BLOCK), recordBits)
  const corners = stream(true, cornerBits, 1)
  const pos = posBits.map((bits) => stream(true, positionCount, bits))
  const links = at
  stream(positionCount < vertexCount, vertexCount, linkBits)
  const hasNormal = (flags & FLAG_NORMAL) !== 0
  const normal = [0, 1].map(() => stream(hasNormal, vertexCount, normalBits))
  const [uvX, uvY] = [[] as number[], [] as number[]]
  for (let s = 0; s < MAX_UV_SETS; s++) {
    const present = (flags & UV_FLAGS[s]) !== 0
    uvX.push(stream(present, vertexCount, uvBitsX[s]))
    uvY.push(stream(present, vertexCount, uvBitsY[s]))
  }
  const color = colorBits.map((bits) => stream((flags & FLAG_COLOR) !== 0, vertexCount, bits))
  const tangent = stream((flags & FLAG_TANGENT) !== 0, vertexCount, tangentBits + 1)
  return {
    ...{ vertexCount, indexCount, flags, indexBits, prefixBits, recordBits, positionCount },
    ...{ linkBits, posBits, posUnit: unit(w(5)), posStart: [6, 7, 8].map((i) => w(i) | 0) },
    ...{ skinBits: w(21) & 63, morphCount, skinBase: (w(21) >>> 14) & 0xffff, streams },
    ...{ blocks, corners, pos, links, uvBitsX, uvBitsY, uvMinX, uvMinY, colorBits, colorMin },
    ...{ normalBits, tangentBits, influences: w(22), normal, uvX, uvY, color, tangent, skin: at },
  }
}
/** The fields a shader row reads once its corners and positions are decoded: all but the
 *  attribute grids and the streams past the links. */
export const POINT = Object.keys(
  reference(new Uint32Array(CLUSTER_HEADER_WORDS).fill(1), 0),
).filter((k) => !/^(flags|uv|color|normal|tangent|skin|influences)/.test(k))
