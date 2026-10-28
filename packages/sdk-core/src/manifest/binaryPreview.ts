import { EngineError } from '../contracts/cache.ts'
import { sum } from '../../../math/src/scalar/quantile.ts'
import type { TexturePreview } from '../texture/previewContracts.ts'
import {
  PREVIEW_STORED_LAYOUTS,
  previewLayoutBlockBytes,
  PREVIEW_BLOCK_FORMATS,
  PREVIEW_WORDS,
  PREVIEW_TEXTURE,
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  PREVIEW_ATLAS,
  PREVIEW_ATLAS_HDR,
  PREVIEW_BAKED_LEVELS,
  PREVIEW_FIRST_LEVEL,
  PREVIEW_LEVEL_COUNT,
  PREVIEW_PIXEL_BYTES,
  PREVIEW_PIXEL_OFFSET,
  PREVIEW_LAYOUTS,
  PREVIEW_SOURCE_KIND,
  PREVIEW_IMAGE,
  PREVIEW_SOURCE_URI,
  PREVIEW_SOURCE_VIEW,
  previewTexelBytes,
  type TextureBlockFormat,
} from '../texture/previewFormat.ts'
import { previewGeometry } from '../texture/previewLevels.ts'
import { checkEntryHeader, levelLengths } from './binaryPreviewEntry.ts'

type PreviewColumns = {
  count: number
  previewWords: Uint32Array
  previewShaText: string
  previewPixels: Uint8Array<ArrayBuffer>
  /** Bytes of the pixel column when it lies in its own file (`fillTexturePreviewLevels`): the
   *  sidecar's column is then empty and each entry's `levels` are zero-length views. */
  externalPixelBytes?: number
  /** The block-compressed tails, one column per format, entries contiguous in order. */
  previewBlocks: Record<TextureBlockFormat, Uint8Array<ArrayBuffer>>
}

/** The layout a family's word names, or a refusal of a word no layout owns. */
function layoutOf(entry: number, name: TextureBlockFormat, word: number) {
  const layout = PREVIEW_STORED_LAYOUTS[word]
  if (layout === undefined)
    throw new EngineError('INVALID_CACHE', 'A texture preview names an unknown block layout', {
      entry,
      format: name,
      word,
    })
  return layout
}

/** Consecutive views of `lengths` bytes out of `column` from `at`, and where they end. */
function slices(column: Uint8Array<ArrayBuffer>, at: number, lengths: readonly number[]) {
  const views = lengths.map((length) => {
    const view = column.subarray(at, at + length)
    at += length
    return view
  })
  return { views, end: at }
}

type PreviewGeometry = ReturnType<typeof previewGeometry>

/** Byte length of each RGBA level of a chain of `atlas` and source size, in the pixel column. */
function rgbaLengths({ atlas, width, height }: Pick<TexturePreview, 'atlas' | 'width' | 'height'>) {
  const texelBytes = previewTexelBytes(atlas)
  return levelLengths(previewGeometry(width, height, texelBytes), texelBytes).rgba
}

/** Refuses a pixel file (`file` bytes) that is not as long as its entries imply (`expected`). */
function checkFileLength(file: number, expected: number) {
  if (file !== expected)
    throw new EngineError(
      'INVALID_CACHE',
      `A texture preview pixel file is too ${file < expected ? 'short' : 'long'}`,
      { file, expected },
    )
}

/** Refuses level geometry that is not the one the entry's dimensions imply. */
function checkLevelGeometry(
  entry: number,
  { width, height }: { width: number; height: number },
  declared: { firstLevel: number; levelCount: number; pixelBytes: number },
  expected: PreviewGeometry,
) {
  if (
    declared.firstLevel !== expected.firstLevel ||
    declared.levelCount !== expected.levelCount ||
    declared.pixelBytes !== expected.pixelBytes
  )
    throw new EngineError(
      'INVALID_CACHE',
      'A texture preview level geometry is not the one its dimensions imply',
      { entry, width, height, declared, expected },
    )
}

/** Refuses a pixel range that does not follow the previous entry's or runs past the column (`column` bytes). */
function checkPixelRange(
  entry: number,
  offset: number,
  consumed: number,
  pixelBytes: number,
  column: number,
) {
  if (offset !== consumed || offset + pixelBytes > column)
    throw new EngineError('INVALID_CACHE', 'A texture preview pixel range is not contiguous', {
      entry,
      offset,
      expected: consumed,
      bytes: pixelBytes,
      column,
    })
}

/** Refuses a block column that ends after the last entry's blocks. */
function checkBlockColumnsConsumed(
  blocksAt: Record<TextureBlockFormat, number>,
  previewBlocks: PreviewColumns['previewBlocks'],
) {
  for (const name of PREVIEW_BLOCK_FORMATS)
    if (blocksAt[name] !== previewBlocks[name].length)
      throw new EngineError('INVALID_CACHE', 'A texture preview block column is too long', {
        format: name,
        column: previewBlocks[name].length,
        expected: blocksAt[name],
      })
}

