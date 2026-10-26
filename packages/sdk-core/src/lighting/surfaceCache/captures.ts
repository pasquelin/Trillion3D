import { createMarkedList } from '../../../../math/src/sequence/markedList.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { SurfaceCacheSettings } from '../../contracts/surfaceCacheOptions.ts'
import { MIN_RES_LEVEL, PAGE_SIZE } from './cardResolution.ts'
import { cardIsAllocated, cardMipDesc, mipOf, type Card } from './cardTypes.ts'
import { feedbackTileSize } from './feedback.ts'
import { captureAtlasPages, createPageAllocator, type PageAllocator } from './pageAllocator.ts'
import {
  isLockedMip,
  isMapped,
  type IndexList,
  type SurfaceCache,
  type SurfaceRequest,
} from './state.ts'
import {
  evictOldest,
  freeVirtualSurface,
  mapPage,
  reallocVirtualSurface,
  updateMipHierarchy,
} from './virtualSurface.ts'

/**
 * THE CAPTURES: what the surface cache makes of the requests an image serves — which pages are
 * mapped in the atlas, which are drawn, in what order the room is made.
 *
 * A request for the coarsest mip of a card is served first, in the order of the requests: the room
 * for all its pages is made — by letting pages of the finer mips that were not read for two
 * feedback frames leave —, and where there is none the level is lowered until there is; the old
 * coarsest mip and the levels under the new one are freed; the new mip is made, locked, and every
 * page of it is mapped and queued for a capture. A request for one finer page waits until the
 * coarse ones are served, then is served the same way, a page at a time, in the room it can make by
 * letting pages leave that no feedback read for as many frames as a tile of the feedback has pixels.
 * The pages are drawn in a CAPTURE ATLAS smaller than the atlas, so what an image can capture is
 * bounded by its size as well as by the budget of pages.
 *
 * Then the pages that changed (`recapture`, asked by a change of the materials) and the oldest
 * captured (a share of the budget, `surfaceCacheCardCaptureRefreshFraction`) are captured again, in
 * what room the image has left; and the pages no feedback read for `surfaceCacheNumFramesToKeepUnusedPages`
 * leave the atlas. The cards whose pages came or went have their mips tidied (`updateMipHierarchy`).
 */

