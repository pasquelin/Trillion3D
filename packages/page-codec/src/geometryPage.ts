/**
 * Reference encoder for the `WGP3` quantized cluster page (`docs/FORMAT.md`). The compiler that
 * ships pages is the native one in `asset-compiler-rust`; this independent implementation exists
 * so the browser decoders in `sdk-browser/` are tested against something other than themselves.
 * It quantizes on the same grids — a primitive position exponent, a texture grid of 2^-14 (the
 * compiler's, coarser only where a caller passes a primitive's own), octahedral normal bytes,
 * colour bytes — and packs the same streams, without sharing a line.
 */
import { bitsFor, ceil32, octEncode, Packer, quantize, type QuantizedGrid } from './pageGrids.ts'
import { firstUse, storedPositions } from './pagePositions.ts'
import {
  deformCells,
  deformHeader,
  MORPH_WORDS,
  packDeformation,
  type PageTarget,
} from './pageDeform.ts'
import {
  ATTRIBUTES,
  type PageAttribute,
  type PageAttributes,
  type PageCell,
} from './pageAttributes.ts'
import { saturate } from '../../math/src/scalar/reals.ts'

const MAGIC = 0x33504757,
  VERSION = 7,
  HEADER_WORDS = 25,
  COLOR_EXPONENT = -8
/** The format's texture grid, 2^-14: a quarter of a texel on a 4096-wide map. */
export const UV_EXPONENT = -14

type Records = { uv: [QuantizedGrid | null, QuantizedGrid | null]; color: QuantizedGrid | null }

/** The page's corners, renumbered by first use, and the source vertex each page vertex is. */
function renumberCorners(sourceIndices: ArrayLike<number>, count: number) {
  const local = new Map<number, number>(),
    original: number[] = []
  const corners = Array.from(sourceIndices, (source) => {
    if (!Number.isSafeInteger(source) || source < 0 || source >= count)
      throw new Error('PAGE_INDEX_INVALID')
    let id = local.get(source)
    if (id === undefined) {
      if (original.length >= 65535) throw new Error('PAGE_VERTEX_LIMIT')
      id = original.length
      local.set(source, id)
      original.push(source)
    }
    return id
  })
  return { corners, original }
}

/** One attribute of the page's vertices, `width` floats each, the missing components 1. */
function gatherAttribute(original: readonly number[], attr: PageAttribute, width: number) {
  const out = new Float32Array(original.length * width)
  original.forEach((source, i) => {
    for (let c = 0; c < width; c++) {
      const value = c < attr.itemSize ? attr.array[source * attr.itemSize + c] : 1
      if (!Number.isFinite(value)) throw new Error('PAGE_ATTRIBUTE_NONFINITE')
      out[i * width + c] = value
    }
  })
  return out
}

/** The largest distance a vertex's quantized position lies from its source one. */
function positionError(
  positions: QuantizedGrid,
  position: PageAttribute,
  original: readonly number[],
) {
  let error = 0
  original.forEach((_, i) => {
    let d = 0
    for (let c = 0; c < 3; c++)
      d +=
        (Math.fround(
          positions.min[c] + Math.fround(positions.cells[i * 3 + c] * 2 ** positions.exponent),
        ) -
          position.array[original[i] * 3 + c]) **
        2
    error = Math.max(error, Math.sqrt(d))
  })
  return ceil32(error)
}

/** The page's attributes quantized into `cells`, each one that is present checked; returns the
 *  flags of those present and the grids the header records. */
function quantizeAttributes(
  cells: PageCell[],
  original: readonly number[],
  attributes: PageAttributes,
  count: number,
  uvExponent: number,
) {
  let flags = 0
  const records: Records = { uv: [null, null], color: null }
  for (const [name, size, bit] of ATTRIBUTES) {
    const attr = attributes[name]
    if (!attr) continue
    if (
      (attr.itemSize !== size && !(name === 'COLOR_0' && attr.itemSize === 3)) ||
      attr.array.length !== count * attr.itemSize
    )
      throw new Error('PAGE_ATTRIBUTE_INVALID: ' + name)
    flags |= bit
    const values = gatherAttribute(original, attr, size)
    if (bit === 1)
      cells.forEach(
        (cell, i) => (cell.n = octEncode(values[i * 3], values[i * 3 + 1], values[i * 3 + 2])),
      )
    else if (bit === 8) {
      const record = quantize(
        values.map((v) => saturate(v)),
        4,
        COLOR_EXPONENT,
      )
      records.color = record
      cells.forEach((cell, i) => (cell.c = record.cells.slice(i * 4, i * 4 + 4)))
    } else {
      const set = bit === 2 ? 0 : 1,
        q = quantize(values, 2, uvExponent)
      records.uv[set] = q
      cells.forEach((cell, i) => (cell.uv[set] = q.cells.slice(i * 2, i * 2 + 2)))
    }
  }
  return { flags, records }
}

/** The page's bit streams: the corners, then the positions, normals, texture coordinates, colours
 *  and deformation of the distinct vertices. */
