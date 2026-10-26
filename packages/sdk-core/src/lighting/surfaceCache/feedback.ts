import { ceilDiv, floorLog2, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { reversedMortonOffset } from '../../../../math/src/sequence/reversedMorton.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { SurfaceCacheSettings } from '../../contracts/surfaceCacheOptions.ts'
import { MAX_RES_LEVEL, MIN_RES_LEVEL, distanceBin, mipDesc } from './cardResolution.ts'
import { cardDistance } from './cardScene.ts'
import { mipOf, type Vec3 } from './cardTypes.ts'
import { isMapped, type SurfaceCache, type SurfaceRequest } from './state.ts'

/**
 * THE FEEDBACK of the rays that read the cards, as the CPU takes it: an image or two after the rays
 * made it, read back from the GPU.
 *
 * A ray that hits a card reads the finest page of it that is in the atlas. In one pixel of each tile
 * of the image (`feedbackTileSize`, the tile's place changing from image to image), it also writes
 * which page it would have read at the level its cone of rays calls for: the card, that level, the
 * page. The GPU lists each distinct page once, with the number of times it was written, at most
 * `feedbackUniqueElements` of them (the first the table of pages finds, not the most hit); the CPU
 * reads them here. A page that is in the atlas is kept in it: it
 * was read, its key in the eviction heap is the image. A page that is not is requested, if it was
 * hit often enough, behind the requests of the coarse mips: its distance, for the bin it falls in
 * (`distanceBin`), is 25 metres more than the card's, and up to 25 more the fewer hits it had.
 *
 * The buffer is a word that says how many elements follow it, in its first element's place, then the
 * elements, two words each:
 *
 * - the first: the card's index in the low 24 bits, the level asked for in the high 8;
 * - the second: the page's column in the low 8 bits, its row in the next 8, the number of hits in the
 *   high 16.
 */

/** The side of a tile of the image the feedback writes one element in: a power of two. */
export const feedbackTileSize = (settings: SurfaceCacheSettings) =>
  nextPow2(clamp(settings.surfaceCacheFeedbackTileSize, 1, 256))

/** The elements the compacted feedback holds at most: a power of two. */
export const feedbackUniqueElements = (settings: SurfaceCacheSettings) =>
  nextPow2(clamp(settings.surfaceCacheFeedbackUniqueElements, 1, 16384))

/** The elements the feedback of an image of `width` × `height` pixels holds before it is compacted:
 *  one for each tile. */
export const feedbackBufferSize = (width: number, height: number, tileSize: number) =>
  ceilDiv(width, tileSize) * ceilDiv(height, tileSize)

/**
 * The place in a tile of `tileSize` pixels a feedback element is written at in the image `frame`: the
 * image's number in the tile's square of positions, its bits reversed — so that consecutive images
 * cover the tile evenly — and unfolded along a Morton curve into a column and a row.
 */
export function feedbackTileJitter(frame: number, tileSize: number): [number, number] {
  const place = reversedMortonOffset(frame, tileSize)
  return [place & (tileSize - 1), place >>> floorLog2(tileSize)]
}

/** The feedback of an image, read back. */
export interface Feedback {
  /** The buffer: the count, then the elements, two words each. */
  readonly words: Uint32Array
  /** The elements the buffer was made for, the count's place included. */
  readonly capacity: number
  /** The elements the image's feedback held before it was compacted (`feedbackBufferSize`). */
  readonly bufferSize: number
}

/** The distance of the nearest eye from the box of the card `card`. */
function nearestEye(cache: SurfaceCache, card: number, origins: readonly Vec3[]) {
  const box = cache.cards.at(card)
  let nearest = Infinity
  for (const [x, y, z] of origins) nearest = Math.min(nearest, cardDistance(box, x, y, z))
  return nearest
}

/**
 * Takes the feedback into the cache: a page that is in the atlas and unlocked is read, at this
 * feedback frame; the others are requests, added to `requests` and counted into `histogram` (one
 * count for each of the bins of the distance).
 */
export function feedbackRequests(
  cache: SurfaceCache,
  feedback: Feedback,
  origins: readonly Vec3[],
  requests: SurfaceRequest[],
  histogram: Int32Array,
) {
  cache.stats.hiResPagesToAdd = 0
  const { words, capacity, bufferSize } = feedback
  const count = Math.min(words[0], capacity - 1)
  for (let at = 0; at < count; at++) {
    const first = words[(at + 1) * 2],
      second = words[(at + 1) * 2 + 1]
    const hits = second >>> 16
    const cardIndex = first & 0xffffff
    if (!(hits > cache.settings.surfaceCacheFeedbackMinPageHits) || !cache.cards.has(cardIndex))
      continue
    const resLevel = clamp(first >>> 24, MIN_RES_LEVEL, MAX_RES_LEVEL)
    const card = cache.cards.at(cardIndex)
    const desc = mipDesc(resLevel, card.resBiasX, card.resBiasY)
    const column = clamp(second & 0xff, 0, desc.sizeInPagesX - 1)
    const row = clamp((second >>> 8) & 0xff, 0, desc.sizeInPagesY - 1)
    const localPage = column + row * desc.sizeInPagesX
    const mip = mipOf(card, resLevel)
    const pageIndex = mip.spanSize > 0 ? mip.spanOffset + localPage : -1
    if (pageIndex >= 0 && isMapped(cache.pages.at(pageIndex))) {
      if (!mip.locked) cache.unlocked.update(cache.feedbackFrame, pageIndex)
      continue
    }
    // A page asked for is served after the coarse mips, the sooner the more it was hit.
    const distance = nearestEye(cache, cardIndex, origins) + 2500 + 2500 * (1 - hits / bufferSize)
    const bin = distanceBin(distance)
    histogram[bin]++
    requests.push({ card: cardIndex, resLevel, localPage, bin })
    cache.stats.hiResPagesToAdd++
  }
}
