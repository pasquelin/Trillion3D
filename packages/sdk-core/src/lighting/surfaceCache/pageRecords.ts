import { CARD_TILE_SIZE, PAGE_SIZE } from './cardResolution.ts'
import type { CardWords } from './cardRecords.ts'
import { mipOf, type Card } from './cardTypes.ts'
import { isMapped, isSubAllocation, type Page } from './state.ts'

/**
 * THE RECORDS THE GPU READS of the pages: for each page of the page table two words of what a read
 * of it should find, and for each mapped page a record the passes that capture and light the page
 * work from.
 */

/** The words of a page's entry in the page table a read walks. */
export const PAGE_TABLE_WORDS = 2
/** The words of a page's record. */
export const CARD_PAGE_WORDS = 20

/**
 * Writes the entry of `page` at word `at` of `words`, `PAGE_TABLE_WORDS` words, zero for a page not
 * there. In order:
 *
 * - the position of the rectangle the page reads in the atlas, in units of 8 texels, along X (bits
 *   0-11) and Y (12-23), and the level of each axis of the mip it belongs to along X (24-27) and Y
 *   (28-31);
 * - the page it reads: itself, or the next coarser one that is in the atlas.
 */
export function writePageTableWords(words: Uint32Array, at: number, page: Page | undefined) {
  words[at] = page
    ? (page.sampleBiasX & 0xfff) |
      ((page.sampleBiasY & 0xfff) << 12) |
      ((page.sampleResLevelX & 0xf) << 24) |
      ((page.sampleResLevelY & 0xf) << 28)
    : 0
  words[at + 1] = page ? page.samplePage : 0
}

/**
 * Writes the record of `page` at word `at` of `words`, `CARD_PAGE_WORDS` words, for the atlas of
 * `atlasSide` texels a side; a page that is not mapped, or not there, or mapped for a capture not made
 * yet (`Page.pending`), has a record with the card index all ones and the rest zero. In order:
 *
 * - 0 the card's index, 1 the index of the first page of the page's mip, 2 and 3 the size of the
 *   page's rectangle in the atlas, in texels;
 * - 4..7 the part of the card it covers, in the card's UV (`x0, y0, x1, y1`);
 * - 8..11 the rectangle in the atlas, in its UV (`x0, y0, x1, y1`);
 * - 12 and 13 the card's UV a texel spans, along X and Y; 14 and 15 the tiles of 8 texels the page's
 *   mip spans along X and Y (a part of a page: the part's);
 * - 16..19 zero, for the lighting's own state.
 */
export function writeCardPageWords(
  words: CardWords,
  at: number,
  page: Page | undefined,
  card: Card | undefined,
  atlasSide: number,
) {
  const { f32, u32 } = words
  u32.fill(0, at, at + CARD_PAGE_WORDS)
  if (!page || !card || !isMapped(page) || page.pending) {
    u32[at] = 0xffffffff
    return
  }
  const mip = mipOf(card, page.resLevel)
  const width = page.maxX - page.minX,
    height = page.maxY - page.minY
  u32[at] = page.card
  u32[at + 1] = mip.spanOffset
  f32[at + 2] = width
  f32[at + 3] = height
  f32[at + 4] = page.uvX0
  f32[at + 5] = page.uvY0
  f32[at + 6] = page.uvX1
  f32[at + 7] = page.uvY1
  f32[at + 8] = page.minX / atlasSide
  f32[at + 9] = page.minY / atlasSide
  f32[at + 10] = page.maxX / atlasSide
  f32[at + 11] = page.maxY / atlasSide
  f32[at + 12] = width > 0 ? (page.uvX1 - page.uvX0) / width : 0
  f32[at + 13] = height > 0 ? (page.uvY1 - page.uvY0) / height : 0
  const tiles = PAGE_SIZE / CARD_TILE_SIZE
  u32[at + 14] = isSubAllocation(page) ? page.subWidth / CARD_TILE_SIZE : mip.sizeX * tiles
  u32[at + 15] = isSubAllocation(page) ? page.subHeight / CARD_TILE_SIZE : mip.sizeY * tiles
}
