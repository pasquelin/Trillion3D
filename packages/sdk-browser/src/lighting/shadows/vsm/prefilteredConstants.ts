/**
 * THE PREFILTERED DISTANT SHADOW'S CONSTANTS (`shadowPrefilteredDistant`), none in `VSM_CONSTANTS_WGSL`
 * (`constants.ts`): a set without the feature compiles the text it always did. The filters
 * (`filterableWgsl.ts`) and the projection read them, through their text (`prefilteredWgsl.ts`); this module holds
 * the numbers and the sizes derived from them (the pools' page bytes, the history's layout and header), which the memory budget the
 * core splits reads the pools' sizes from (`layoutBytes.ts`).
 *
 * A filtered pool holds a byte a texel, a page `VSM_FILTERABLE_PAGE_BYTES` bytes (its border the first
 * and last row and column, its inner texel (x, y) at (x + 1, y + 1)). The `temp` pool of the separable
 * passes shares the merged pool's buffer: a page's 128 x 128 bytes first, the merge down starting from a
 * cleared buffer. The frame clears the pools it writes (`resetVsmFilterable`), so a byte is stored once, by `or`.
 */
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import {
  VSM_PAGE_FINE,
  VSM_PAGE_TABLE_BLOCK_HEIGHT,
  VSM_PAGE_TEXELS,
  VSM_PROJECTION_RECORD_BYTES,
} from './constants.ts'
import { VSM_TABLES_PER_ROW, type VsmLayout } from './layout.ts'

// ---- Page bits -----------------------------------------------------------------------------------
/** A page the view asked: a pixel's, a froxel's or a coarse page (`vsmRequestPage`). */
export const VSM_PAGE_PRIMARY = 1 << 16
/** A page a finer level's page falls back on, asked for the filter (`PropagateFilterableRequests`). */
export const VSM_PAGE_SECONDARY = 1 << 17
/** The bits of a request a page holds and is compared in: a different one draws the page again whole. */
export const VSM_PAGE_AUX_MASK = VSM_PAGE_FINE | VSM_PAGE_PRIMARY | VSM_PAGE_SECONDARY
/** The page table entry's secondary request bit. */
export const VSM_ENTRY_SECONDARY_BIT = 0x20000000

// ---- The projection record -----------------------------------------------------------------------
/** A clipmap level of a sun whose clipmap holds a prefiltered distant shadow: in its record's flags. */
export const VSM_MAP_PREFILTERED_DISTANT = 1 << 6
/** The level's index in its clipmap, in the flags' bits 8 to 15, set with the flag above. */
export const VSM_MAP_LEVEL_INDEX_SHIFT = 8
export const VSM_MAP_LEVEL_INDEX_MASK = 0xff

// ---- The filtered pools --------------------------------------------------------------------------
/** The border of a filtered page, the texels a bilinear read of its edge takes from the next page. */
export const VSM_FILTERABLE_BORDER = 1
/** A filtered page's side, its border included: 130 texels. */
export const VSM_FILTERABLE_PAGE_SIZE = VSM_PAGE_TEXELS + 2 * VSM_FILTERABLE_BORDER
/** A filtered page's bytes: a byte a texel. */
export const VSM_FILTERABLE_PAGE_BYTES = VSM_FILTERABLE_PAGE_SIZE * VSM_FILTERABLE_PAGE_SIZE

// ---- The filters' arguments and page lists -------------------------------------------------------
/** The indirect dispatch sets of 4 words, by index: (128, pages, 1) the separable passes, (16, pages, 1)
 *  the merge down, (pages, 1, 1) the borders. */
