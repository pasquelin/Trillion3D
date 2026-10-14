import { EngineError } from '../contracts/cache.ts'
import type { TexturePreview } from '../texture/previewContracts.ts'
import {
  PREVIEW_LAYOUT_NAMES,
  PREVIEW_BLOCK_FORMATS,
  PREVIEW_WORDS,
  PREVIEW_TEXTURE,
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  PREVIEW_ATLAS,
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
  type TextureBlockFormat,
} from '../texture/previewFormat.ts'
import { previewGeometry } from '../texture/previewLevels.ts'
import { checkEntryHeader, levelLengths } from './binaryPreviewEntry.ts'

type PreviewColumns = {
  count: number
  previewWords: Uint32Array
  previewShaText: string
  previewPixels: Uint8Array<ArrayBuffer>
  /** The block-compressed tails, one column per format, entries contiguous in order. */
  previewBlocks: Record<TextureBlockFormat, Uint8Array<ArrayBuffer>>
}

/** The layout a family's word names, or a refusal of a word no layout owns. */
function layoutOf(entry: number, name: TextureBlockFormat, word: number) {
  const layout = PREVIEW_LAYOUT_NAMES[word]
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

/**
 * Rebuilds the progressive level entries, checking every one before a byte of it is handed on: the
 * texture indices must climb, the source dimensions must be real, the declared level geometry must
 * be the one those dimensions imply, and the byte ranges must follow one another without a gap or
 * an overlap — so one entry can never be read as another's. The block columns write no range:
 * each kept entry's follows the previous one's at the length its dimensions imply, a lossless
 * entry has none, and a column that ends before or after the last entry is refused whole.
 */
export function decodeTexturePreviews(columns: PreviewColumns): TexturePreview[] {
  const { count, previewWords, previewShaText, previewPixels, previewBlocks } = columns
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
    const expected = previewGeometry(width, height)
    const header = { texture, atlas, width, height, bakedLevels }
    previous = checkEntryHeader(entry, header, previous, expected.firstLevel)
    const firstLevel = previewWords[base + PREVIEW_FIRST_LEVEL]
    const declared = {
      firstLevel,
      levelCount: previewWords[base + PREVIEW_LEVEL_COUNT],
      pixelBytes: previewWords[base + PREVIEW_PIXEL_BYTES],
    }
    const offset = previewWords[base + PREVIEW_PIXEL_OFFSET]
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
    if (offset !== consumed || offset + declared.pixelBytes > previewPixels.length)
      throw new EngineError('INVALID_CACHE', 'A texture preview pixel range is not contiguous', {
        entry,
        offset,
        expected: consumed,
        bytes: declared.pixelBytes,
        column: previewPixels.length,
      })
    const lengths = levelLengths(expected)
    const pixels = slices(previewPixels, offset, lengths.rgba)
    consumed = pixels.end
    const layouts = {} as TexturePreview['layouts'],
      blocks = {} as TexturePreview['blocks']
    PREVIEW_BLOCK_FORMATS.forEach((name, family) => {
      layouts[name] = layoutOf(entry, name, previewWords[base + PREVIEW_LAYOUTS + family])
      if (layouts[name] === 'lossless') {
        blocks[name] = []
        return
      }
      const column = previewBlocks[name]
      if (blocksAt[name] + expected.blockBytes > column.length)
        throw new EngineError('INVALID_CACHE', 'A texture preview block column is too short', {
          entry,
          format: name,
          column: column.length,
        })
      const sliced = slices(column, blocksAt[name], lengths.blocks)
      blocks[name] = sliced.views
      blocksAt[name] = sliced.end
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
      levels: pixels.views,
      layouts,
      blocks,
    }
  }
  for (const name of PREVIEW_BLOCK_FORMATS)
    if (blocksAt[name] !== previewBlocks[name].length)
      throw new EngineError('INVALID_CACHE', 'A texture preview block column is too long', {
        format: name,
        column: previewBlocks[name].length,
        expected: blocksAt[name],
      })
  return previews
}
