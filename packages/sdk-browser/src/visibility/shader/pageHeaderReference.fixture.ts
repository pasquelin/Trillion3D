// The header of a `WGP3` page written from the format alone (`sdk-core/src/page/format.ts`): the words of
// the header and the stream order, never the shader (`pageHeaderReference.test.ts`).
import {
  BLOCK_CORNERS,
  CENTIMETRES_PER_METRE,
  CLUSTER_HEADER_WORDS,
  FLAG_COLOR,
  FLAG_NORMAL,
  FLAG_SKIN,
  FLAG_TANGENT,
  HEADER_UV_SETS,
  MAX_UV_SETS,
  MORPH_WORDS,
  OPTIONAL,
  RESIDENT_TABLE_WORDS,
  UV_EXTENSION_WORDS,
} from '../../../../sdk-core/src/page/format.ts'
import { WIDTH_BITS } from '../../../../sdk-core/src/page/format.ts'
import { floorLog2 } from '../../../../math/src/scalar/integers.ts'

/** The bits an unsigned 32-bit integer spans, 0 for 0 (`bitLength` of the WGSL library). */
const bitLength = (v: number) => floorLog2(v) + 1

export type Header = Record<string, number | number[]>
/** The presence bit of each texture set, set 0 first: the optional attributes the format lists in stream order, the sets' among them. */
const UV_FLAGS = OPTIONAL.filter(([name]) => name.startsWith('uv')).map(([, , flag]) => flag)

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
  const morphCount = (w(21) >>> 6) & 255
  // The ranges of the first sets lie in the header, those of the sets past them, one pair each for
  // the sets the page carries, after the morph records.
  let extension = CLUSTER_HEADER_WORDS + MORPH_WORDS * morphCount
  const sets = Array.from({ length: MAX_UV_SETS }, (_, s) => {
    if (!(flags & UV_FLAGS[s])) return [0, 0]
    if (s < HEADER_UV_SETS) return [w(9 + 2 * s), w(10 + 2 * s)]
    extension += UV_EXTENSION_WORDS
    return [w(extension - 2), w(extension - 1)]
  })
  const [uvBitsX, uvBitsY] = [0, 1].map((c) => sets.map((pair) => pair[c] & 31))
  const [uvMinX, uvMinY] = [0, 1].map((c) => sets.map((pair) => pair[c] >>> 5))
  const [colorMin, colorBits] = [fields(w(17), 4, 8), fields(w(18), 4, 4)]
  const [normalBits, tangentBits] = [(w(18) >>> 16) & 15, (w(18) >>> 20) & 15]
  // The table of the streams' offsets closes the extension: two to a word, 16 bits each, the
  // order of `Layout::table`; the streams follow it.
  const table = extension
  const offset = (k: number) => (w(table + (k >> 1)) >>> (16 * (k & 1))) & 0xffff
  const streams = table + RESIDENT_TABLE_WORDS
  const [blocks, corners] = [offset(0), offset(1)]
  const pos = [2, 3, 4].map(offset)
  const links = offset(5)
  const normal = (flags & FLAG_NORMAL) !== 0 ? [offset(6), offset(7)] : [0, 0]
  const [uvX, uvY] = [[] as number[], [] as number[]]
  for (let s = 0; s < MAX_UV_SETS; s++) {
    const present = (flags & UV_FLAGS[s]) !== 0
    uvX.push(present ? offset(8 + 2 * s) : 0)
    uvY.push(present ? offset(9 + 2 * s) : 0)
  }
  const color = [24, 25, 26, 27].map((k) => ((flags & FLAG_COLOR) !== 0 ? offset(k) : 0))
  const tail = (flags & (FLAG_TANGENT | FLAG_SKIN)) !== 0
  const [tangent, skin] = [tail ? offset(28) : 0, tail ? offset(29) : 0]
  return {
    ...{ vertexCount, indexCount, flags, indexBits, prefixBits, recordBits, positionCount },
    ...{ linkBits, posBits, posUnit: unit(w(5)), posStart: [6, 7, 8].map((i) => w(i) | 0) },
    ...{ skinBits: w(21) & 63, morphCount, skinBase: (w(21) >>> 14) & 0xffff, streams },
    ...{ blocks, corners, pos, links, uvBitsX, uvBitsY, uvMinX, uvMinY, colorBits, colorMin },
    ...{
      normalBits,
      tangentBits,
      influences: w(22),
      normal,
      uvX,
      uvY,
      color,
      tangent,
      skin,
      table,
    },
  }
}
/** The fields a shader row reads once its corners and positions are decoded: all but the
 *  attribute grids and the streams past the links. */
export const POINT = Object.keys(
  reference(new Uint32Array(CLUSTER_HEADER_WORDS).fill(1), 0),
).filter((k) => !/^(flags|uv|color|normal|tangent|skin|influences)/.test(k))
