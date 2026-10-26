import {
  MIN_CARD_RESOLUTION,
  PAGE_SIZE,
  VIRTUAL_PAGE_SIZE,
  type MipDesc,
} from './cardResolution.ts'
import {
  cardIsAllocated,
  cardMipDesc,
  mipOf,
  setDesiredLevel,
  updateLevelRange,
  type Card,
  type SurfaceMip,
} from './cardTypes.ts'
import type { Allocation } from './pageAllocator.ts'
import { isMapped, newPage, type IndexList, type Page, type SurfaceCache } from './state.ts'

/**
 * THE VIRTUAL SURFACE OF A CARD: the pages of its mips in the page table, and which of them hold a
 * physical page of the atlas.
 *
 * A card keeps the pages of the mips it is asked for. The COARSEST mip is LOCKED: all its pages are
 * mapped when it is made, and stay mapped as long as the card is wanted. The finer mips are
 * UNLOCKED, made a page at a time as the rays report they would read it, and leave the atlas
 * oldest-read first when the atlas needs room or when they were not read for long. A page that is not
 * mapped reads the next coarser mip's page (`updateMipHierarchy`).
 */

/** The page table index of the `local`-th page of `mip`. */
const pageOf = (mip: SurfaceMip, local: number) => mip.spanOffset + local

/** A page of the mip described by `desc`, the `local`-th: its UV rectangle is its share of the
 *  card, widened by half a texel on each side it shares with a neighbour, so that a filtered read
 *  at its edge never leaves it. */
function virtualPage(cardIndex: number, resLevel: number, desc: MipDesc, local: number) {
  const page = newPage()
  page.card = cardIndex
  page.resLevel = resLevel
  if (desc.subAllocation) {
    page.subWidth = desc.resolutionX
    page.subHeight = desc.resolutionY
  }
  const across = desc.sizeInPagesX,
    down = desc.sizeInPagesY
  const column = local % across,
    row = Math.trunc(local / across)
  page.uvX0 = column / across
  page.uvY0 = row / down
  page.uvX1 = (column + 1) / across
  page.uvY1 = (row + 1) / down
  const half = 0.5 * (PAGE_SIZE - VIRTUAL_PAGE_SIZE)
  const borderX = (half * (page.uvX1 - page.uvX0)) / PAGE_SIZE
  const borderY = (half * (page.uvY1 - page.uvY0)) / PAGE_SIZE
  if (column > 0) page.uvX0 -= borderX
  if (row > 0) page.uvY0 -= borderY
  if (column < across - 1) page.uvX1 += borderX
  if (row < down - 1) page.uvY1 += borderY
  return page
}

/** The place of a mapped page in the atlas, as the allocator knows it. */
const placeOf = (page: Page): Allocation => ({
  pageX: page.physX,
  pageY: page.physY,
  minX: page.minX,
  minY: page.minY,
  maxX: page.maxX,
  maxY: page.maxY,
})

/** Makes the pages of the mip of `card` at `resLevel`, none mapped. */
function makeMip(
  cache: SurfaceCache,
  card: Card,
  cardIndex: number,
  resLevel: number,
  mip: SurfaceMip,
  locked: boolean,
) {
  const desc = cardMipDesc(card, resLevel)
  mip.locked = locked
  mip.sizeX = desc.sizeInPagesX
  mip.sizeY = desc.sizeInPagesY
  mip.resLevelX = desc.resLevelX
  mip.resLevelY = desc.resLevelY
  mip.spanSize = desc.sizeInPagesX * desc.sizeInPagesY
  mip.spanOffset = cache.pages.addSpan(mip.spanSize, (local) =>
    virtualPage(cardIndex, resLevel, desc, local),
  )
  for (let local = 0; local < mip.spanSize; local++) cache.changes.pages.add(pageOf(mip, local))
  updateLevelRange(card)
  cache.changes.cards.add(cardIndex)
}

/** Locks the mapped pages of `mip`, or unlocks them: a locked page is never chosen to leave. */
function relock(cache: SurfaceCache, mip: SurfaceMip, lock: boolean) {
  for (let local = 0; local < mip.sizeX * mip.sizeY; local++) {
    const index = pageOf(mip, local)
    if (!isMapped(cache.pages.at(index))) continue
    if (lock) cache.unlocked.remove(index)
    else cache.unlocked.add(cache.feedbackFrame, index)
  }
  mip.locked = lock
}