/** The block layout and block views of each format of the entry at `base`; `blocksAt` moves on past them. */
function readBlocks(
  entry: number,
  previewWords: Uint32Array,
  base: number,
  atlas: number,
  {
    previewBlocks,
    blocksAt,
    expected,
    texelBytes,
  }: {
    previewBlocks: PreviewColumns['previewBlocks']
    blocksAt: Record<TextureBlockFormat, number>
    expected: PreviewGeometry
    texelBytes: number
  },
) {
  const layouts = {} as TexturePreview['layouts'],
    blocks = {} as TexturePreview['blocks']
  PREVIEW_BLOCK_FORMATS.forEach((name, family) => {
    layouts[name] = layoutOf(entry, name, previewWords[base + PREVIEW_LAYOUTS + family])
    // A half-float chain is held by BC6H or kept in 32-bit floats alone, and those are its alone.
    if (
      (atlas === PREVIEW_ATLAS_HDR) !== (layouts[name] === 'hdr' || layouts[name] === 'float32') &&
      layouts[name] !== 'lossless'
    )
      throw new EngineError(
        'INVALID_CACHE',
        'A texture preview names a block layout its atlas cannot hold',
        {
          entry,
          format: name,
        },
      )
    if (layouts[name] === 'lossless') {
      blocks[name] = []
      return
    }
    const column = previewBlocks[name]
    const lengths = levelLengths(expected, texelBytes, previewLayoutBlockBytes(layouts[name]))
    if (blocksAt[name] + sum(lengths.blocks) > column.length)
      throw new EngineError('INVALID_CACHE', 'A texture preview block column is too short', {
        entry,
        format: name,
        column: column.length,
      })
    const sliced = slices(column, blocksAt[name], lengths.blocks)
    blocks[name] = sliced.views
    blocksAt[name] = sliced.end
  })
  return { layouts, blocks }
}

/**
 * Rebuilds the progressive level entries, checking every one before a byte of it is handed on: the
 * texture indices must climb, the source dimensions must be real, the declared level geometry must
 * be the one those dimensions imply, and the byte ranges must follow one another without a gap or
 * an overlap — so one entry can never be read as another's. The block columns write no range:
 * each kept entry's follows the previous one's at the length its dimensions imply, a lossless
 * entry has none, and a column that ends before or after the last entry is refused whole. A cache
 * whose pixel column lies in its own file declares its size (`externalPixelBytes`): the ranges are
 * checked against it, the levels are counted but hold no byte until `fillTexturePreviewLevels`.
 */
export function decodeTexturePreviews(columns: PreviewColumns): TexturePreview[] {
  const { count, previewWords, previewShaText, previewPixels, previewBlocks } = columns
  const external = columns.externalPixelBytes !== undefined
  if (external && previewPixels.length > 0)
    throw new EngineError(
      'INVALID_CACHE',
      'A texture preview pixel file leaves the sidecar column filled',
      { column: previewPixels.length },
    )
  const pixelColumn = columns.externalPixelBytes ?? previewPixels.length
  const previews: TexturePreview[] = new Array(count)
  let previous = -1,
    consumed = 0
  const blocksAt = Object.fromEntries(PREVIEW_BLOCK_FORMATS.map((name) => [name, 0])) as Record<
    TextureBlockFormat,
    number
  >
  for (let entry = 0; entry < count; entry++) {
    const base = entry * PREVIEW_WORDS
    const texture = previewWords[base + PREVIEW_TEXTURE]
    const width = previewWords[base + PREVIEW_WIDTH],
      height = previewWords[base + PREVIEW_HEIGHT]
    const atlas = previewWords[base + PREVIEW_ATLAS],
      bakedLevels = previewWords[base + PREVIEW_BAKED_LEVELS]
    const texelBytes = previewTexelBytes(atlas)
    const expected = previewGeometry(width, height, texelBytes)
    const header = { texture, atlas, width, height, bakedLevels }
    previous = checkEntryHeader(entry, header, previous, expected.firstLevel)
    const firstLevel = previewWords[base + PREVIEW_FIRST_LEVEL]
    const declared = {
      firstLevel,
      levelCount: previewWords[base + PREVIEW_LEVEL_COUNT],
      pixelBytes: previewWords[base + PREVIEW_PIXEL_BYTES],
    }
    const offset = previewWords[base + PREVIEW_PIXEL_OFFSET]
    checkLevelGeometry(entry, { width, height }, declared, expected)
    checkPixelRange(entry, offset, consumed, declared.pixelBytes, pixelColumn)
    const rgba = rgbaLengths({ atlas, width, height })
    const levels = external
      ? rgba.map(() => new Uint8Array(0))
      : slices(previewPixels, offset, rgba).views
    consumed = offset + sum(rgba)
    const { layouts, blocks } = readBlocks(entry, previewWords, base, atlas, {
      previewBlocks,
      blocksAt,
      expected,
      texelBytes,
    })
    const sourceKind = previewWords[base + PREVIEW_SOURCE_KIND]
    previews[entry] = {
      texture,
      image: previewWords[base + PREVIEW_IMAGE],
      width,
      height,
      sourceKind,
      sourceBufferView:
        sourceKind === PREVIEW_SOURCE_URI ? -1 : previewWords[base + PREVIEW_SOURCE_VIEW],
      sha256: previewShaText.substring(entry * 64, entry * 64 + 64),
      atlas,
      firstLevel,
      bakedLevels,
      levels,
      layouts,
      blocks,
    }
  }
  checkBlockColumnsConsumed(blocksAt, previewBlocks)
  if (external) checkFileLength(pixelColumn, consumed)
  return previews
}

/**
 * Gives `previews` — all of one cache, in entry order, decoded with `externalPixelBytes` — their RGBA8
 * levels, views of `pixels`, the file the pixel column lies in: each entry's follow the previous one's
 * at the lengths its dimensions imply, as `decodeTexturePreviews` checked them.
 */
export function fillTexturePreviewLevels(
  previews: readonly TexturePreview[],
  pixels: Uint8Array<ArrayBuffer>,
) {
  // The file's length is proved against every entry before any preview's levels is written.
  const lengths = previews.map(rgbaLengths)
  checkFileLength(pixels.length, sum(lengths.map(sum)))
  let at = 0
  previews.forEach((preview, rank) => {
    const sliced = slices(pixels, at, lengths[rank])
    sliced.views.forEach((view, level) => (preview.levels[level] = view))
    at = sliced.end
  })
}
