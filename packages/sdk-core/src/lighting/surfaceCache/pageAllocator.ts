import { bitWords, ceilDiv, floorLog2 } from '../../../../math/src/scalar/integers.ts'
import { clearBit, lowestBit, setBit } from '../../../../math/src/scalar/bits.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { SurfaceCacheSettings } from '../../contracts/surfaceCacheOptions.ts'
import { cardMaxResolution, PAGE_SIZE, type MipDesc } from './cardResolution.ts'

/**
 * THE PHYSICAL ATLAS: a square of physical pages of 128 × 128 texels, and who holds each. A page is
 * handed out whole, or cut into equal parts — 8 × 8 up to 128 × 128, each size a bin of its own — for
 * a mip of the lowest levels, which is one part of a page. A bitmap says which pages are free; each
 * bin keeps the pages it cut, a bitmap of the parts of each saying which are taken. A page whose
 * parts are all given back goes back to the bitmap whole.
 *
 * The same allocator, on a smaller square, holds the pages being captured in an image.
 */

/** The pages along a side of the atlas: the side in texels over a page, rounded up, times the
 *  atlas's factor, cut to a whole number and held between 1 and 64. */
export function atlasPages(settings: SurfaceCacheSettings) {
  const pages = ceilDiv(settings.surfaceCacheAtlasSize, PAGE_SIZE)
  return clamp(Math.trunc(pages * settings.surfaceCacheResolution), 1, 64)
}

/**
 * The pages along a side of the capture atlas, where the pages captured in an image are drawn: the
 * atlas's side over the square root of `surfaceCacheCardCaptureFactor`, in pages, but with room for
 * one card of the greatest resolution, and never over the atlas.
 */
export function captureAtlasPages(settings: SurfaceCacheSettings, atlasPagesPerSide: number) {
  const reduction = 1 / Math.sqrt(clamp(settings.surfaceCacheCardCaptureFactor, 1, 1024))
  let pages = ceilDiv(Math.trunc(atlasPagesPerSide * PAGE_SIZE * reduction + 0.5), PAGE_SIZE)
  const cardPages = ceilDiv(cardMaxResolution(settings), PAGE_SIZE)
  if (pages * pages < cardPages * cardPages) pages = cardPages
  if (pages * pages > atlasPagesPerSide * atlasPagesPerSide) pages = atlasPagesPerSide
  return pages
}