/**
 * Makes the mip of `card` (the card `cardIndex`) at `resLevel`, locked or not: its pages in the
 * page table, none mapped. A mip made already is only locked or unlocked, as asked. A locked mip
 * is also told to the sharing, as the coarsest the card now has.
 */
export function reallocVirtualSurface(
  cache: SurfaceCache,
  card: Card,
  cardIndex: number,
  resLevel: number,
  lockPages: boolean,
) {
  const mip = mipOf(card, resLevel)
  if (mip.spanSize > 0 && mip.locked !== lockPages) relock(cache, mip, lockPages)
  else if (mip.spanSize === 0) makeMip(cache, card, cardIndex, resLevel, mip, lockPages)
  if (cache.allowCardSharing && lockPages && card.sharingId >= 0)
    cache.sharing.queueAddition(card.sharingId, cardIndex, card.minResLevel, card.axisXFlipped)
}

/** Gives the physical page of a mapped page back, and takes it out of the heaps that name it. */
function unmapPage(cache: SurfaceCache, locked: boolean, page: Page, pageIndex: number) {
  if (!isMapped(page)) return
  cache.captured.remove(pageIndex)
  cache.recapture.remove(pageIndex)
  if (!locked) cache.unlocked.remove(pageIndex)
  cache.allocator.free(placeOf(page), page.subWidth, page.subHeight)
  page.physX = -1
  page.physY = -1
  page.sampleBiasX = 0
  page.sampleBiasY = 0
  page.sampleResLevelX = 0
  page.sampleResLevelY = 0
  page.pending = false
}

/** Gives the page `pageIndex` of `mip` a physical page — or a part of one — if it has none: the
 *  first that is free. It counts as captured at this frame, and is pending: it reads itself once its
 *  capture is made (`confirmPages`), the next coarser page until then. */
export function mapPage(cache: SurfaceCache, mip: SurfaceMip, pageIndex: number) {
  const page = cache.pages.at(pageIndex)
  if (isMapped(page)) return
  const place = cache.allocator.allocate(page.subWidth, page.subHeight)
  if (place) {
    page.physX = place.pageX
    page.physY = place.pageY
    page.minX = place.minX
    page.minY = place.minY
    page.maxX = place.maxX
    page.maxY = place.maxY
    page.pending = true
    cache.captured.add(cache.frame, pageIndex)
    if (!mip.locked) cache.unlocked.add(cache.feedbackFrame, pageIndex)
  }
  cache.changes.pages.add(pageIndex)
}

/**
 * Frees the mips of `card` from level `from` to level `to`: their pages leave the atlas and the
 * page table. A card that gives up its coarsest mip leaves the sharing of its kind.
 */
export function freeVirtualSurface(cache: SurfaceCache, card: Card, from: number, to: number) {
  if (!cardIsAllocated(card)) return
  for (let level = from; level <= to; level++) {
    const mip = mipOf(card, level)
    if (mip.spanSize === 0) continue
    if (
      cache.allowCardSharing &&
      level === card.minResLevel &&
      card.sharingId >= 0 &&
      card.sharingIndex >= 0
    ) {
      cache.sharing.queueRemoval(card.sharingId, card.sharingIndex)
      card.sharingIndex = -1
    }
    for (let local = 0; local < mip.sizeX * mip.sizeY; local++) {
      const index = pageOf(mip, local)
      const page = cache.pages.at(index)
      unmapPage(cache, mip.locked, page, index)
      Object.assign(page, newPage())
      cache.changes.pages.add(index)
    }
    cache.pages.removeSpan(mip.spanOffset, mip.sizeX * mip.sizeY)
    mip.spanOffset = -1
    mip.spanSize = 0
    mip.locked = false
  }
  updateLevelRange(card)
}

/** Whether a read of `page` finds its own texels: it is mapped and its capture was made. */
const isReadable = (page: Page) => isMapped(page) && !page.pending

/** Whether any page of `mip` holds a physical page. */
function anyMapped(cache: SurfaceCache, mip: SurfaceMip) {
  for (let local = 0; local < mip.sizeX * mip.sizeY; local++)
    if (isMapped(cache.pages.at(pageOf(mip, local)))) return true
  return false
}

