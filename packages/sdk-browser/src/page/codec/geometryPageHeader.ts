import { GEOMETRY_PAGE_FORMAT_VERSION } from '../../../../sdk-core/src/index.ts'
import {
  morphWords,
  readDeformation,
  skinWords,
  type PageMorph,
  type PageSkin,
  validateRawDeformation,
} from './geometryPageDeform.ts'
import { bitsFor } from '../../../../page-codec/src/pageGrids.ts'
import { field } from '../../../../page-codec/src/bits.ts'
import {
  CLUSTER_HEADER_WORDS,
  CLUSTER_PAGE_MAGIC,
  FLAGS_ALL,
  FLAG_COLOR,
  FLAG_SKIN,
  MORPH_WORDS,
  FLAG_NORMAL,
  FLAG_UV,
  FLAG_UV1,
  MAX_BITS,
  MAX_EXPONENT,
  MAX_WIDTH,
  OPTIONAL,
  BLOCK_CORNERS,
  TRIANGLE_BLOCK,
  WIDTH_BITS,
} from '../../cluster/format.ts'

/** The widths of a page's corner code (`CornerCode`, `triangles.rs`). */
type CornerCode = { indexBits: number; prefixBits: number; recordBits: number }

/** Block `b`'s record, the table at word `table` of `words`: its base, its width and the bit of the
 *  corner stream its first corner lies at (`CornerCode::record`). */
export function blockRecord(words: Uint32Array, table: number, corners: CornerCode, b: number) {
  const { indexBits, prefixBits, recordBits } = corners
  const at = table * 32 + b * recordBits
  return [
    field(words, at, indexBits),
    field(words, at + indexBits, WIDTH_BITS),
    field(words, at + indexBits + WIDTH_BITS, prefixBits) * BLOCK_CORNERS,
  ]
}

/** A vector attribute's grid: its minima, its power-of-two step and its per-component widths. */
export type Quant = { min: number[]; exponent: number; bits: number[] }

/** A quantization record from its packed word (six bits per width, the exponent in the top byte). */
function record(word: number, min: number[]): Quant | null {
  const n = min.length,
    bits = Array.from({ length: n }, (_, c) => (word >>> (6 * c)) & 63),
    exponent = word >> 24
  let repacked = (exponent & 255) << 24
  for (let c = 0; c < n; c++) repacked |= bits[c] << (6 * c)
  const sane =
    Math.abs(exponent) <= MAX_EXPONENT &&
    bits.every((b) => b <= MAX_BITS) &&
    min.every(Number.isFinite) &&
    repacked >>> 0 === word
  return sane ? { min, exponent, bits } : null
}

/** The header's counts, flags and grids, the magic and the version checked, the grids sane. */
function readHeaderFields(head: DataView) {
  const w = (i: number) => head.getUint32(i * 4, true),
    f = (i: number) => head.getFloat32(i * 4, true)
  if (w(0) !== CLUSTER_PAGE_MAGIC || w(1) !== GEOMETRY_PAGE_FORMAT_VERSION)
    throw new Error('GEOMETRY_PAGE_VERSION')
  const vertexCount = w(2),
    indexCount = w(3),
    flags = w(4),
    position = record(w(5), [f(6), f(7), f(8)]),
    uv = record(w(9), [f(10), f(11)]),
    uv2 = record(w(12), [f(13), f(14)]),
    color = record(w(15), [f(16), f(17), f(18), f(19)]),
    quantizationError = f(20),
    cornerBits = w(21),
    positionCount = w(22)
  if (!position || !uv || !uv2 || !color) throw new Error('GEOMETRY_PAGE_BOUNDS')
  return {
    vertexCount,
    indexCount,
    flags,
    position,
    uv,
    uv2,
    color,
    quantizationError,
    cornerBits,
    positionCount,
  }
}

type HeaderFields = ReturnType<typeof readHeaderFields>

/** The word offset of each stream, derived from the counts and widths the header declares, and
 *  the words the body holds. */
function layoutStreams(h: HeaderFields, skin: PageSkin, morphs: readonly PageMorph[]) {
  const { vertexCount, indexCount, flags, cornerBits, positionCount } = h
  const indexBits = bitsFor(vertexCount - 1),
    prefixBits = bitsFor(Math.floor(cornerBits / BLOCK_CORNERS)),
    recordBits = indexBits + WIDTH_BITS + prefixBits,
    corners: CornerCode = { indexBits, prefixBits, recordBits }
  let at = 0
  const stream = (present: boolean, count: number, bits: number) => {
    const start = at
    if (present) at += Math.ceil((count * bits) / 32)
    return start
  }
  const blockCount = Math.ceil(indexCount / 3 / TRIANGLE_BLOCK),
    blocks = stream(true, blockCount, recordBits),
    cornerStream = stream(true, cornerBits, 1),
    positions = h.position.bits.map((b) => stream(true, positionCount, b)),
    linked = positionCount < vertexCount,
    linkBits = bitsFor(positionCount - 1),
    links = stream(linked, vertexCount, linkBits),
    normal = stream(!!(flags & FLAG_NORMAL), vertexCount, 16),
    uvs = h.uv.bits.map((b) => stream(!!(flags & FLAG_UV), vertexCount, b)),
    uv2s = h.uv2.bits.map((b) => stream(!!(flags & FLAG_UV1), vertexCount, b)),
    colors = h.color.bits.map((b) => stream(!!(flags & FLAG_COLOR), vertexCount, b)),
    skinned = at
  if (flags & FLAG_SKIN) at += skinWords(skin, vertexCount)
  // Each target's record names the word its streams start at: recomputed here, trusted if equal.
  const placed = morphs.every((morph) => {
    const start = at
    at += morphWords(morph, vertexCount)
    return morph.start === start
  })
  return {
    corners,
    blockCount,
    linked,
    linkBits,
    placed,
    bodyWords: at,
    streams: {
      blocks,
      corners: cornerStream,
      positions,
      links,
      normal,
      uvs,
      uv2s,
      colors,
      skinned,
    },
  }
}