/** Where a page or a part of one was given: the page, and the rectangle of texels in the atlas. */
export interface Allocation {
  readonly pageX: number
  readonly pageY: number
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/** One physical page cut into the parts of one bin: the parts taken, one bit each. */
interface CutPage {
  readonly pageX: number
  readonly pageY: number
  readonly taken: Uint32Array
  free: number
}

/** The pages cut into parts of one size. */
interface Bin {
  readonly partWidth: number
  readonly partHeight: number
  /** The parts along each axis of a page. */
  readonly across: number
  readonly down: number
  readonly pages: CutPage[]
}

/** The index of the first clear bit of the first `count` bits of `words`, else -1. */
function firstClearBit(words: Uint32Array, count: number) {
  for (let word = 0; word < words.length; word++) {
    if (words[word] === 0xffffffff) continue
    const index = word * 32 + lowestBit(~words[word])
    return index < count ? index : -1
  }
  return -1
}

/** The parts one page holds in `bin`. */
const partCount = (bin: Bin) => bin.across * bin.down

/** Statistics of the atlas. */
interface PageStats {
  /** The pages free. */
  readonly freePages: number
  /** The pages cut into parts, and those among them that hold fewer parts than a page's worth of
   *  their bin would fill (a page that could be saved). */
  readonly binPages: number
  readonly binWastedPages: number
  /** The texels free in the pages cut. */
  readonly binFreeTexels: number
  /** For each size of part with a part taken: the size, the parts taken and the pages cut. */
  readonly bins: readonly {
    readonly partWidth: number
    readonly partHeight: number
    readonly taken: number
    readonly pages: number
  }[]
}

/** What a physical atlas keeps: the pages free, and the bins of the pages cut into parts. */
interface Atlas {
  readonly pagesX: number
  readonly pagesY: number
  readonly total: number
  /** One bit for each page: set when it is taken, whole or cut. */
  readonly used: Uint32Array
  freePages: number
  readonly bins: Bin[]
  /** The bin of each size of part, by the log2 of its width plus eight times the log2 of its height;
   *  -1 for a size with no bin. */
  readonly binOf: Int16Array
}

/** The bin of parts of `width` × `height`, made if `create`. */
function binFor(atlas: Atlas, width: number, height: number, create: boolean) {
  const key = floorLog2(width) + floorLog2(height) * 8
  if (atlas.binOf[key] < 0) {
    if (!create) return undefined
    atlas.binOf[key] = atlas.bins.length
    const across = Math.trunc(PAGE_SIZE / width)
    const down = Math.trunc(PAGE_SIZE / height)
    atlas.bins.push({ partWidth: width, partHeight: height, across, down, pages: [] })
  }
  return atlas.bins[atlas.binOf[key]]
}

/** The first free page, taken; -1 if none. */
function takePage(atlas: Atlas) {
  const index = firstClearBit(atlas.used, atlas.total)
  if (index < 0) return -1
  setBit(atlas.used, index)
  atlas.freePages--
  return index
}

function releasePage(atlas: Atlas, pageX: number, pageY: number) {
  clearBit(atlas.used, pageY * atlas.pagesX + pageX)
  atlas.freePages++
}

/** A page cut for `bin` with a part free: the first, else a page newly cut. */
function cutPage(atlas: Atlas, part: Bin) {
  const found = part.pages.find((page) => page.free > 0)
  if (found) return found
  const index = takePage(atlas)
  if (index < 0) return undefined
  const cut: CutPage = {
    pageX: index % atlas.pagesX,
    pageY: Math.trunc(index / atlas.pagesX),
    taken: new Uint32Array(8),
    free: partCount(part),
  }
  part.pages.push(cut)
  return cut
}

/** A page, or the part of one of `partWidth` × `partHeight` texels (both -1 for a whole page): the
 *  first that is free, or `undefined`. */
function allocate(atlas: Atlas, partWidth: number, partHeight: number): Allocation | undefined {
  if (partWidth < 0 && partHeight < 0) {
    const index = takePage(atlas)
    if (index < 0) return undefined
    const pageX = index % atlas.pagesX
    const pageY = Math.trunc(index / atlas.pagesX)
    const minX = pageX * PAGE_SIZE
    const minY = pageY * PAGE_SIZE
    return { pageX, pageY, minX, minY, maxX: minX + PAGE_SIZE, maxY: minY + PAGE_SIZE }
  }
  const part = binFor(atlas, partWidth, partHeight, true)!
  const page = cutPage(atlas, part)
  if (!page) return undefined
  const slot = firstClearBit(page.taken, partCount(part))
  setBit(page.taken, slot)
  page.free--
  const minX = page.pageX * PAGE_SIZE + (slot % part.across) * partWidth
  const minY = page.pageY * PAGE_SIZE + Math.trunc(slot / part.across) * partHeight
  return {
    pageX: page.pageX,
    pageY: page.pageY,
    minX,
    minY,
    maxX: minX + partWidth,
    maxY: minY + partHeight,
  }
}

/** Gives back what `allocate` gave for the same part size: its page, and its place in it. */
function release(atlas: Atlas, where: Allocation, partWidth: number, partHeight: number) {
  if (partWidth < 0 && partHeight < 0) return releasePage(atlas, where.pageX, where.pageY)
  const part = binFor(atlas, partWidth, partHeight, false)!
  const at = part.pages.findIndex((p) => p.pageX === where.pageX && p.pageY === where.pageY)
  const page = part.pages[at]
  const column = (where.minX - where.pageX * PAGE_SIZE) / partWidth
  const row = (where.minY - where.pageY * PAGE_SIZE) / partHeight
  clearBit(page.taken, column + part.across * row)
  page.free++
  if (page.free < partCount(part)) return
  // The page holds nothing: it leaves the bin, the last page taking its place, and is free.
  part.pages[at] = part.pages[part.pages.length - 1]
  part.pages.pop()
  releasePage(atlas, where.pageX, where.pageY)
}

/** Whether `mip` fits: its pages, or one page when `singlePage`, among the pages free — or, for a
 *  mip that is a part of a page, a part free in a page already cut for its size. */
function fits(atlas: Atlas, mip: MipDesc, singlePage: boolean) {
  const required = singlePage ? 1 : mip.sizeInPagesX * mip.sizeInPagesY
  if (atlas.freePages >= required) return true
  if (!mip.subAllocation) return false
  const part = binFor(atlas, mip.resolutionX, mip.resolutionY, false)
  return part !== undefined && part.pages.some((page) => page.free > 0)
}

/** The statistics of the atlas. */
function statsOf(atlas: Atlas): PageStats {
  let binPages = 0,
    binWastedPages = 0,
    binFreeTexels = 0
  const listed: PageStats['bins'][number][] = []
  for (const part of atlas.bins) {
    const perPage = partCount(part)
    const freeParts = part.pages.reduce((sum, page) => sum + page.free, 0)
    const taken = part.pages.length * perPage - freeParts
    binPages += part.pages.length
    binWastedPages += part.pages.length - ceilDiv(taken, perPage)
    binFreeTexels += freeParts * part.partWidth * part.partHeight
    if (taken > 0) {
      const { partWidth, partHeight } = part
      listed.push({ partWidth, partHeight, taken, pages: part.pages.length })
    }
  }
  listed.sort(
    (a, b) => a.partWidth * a.partHeight - b.partWidth * b.partHeight || a.partWidth - b.partWidth,
  )
  return { freePages: atlas.freePages, binPages, binWastedPages, binFreeTexels, bins: listed }
}

/** A physical atlas of `pagesX` × `pagesY` pages, all free. */
export function createPageAllocator(pagesX: number, pagesY: number) {
  const total = pagesX * pagesY
  const atlas: Atlas = {
    pagesX,
    pagesY,
    total,
    used: new Uint32Array(bitWords(total)),
    freePages: total,
    bins: [],
    binOf: new Int16Array(64).fill(-1),
  }
  return {
    /** The pages free. */
    get freePages() {
      return atlas.freePages
    },
    /** The pages along each side. */
    pagesX,
    pagesY,
    allocate: (partWidth: number, partHeight: number) => allocate(atlas, partWidth, partHeight),
    free: (where: Allocation, partWidth: number, partHeight: number) =>
      release(atlas, where, partWidth, partHeight),
    isSpaceAvailable: (mip: MipDesc, singlePage: boolean) => fits(atlas, mip, singlePage),
    stats: () => statsOf(atlas),
  }
}

/** A physical atlas. */
export type PageAllocator = ReturnType<typeof createPageAllocator>