function packStreams(
  unique: readonly PageCell[],
  corners: readonly number[],
  remap: readonly number[],
  positions: QuantizedGrid,
  flags: number,
  records: Records,
  deform: ReturnType<typeof deformCells>,
) {
  const pack = new Packer()
  const cornerBits = pack.corners(
    corners.map((id) => remap[id]),
    bitsFor(unique.length - 1),
  )
  const { stored, links, linkBits } = storedPositions(unique, positions.bits)
  for (let c = 0; c < 3; c++)
    pack.stream(
      stored.map((p) => p[c]),
      positions.bits[c],
    )
  if (links) pack.stream(links, linkBits)
  if (flags & 1)
    pack.stream(
      unique.map((cell) => cell.n),
      16,
    )
  const columns = (get: (cell: PageCell, c: number) => number, widths: readonly number[]) =>
    widths.forEach((bits, c) =>
      pack.stream(
        unique.map((cell) => get(cell, c)),
        bits,
      ),
    )
  for (const set of [0, 1] as const) {
    const grid = records.uv[set]
    if (grid) columns((cell, c) => cell.uv[set][c], grid.bits)
  }
  if (flags & 8 && records.color) columns((cell, c) => cell.c[c], records.color.bits)
  packDeformation(
    pack,
    deform,
    unique.map((cell) => cell.d ?? []),
  )
  return { pack, cornerBits, storedCount: stored.length }
}

/** The page's bytes: its header, then the packed streams. */
function writePage(
  pack: Packer,
  deform: ReturnType<typeof deformCells>,
  header: {
    counts: number[]
    positions: QuantizedGrid
    records: Records
    positionExponent: number
    uvExponent: number
    error: number
    cornerBits: number
    storedCount: number
  },
) {
  const { positions, records, uvExponent } = header,
    headerWords = HEADER_WORDS + deform.morphs.length * MORPH_WORDS,
    data = new Uint8Array((headerWords + pack.words.length) * 4),
    head = new DataView(data.buffer)
  const record = (at: number, q: QuantizedGrid | null, n: number, exponent: number) => {
    let word = ((q?.exponent ?? exponent) & 255) << 24
    for (let c = 0; c < n; c++) word |= (q?.bits[c] ?? 0) << (6 * c)
    head.setUint32(at * 4, word >>> 0, true)
    for (let c = 0; c < n; c++) head.setFloat32((at + 1 + c) * 4, q?.min[c] ?? 0, true)
  }
  header.counts.forEach((word, i) => head.setUint32(i * 4, word, true))
  record(5, positions, 3, header.positionExponent)
  record(9, records.uv[0], 2, uvExponent)
  record(12, records.uv[1], 2, uvExponent)
  record(15, records.color, 4, COLOR_EXPONENT)
  head.setFloat32(80, header.error, true)
  head.setUint32(84, header.cornerBits, true)
  head.setUint32(88, header.storedCount, true)
  deformHeader(head, deform, (at, grid) => record(at, grid, 3, grid.exponent), HEADER_WORDS)
  pack.words.forEach((word, i) => head.setUint32((headerWords + i) * 4, word, true))
  return data
}

/**
 * Encodes one page from source indices and `{ array, itemSize }` attributes (`POSITION`
 * required). Returns the bytes and the manifest counts. Corners are renumbered by first use,
 * then vertices that land on the same cells are kept once, and their positions once each when
 * that is smaller (`pagePositions.ts`). Texture coordinates sit on
 * `2 ** uvExponent`, which the header carries for every decoder.
 */
export function encodeGeometryPage(
  sourceIndices: ArrayLike<number>,
  attributes: PageAttributes,
  positionExponent = -16,
  uvExponent = UV_EXPONENT,
  targets: readonly PageTarget[] = [],
) {
  const position = attributes.POSITION
  if (!position || position.itemSize !== 3 || !position.array.length)
    throw new Error('PAGE_POSITION_REQUIRED')
  if (sourceIndices.length < 3 || sourceIndices.length % 3)
    throw new Error('PAGE_TRIANGLES_INVALID')
  const count = position.array.length / 3,
    { corners, original } = renumberCorners(sourceIndices, count)
  const positions = quantize(gatherAttribute(original, position, 3), 3, positionExponent)
  const cells: PageCell[] = original.map((_, i) => ({
    p: positions.cells.slice(i * 3, i * 3 + 3),
    n: 0,
    uv: [[], []],
    c: [],
  }))
  const error = positionError(positions, position, original)
  const quantized = quantizeAttributes(cells, original, attributes, count, uvExponent)
  const deform = deformCells(attributes, targets, original)
  cells.forEach((cell, i) => (cell.d = deform.fields[i]))
  const flags = quantized.flags | (deform.skin ? 16 : 0) | (targets.length ? 32 : 0)
  const { distinct: unique, ranks: remap } = firstUse(cells, (cell) => JSON.stringify(cell))
  const { pack, cornerBits, storedCount } = packStreams(
    unique,
    corners,
    remap,
    positions,
    flags,
    quantized.records,
    deform,
  )
  const data = writePage(pack, deform, {
    counts: [MAGIC, VERSION, unique.length, corners.length, flags],
    positions,
    records: quantized.records,
    positionExponent,
    uvExponent,
    error,
    cornerBits,
    storedCount,
  })
  let floats = 3 + (deform.skin ? 2 * deform.skin.influences : 0) + 6 * targets.length
  for (const [, size, bit] of ATTRIBUTES) if (flags & bit) floats += size
  return {
    data,
    vertexCount: unique.length,
    indexCount: corners.length,
    flags,
    uncompressedBytes: unique.length * floats * 4 + corners.length * 4,
    quantizationError: error,
  }
}