export const VSM_FILTER_ARGS_SEPARABLE = 0
export const VSM_FILTER_ARGS_MERGE = 1
export const VSM_FILTER_ARGS_BORDER = 2
export const VSM_FILTER_ARGS_SET_WORDS = 4
/** The sets in their empty form: a group per row of a page, 16 tiles a page, a group a page. */
const VSM_FILTER_TILES_PER_PAGE = 16
export const VSM_FILTER_ARGS_INIT: readonly number[] = [
  ...[VSM_PAGE_TEXELS, 0, 1, 0],
  ...[VSM_FILTER_TILES_PER_PAGE, 0, 1, 0],
  ...[0, 1, 1, 0],
]
export const VSM_FILTER_ARGS_WORDS = VSM_FILTER_ARGS_INIT.length
/** The lists of `vsm.poolPages` words the pages selected go in: for the separable passes and the
 *  borders, and for the merge down. */
export const VSM_FILTER_LIST_SEPARABLE = 0
export const VSM_FILTER_LIST_FILTERABLE = 1
export const VSM_FILTER_LISTS = 2

// ---- The history ---------------------------------------------------------------------------------
/** The history's header: the words of its regions, then the blend and the id of the first sun map. */
const VSM_HISTORY_HEADER_WORDS = 6
export const VSM_HISTORY_RECORDS_WORD = 0
export const VSM_HISTORY_TABLE_WORD = 1
export const VSM_HISTORY_COVER_WORD = 2
export const VSM_HISTORY_IDS_WORD = 3
export const VSM_HISTORY_BLEND_WORD = 4
export const VSM_HISTORY_SUN_WORD = 5

/** Where the history's regions lie, in words of its buffer, for a set of `layout`: the previous map id
 *  + 1 of each current id of the suns, counted from the first sun map's (0 for none), beside the
 *  header, as the plan writes them, then what the frame end copies — the previous frame's projection
 *  records of the suns' maps, from the first sun map's, the rows of its page table that hold their
 *  blocks and its receiver cover's level 0. A sun map's place in the history is its id less the first
 *  sun map's (`VsmMapIds.sunBase`), the current frame's in the ids, the previous frame's in the
 *  records. */
interface VsmHistoryLayout {
  idsWord: number
  idWords: number
  recordsWord: number
  recordWords: number
  tableWord: number
  tableWords: number
  coverWord: number
  coverWords: number
  words: number
}

export function vsmHistoryLayout(layout: VsmLayout): VsmHistoryLayout {
  const idsWord = VSM_HISTORY_HEADER_WORDS
  const idWords = layout.sunMapSlots
  const recordsWord = idsWord + idWords
  const recordWords = (layout.sunMapSlots * VSM_PROJECTION_RECORD_BYTES) / 4
  const tableWord = recordsWord + recordWords
  const tableWords =
    ceilDiv(layout.sunMapSlots, VSM_TABLES_PER_ROW) *
    VSM_PAGE_TABLE_BLOCK_HEIGHT *
    layout.pageTableSize[0]
  const coverWord = tableWord + tableWords
  const coverWords = layout.coverSize[0] * layout.coverSize[1]
  return {
    ...{ idsWord, idWords, recordsWord, recordWords },
    ...{ tableWord, tableWords, coverWord, coverWords },
    words: coverWord + coverWords,
  }
}

/** The history's header for `history`: the offsets of its regions and the blend, `blendBits` the
 *  f32 bits of the share of the previous frame the filter keeps (0 for none), the first sun map's id 0. */
export function vsmHistoryHeader(history: VsmHistoryLayout, blendBits: number) {
  const header = new Uint32Array(VSM_HISTORY_HEADER_WORDS)
  header[VSM_HISTORY_RECORDS_WORD] = history.recordsWord
  header[VSM_HISTORY_TABLE_WORD] = history.tableWord
  header[VSM_HISTORY_COVER_WORD] = history.coverWord
  header[VSM_HISTORY_IDS_WORD] = history.idsWord
  header[VSM_HISTORY_BLEND_WORD] = blendBits
  return header
}

/** The bytes of a filtered pool of `layout`: a page of `VSM_FILTERABLE_PAGE_BYTES` for each pool page. */
export const vsmFilterablePoolBytes = (layout: Pick<VsmLayout, 'poolPages'>) =>
  layout.poolPages * VSM_FILTERABLE_PAGE_BYTES