type StreamLayout = ReturnType<typeof layoutStreams>

/** The counts agree with each other, with the bound a decode may take and with the page's own
 *  byte length. */
function checkCounts(
  h: HeaderFields,
  layout: StreamLayout,
  skin: PageSkin,
  morphs: readonly PageMorph[],
  headerWords: number,
  byteLength: number,
  maxDecodedBytes: number,
) {
  const { vertexCount, indexCount, flags, cornerBits, positionCount, quantizationError } = h
  let floats = 3 + (flags & FLAG_SKIN ? 2 * skin.influences : 0) + 6 * morphs.length
  for (const [, size, bit] of OPTIONAL) if (flags & bit) floats += size
  const decodedBytes = vertexCount * floats * 4 + indexCount * 4
  if (
    !vertexCount ||
    vertexCount > 65535 ||
    !positionCount ||
    positionCount > vertexCount ||
    indexCount < 3 ||
    indexCount % 3 ||
    cornerBits > indexCount * MAX_WIDTH ||
    flags & ~FLAGS_ALL ||
    !(quantizationError >= 0) ||
    !Number.isFinite(quantizationError) ||
    decodedBytes > maxDecodedBytes ||
    !layout.placed ||
    (headerWords + layout.bodyWords) * 4 !== byteLength
  )
    throw new Error('GEOMETRY_PAGE_BOUNDS')
  return decodedBytes
}

/** Each block's base, width and corners stay in bounds, and so does each link: the GPU reads the
 *  page in place on this. The link stream ends where the normal stream starts. */
function checkCornerBlocks(
  head: DataView,
  headerWords: number,
  h: HeaderFields,
  layout: StreamLayout,
) {
  const { vertexCount, indexCount, cornerBits, positionCount } = h,
    { corners, streams, linked, linkBits } = layout
  const words = (from: number, to: number) =>
      Uint32Array.from({ length: to - from }, (_, i) =>
        head.getUint32((headerWords + from + i) * 4, true),
      ),
    table = words(0, streams.corners)
  for (let b = 0; b < layout.blockCount; b++) {
    const [base, width, start] = blockRecord(table, streams.blocks, corners, b),
      end = start + Math.min(BLOCK_CORNERS, indexCount - b * BLOCK_CORNERS) * width
    if (base >= vertexCount || width > corners.indexBits || end > cornerBits)
      throw new Error('GEOMETRY_PAGE_BOUNDS')
  }
  const linkWords = linked ? words(streams.links, streams.normal) : table
  for (let i = 0; linked && i < vertexCount; i++)
    if (field(linkWords, i * linkBits, linkBits) >= positionCount)
      throw new Error('GEOMETRY_PAGE_BOUNDS')
}

/**
 * The 25-word header of a `WGP3` page, read and checked: magic, format version, the four
 * quantization grids, the corner stream's bit count, the stored positions, the skin and morph
 * records (`geometryPageDeform.ts`), and counts that agree with the page's own byte length — the stream layout is
 * derived from the counts and widths the header declares, so a page whose body does not measure
 * exactly what its header describes is refused here rather than read out of bounds.
 *
 * This is the one gate of the format on this side. The full decode goes through it, and so does
 * every reader that only admits the bytes — the WebGPU pool, which uploads the page words in place
 * and never decodes them on the CPU — so both refuse the same bytes for the same reason.
 */
export function readGeometryPageHeader(data: Uint8Array, maxDecodedBytes = 16 * 1024 * 1024) {
  if (data.byteLength < CLUSTER_HEADER_WORDS * 4) throw new Error('GEOMETRY_PAGE_HEADER')
  const head = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const h = readHeaderFields(head)
  const { skin, morphs } = readDeformation(head, h.flags),
    headerWords = CLUSTER_HEADER_WORDS + morphs.length * MORPH_WORDS,
    layout = layoutStreams(h, skin, morphs),
    decodedBytes = checkCounts(
      h,
      layout,
      skin,
      morphs,
      headerWords,
      data.byteLength,
      maxDecodedBytes,
    )
  const { vertexCount, indexCount, flags } = h
  validateRawDeformation(
    head,
    headerWords,
    vertexCount,
    flags,
    layout.streams.skinned,
    skin,
    morphs,
  )
  checkCornerBlocks(head, headerWords, h, layout)
  return {
    vertexCount,
    indexCount,
    flags,
    quantizationError: h.quantizationError,
    position: h.position,
    uv: h.uv,
    uv2: h.uv2,
    color: h.color,
    corners: layout.corners,
    positionCount: h.positionCount,
    linkBits: layout.linkBits,
    skin,
    morphs,
    headerWords,
    bodyWords: layout.bodyWords,
    decodedBytes,
    streams: layout.streams,
  }
}