/** Has page `index` of `mip` read what the page of `parent` that covers it reads. */
function inheritFromParent(
  cache: SurfaceCache,
  mip: SurfaceMip,
  parent: SurfaceMip,
  local: number,
  index: number,
) {
  const column = local % mip.sizeX,
    row = Math.trunc(local / mip.sizeX)
  const parentColumn = Math.trunc((column * parent.sizeX) / mip.sizeX)
  const parentRow = Math.trunc((row * parent.sizeY) / mip.sizeY)
  const from = cache.pages.at(pageOf(parent, parentColumn + parentRow * parent.sizeX))
  const page = cache.pages.at(index)
  page.samplePage = from.samplePage
  page.sampleBiasX = from.sampleBiasX
  page.sampleBiasY = from.sampleBiasY
  page.sampleResLevelX = from.sampleResLevelX
  page.sampleResLevelY = from.sampleResLevelY
  cache.changes.pages.add(index)
}

/**
 * Tidies the mips of `card` after its pages came and went: a mip with no page mapped is freed, and
 * each page of the rest that is not mapped is made to read what the page of the next coarser mip
 * made that covers it reads, which is itself a page of the atlas or one that reads further up.
 */
export function updateMipHierarchy(cache: SurfaceCache, card: Card) {
  for (let level = card.minResLevel; level <= card.maxResLevel; level++) {
    const mip = mipOf(card, level)
    if (mip.spanSize > 0 && !anyMapped(cache, mip)) freeVirtualSurface(cache, card, level, level)
  }
  updateLevelRange(card)
  let parent = mipOf(card, card.minResLevel)
  for (let level = card.minResLevel + 1; level <= card.maxResLevel; level++) {
    const mip = mipOf(card, level)
    if (mip.spanSize === 0) continue
    for (let local = 0; local < mip.sizeX * mip.sizeY; local++) {
      const index = pageOf(mip, local)
      if (!isReadable(cache.pages.at(index))) inheritFromParent(cache, mip, parent, local, index)
    }
    parent = mip
  }
}

/**
 * The captures of the pages `pageIndices` were made: each reads itself from now on, and the pages of the
 * finer mips of its card that read through it follow. A page that is no longer pending, or no longer
 * mapped, is left as it is.
 */
export function confirmPages(cache: SurfaceCache, pageIndices: Iterable<number>) {
  const cards = new Set<number>()
  for (const index of pageIndices) {
    const page = cache.pages.at(index)
    if (!page.pending || !isMapped(page)) continue
    const mip = mipOf(cache.cards.at(page.card), page.resLevel)
    page.pending = false
    page.samplePage = index
    page.sampleBiasX = Math.trunc(page.minX / MIN_CARD_RESOLUTION)
    page.sampleBiasY = Math.trunc(page.minY / MIN_CARD_RESOLUTION)
    page.sampleResLevelX = mip.resLevelX
    page.sampleResLevelY = mip.resLevelY
    cache.changes.pages.add(index)
    cards.add(page.card)
  }
  for (const cardIndex of cards) {
    updateMipHierarchy(cache, cache.cards.at(cardIndex))
    cache.changes.cards.add(cardIndex)
  }
}

/**
 * Lets the page of the unlocked pages that was read longest ago leave the atlas, if it was last read
 * `maxFramesSinceUsed` feedback frames ago or more; its card is told to `dirty`. Whether one left.
 */
export function evictOldest(cache: SurfaceCache, maxFramesSinceUsed: number, dirty: IndexList) {
  const heap = cache.unlocked
  if (heap.size === 0) return false
  const index = heap.top()
  if (heap.keyOf(index) + maxFramesSinceUsed > cache.feedbackFrame) return false
  heap.pop()
  const page = cache.pages.at(index)
  if (isMapped(page)) {
    unmapPage(cache, false, page, index)
    dirty.add(page.card)
  }
  return true
}

/** Takes the card `cardIndex` out of the atlas altogether: no level is wanted, no mip is kept. */
export function removeCardFromAtlas(cache: SurfaceCache, cardIndex: number) {
  const card = cache.cards.at(cardIndex)
  cache.stats.desiredTexels += setDesiredLevel(card, 0)
  card.desiredOnLastAlloc = 0
  freeVirtualSurface(cache, card, card.minResLevel, card.maxResLevel)
  cache.changes.cards.add(cardIndex)
}