/** A rectangle of texels. */
export interface AtlasRect {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/** A page to capture, or to copy from another card's capture. */
export interface CapturePage {
  /** The card and the page of the page table. */
  readonly card: number
  readonly page: number
  /** The placement the card belongs to. */
  readonly placement: number
  /** Where in the capture atlas it is drawn, and where in the atlas it goes. */
  readonly captureRect: AtlasRect
  readonly atlasRect: AtlasRect
  /** The part of the card it covers, in the card's UV: `x0, y0, x1, y1`. */
  readonly uv: readonly [number, number, number, number]
  /** Whether the light the page's card held is carried into the page's texels: the card had pages before
   *  the image. */
  readonly resampleLighting: boolean
  /** Whether the copy is mirrored. */
  readonly axisXFlipped: boolean
  /** The card whose texels it takes instead of being drawn, -1 if it is drawn. */
  readonly copyCard: number
  /** Whether it is the periodic refresh of a page the cache already holds, which follows what the
   *  materials change: it rewrites the page's surface and carries the light the page holds, so it asks
   *  nothing of the lighting. */
  readonly refresh: boolean
}

/** What an image captures. */
export interface CaptureWork {
  readonly pages: CapturePage[]
  /** The texels of the pages in the atlas. */
  texels: number
  /** Whether any page copies a card. */
  hasCardCopy: boolean
  /** Whether the atlas was remade or emptied: its textures start again. */
  reset: boolean
}

/** A finer page asked for, kept until the coarse mips are served. */
interface FinePage {
  readonly card: number
  readonly resLevel: number
  readonly localPage: number
}

/** What serving the requests of an image works with. */
interface Capturing {
  readonly cache: SurfaceCache
  readonly work: CaptureWork
  /** The capture atlas, and its side in pages. */
  readonly space: PageAllocator
  readonly spacePages: number
  /** The cards whose pages came or went. */
  readonly dirty: IndexList
  readonly ready: (placement: number) => boolean
}

/** The share of an image's captures that may capture pages again, from 0 to 1. */
const refreshFraction = (settings: SurfaceCacheSettings) =>
  clamp(settings.surfaceCacheCardCaptureRefreshFraction, 0, 1)

/** The texels of the capture atlas that may recapture pages in an image: a share of the atlas, at
 *  least a page. */
function refreshTexels(settings: SurfaceCacheSettings, spacePages: number) {
  const fraction = refreshFraction(settings)
  if (!(fraction > 0)) return 0
  const side = spacePages * PAGE_SIZE
  return Math.trunc(Math.max(side * side * fraction, PAGE_SIZE * PAGE_SIZE))
}

/** The pages that may be recaptured in an image: a share of the budget, at least one. */
function refreshPageCount(settings: SurfaceCacheSettings, budget: number) {
  const fraction = refreshFraction(settings)
  return fraction > 0 ? Math.trunc(clamp(budget * fraction, 1, budget)) : 0
}

/** Queues the mapped page `pageIndex` of the card `cardIndex` for a capture: it takes a place in the
 *  capture atlas and counts as captured at this frame; `refresh` marks the periodic refresh of a page
 *  that holds its light (`CapturePage.refresh`). Whether it was queued: the capture atlas may have no
 *  room. */
function queuePage(
  c: Capturing,
  cardIndex: number,
  pageIndex: number,
  resample: boolean,
  axisXFlipped = false,
  copyCard = -1,
  refresh = false,
) {
  const { cache, work } = c
  const page = cache.pages.at(pageIndex)
  const place = c.space.allocate(page.subWidth, page.subHeight)
  if (!place) return false
  work.pages.push({
    card: cardIndex,
    page: pageIndex,
    placement: cache.meshCards.at(cache.cards.at(cardIndex).meshCards).placement,
    captureRect: place,
    atlasRect: { minX: page.minX, minY: page.minY, maxX: page.maxX, maxY: page.maxY },
    uv: [page.uvX0, page.uvY0, page.uvX1, page.uvY1],
    resampleLighting: resample,
    axisXFlipped,
    copyCard,
    refresh,
  })
  cache.captured.update(cache.frame, pageIndex)
  work.texels += (page.maxX - page.minX) * (page.maxY - page.minY)
  return true
}

/** Whether the atlas has room for the mip of `card` at `level`, or for one page of it. */
const hasRoom = (c: Capturing, card: Card, level: number, singlePage: boolean) =>
  c.cache.allocator.isSpaceAvailable(cardMipDesc(card, level), singlePage)

/** The level the coarsest mip of `card` can be made at: `level` if the atlas has room, or can be
 *  given it by pages leaving; else the highest below it that fits; -1 if none does, or if the capture
 *  atlas lacks the room. */
function levelThatFits(c: Capturing, card: Card, level: number) {
  let fits = true
  while (!hasRoom(c, card, level, false)) {
    if (!evictOldest(c.cache, 2, c.dirty)) {
      fits = false
      break
    }
  }
  while (!fits && level > MIN_RES_LEVEL) {
    level--
    fits = hasRoom(c, card, level, false)
  }
  return fits && c.space.isSpaceAvailable(cardMipDesc(card, level), false) ? level : -1
}

/** Makes the coarsest mip of the card `cardIndex` at `level`, as `request` asked, and queues all its
 *  pages: copied from the card's own finer pages when it lowers its level, else from a card of its
 *  kind that has the texels, else drawn. */
function makeCoarsestMip(c: Capturing, request: SurfaceRequest, level: number) {
  const { cache } = c
  const card = cache.cards.at(request.card)
  card.visible = true
  card.desiredOnLastAlloc = request.resLevel
  const resample = cardIsAllocated(card)
  const fromSelf = cache.allowDownsampleFromSelf && resample && level <= card.minResLevel
  freeVirtualSurface(cache, card, card.minResLevel, card.minResLevel)
  freeVirtualSurface(cache, card, card.minResLevel, level - 1)
  reallocVirtualSurface(cache, card, request.card, level, true)
  let copyCard = -1,
    flipped = false
  if (fromSelf) copyCard = request.card
  else if (cache.allowCardSharing) {
    const match = cache.sharing.find(card.sharingId, card.minResLevel)
    if (match) {
      copyCard = match.card
      flipped = card.axisXFlipped !== match.axisXFlipped
    }
  }
  const mip = mipOf(card, card.minResLevel)
  for (let local = 0; local < mip.sizeX * mip.sizeY; local++) {
    const index = mip.spanOffset + local
    if (isMapped(cache.pages.at(index))) continue
    mapPage(cache, mip, index)
    if (!isMapped(cache.pages.at(index))) continue
    queuePage(c, request.card, index, resample, flipped, copyCard)
    if (copyCard >= 0) c.work.hasCardCopy = true
  }
  c.dirty.add(request.card)
}

/** Serves a request for the coarsest mip of a card. */
function serveCoarse(c: Capturing, request: SurfaceRequest) {
  const card = c.cache.cards.at(request.card)
  const level = levelThatFits(c, card, request.resLevel)
  const placement = c.cache.meshCards.at(card.meshCards).placement
  if (level >= 0 && c.ready(placement)) makeCoarsestMip(c, request, level)
}

/** Serves a request for one finer page: the room for it, the page mapped and queued. */
function serveFine(c: Capturing, fine: FinePage) {
  const { cache } = c
  const card = cache.cards.at(fine.card)
  if (!(fine.resLevel > card.minResLevel)) return
  let fits = true
  const keep = feedbackTileSize(cache.settings) ** 2
  while (!hasRoom(c, card, fine.resLevel, true)) {
    if (!evictOldest(cache, keep, c.dirty)) {
      fits = false
      break
    }
  }
  if (!c.space.isSpaceAvailable(cardMipDesc(card, fine.resLevel), true)) fits = false
  if (!fits || !c.ready(cache.meshCards.at(card.meshCards).placement)) return
  const resample = cardIsAllocated(card)
  reallocVirtualSurface(cache, card, fine.card, fine.resLevel, false)
  const mip = mipOf(card, fine.resLevel)
  const index = mip.spanOffset + fine.localPage
  if (isMapped(cache.pages.at(index))) return
  mapPage(cache, mip, index)
  if (!isMapped(cache.pages.at(index))) return
  queuePage(c, fine.card, index, resample)
  c.dirty.add(fine.card)
}

/** Queues the mapped page `pageIndex` for a capture again, with the light it held resampled, if
 *  the capture atlas has room for it; whether it did. `refresh` says it is the periodic refresh
 *  (`refreshOldest`), which never takes a page still pending. */
function recapturePage(c: Capturing, pageIndex: number, refresh = false) {
  const page = c.cache.pages.at(pageIndex)
  const card = c.cache.cards.at(page.card)
  return (
    c.space.isSpaceAvailable(cardMipDesc(card, page.resLevel), true) &&
    queuePage(c, page.card, pageIndex, true, false, -1, refresh)
  )
}

/** Captures again the pages a change of a material asked for, the oldest request first. */
function recaptureInvalidated(c: Capturing) {
  const { recapture } = c.cache
  if (!c.cache.settings.surfaceCacheCardCaptureEnableInvalidation) recapture.clear()
  while (recapture.size > 0) {
    if (!recapturePage(c, recapture.top())) break
    recapture.pop()
  }
}

/** Captures again the pages captured longest ago, as many as a share of the budget and of the
 *  capture atlas allow, to follow what the materials change. */
function refreshOldest(c: Capturing, budget: number) {
  const { cache, work } = c
  let texelsLeft = refreshTexels(cache.settings, c.spacePages)
  let pagesLeft = Math.min(refreshPageCount(cache.settings, budget), budget - work.pages.length)
  while (cache.captured.size > 0) {
    const index = cache.captured.top()
    if (cache.frame - cache.captured.keyOf(index) <= 0) break
    const page = cache.pages.at(index)
    // A page whose capture is still on its way back holds no light to refresh yet; capturing it
    // again would stamp it anew, so the capture on its way could never confirm it.
    if (page.pending) break
    if (isMapped(page)) {
      const desc = cardMipDesc(cache.cards.at(page.card), page.resLevel)
      texelsLeft -= desc.pageResolutionX * desc.pageResolutionY
      pagesLeft -= 1
    }
    if (texelsLeft < 0 || pagesLeft < 0 || !recapturePage(c, index, true)) break
  }
}

/**
 * Serves `requests` (`planRequests`), at most `budget` pages queued in all, then the recaptures and
 * the evictions; returns what the image captures. `ready(placement)` says whether a placement's
 * mesh can be drawn yet: one that cannot waits.
 */
export function processRequests(
  cache: SurfaceCache,
  requests: readonly SurfaceRequest[],
  budget: number,
  ready: (placement: number) => boolean = () => true,
): CaptureWork {
  const spacePages = captureAtlasPages(cache.settings, cache.atlasPages)
  const c: Capturing = {
    cache,
    work: { pages: [], texels: 0, hasCardCopy: false, reset: false },
    space: createPageAllocator(spacePages, spacePages),
    spacePages,
    dirty: createMarkedList(),
    ready,
  }
  const fine: FinePage[] = []
  for (const request of requests) {
    if (isLockedMip(request)) serveCoarse(c, request)
    else if (cache.cards.has(request.card)) {
      const card = cache.cards.at(request.card)
      if (card.visible && request.resLevel > card.minResLevel)
        fine.push({ card: request.card, resLevel: request.resLevel, localPage: request.localPage })
    }
    if (c.work.pages.length + fine.length >= budget) break
  }
  for (const page of fine) serveFine(c, page)
  // The copies read the atlas as it was before this image: the sharing is told only now.
  cache.sharing.flush(cache.cards)
  recaptureInvalidated(c)
  refreshOldest(c, budget)
  const keep = Math.max(cache.settings.surfaceCacheNumFramesToKeepUnusedPages, 0)
  while (evictOldest(cache, keep, c.dirty)) continue
  for (let at = 0; at < c.dirty.count; at++) {
    const index = c.dirty.list[at]
    updateMipHierarchy(cache, cache.cards.at(index))
    cache.changes.cards.add(index)
  }
  return c.work
}
