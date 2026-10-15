import type { GpuPageContext, ResidentPage } from './types.ts'
import { ledgerReplacing } from '../core/deviceLedger.ts'
import { grownByCopy } from '../core/tableGrowth.ts'
import { evictResident } from './commit.ts'
import type { Eviction } from './eviction.ts'
import { checkBudget, storageBufferCap } from '../../residency/pools.ts'
import { extendHomes, pageHomes, type PageHomes } from './homes.ts'
import { createPlacement, poolBytes } from './placement.ts'

/** Bytes of a pool of `slots` pages of `pageBytes` at most (`poolBytes`), refused past one storage
 *  binding. */
export const pageBufferBytes = (
  device: GPUDevice,
  pageBytes: number,
  slots: number,
  homes?: PageHomes,
) => {
  checkBudget(slots, 'INVALID_PAGE_BUDGET')
  const size = poolBytes(pageBytes, slots, homes)
  if (size > storageBufferCap(device.limits)) throw new Error('INVALID_PAGE_BUDGET')
  return size
}

export const createPageBuffer = (
  device: GPUDevice,
  size: number,
  label = 'Trillion3D geometry page cache',
) =>
  device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })

/** The resident pages, ranked only when some must leave: the root cover first, then the pinned
 *  pages, then those the GPU's order does not list — in use, or too recent for it —, each the most
 *  recent arrival first, then the listed ones, its last first: what an arrival would take is what a
 *  smaller pool gives up first (`eviction.ts`). A pool that keeps everything has no rank to
 *  compute. */
function rankedPages(
  resident: ReadonlyMap<string, ResidentPage>,
  fits: boolean,
  eviction: Eviction,
  cover: ReadonlySet<string>,
): ResidentPage[] {
  const pages = [...resident.values()]
  if (fits) return pages
  const kept: ResidentPage[][] = [[], [], []],
    listed: ResidentPage[] = []
  for (const page of pages) {
    if (cover.has(page.key)) kept[0].push(page)
    else if (eviction.isPinned(page.key)) kept[1].push(page)
    else if (eviction.rankOf(page.key) === undefined) kept[2].push(page)
    else listed.push(page)
  }
  // Among the pages the order says nothing of, the most recent arrival first.
  for (const bucket of kept) bucket.sort((a, b) => b.generation - a.generation)
  listed.sort((a, b) => eviction.rankOf(b.key)! - eviction.rankOf(a.key)!)
  return [...kept.flat(), ...listed]
}

/** The catalogue a pool is laid out for when pages join it: the width the widest of them asks, and
 *  the width of each address new to it (`extendHomes`). */
export type GrownPages = { pageBytes: number; widths: ReadonlyMap<string, number> }

/**
 * The pool changes size WITHOUT losing what it holds, through its one allocator (`placement.ts`):
 * a new layout of the new bytes, the pages placed in it in rank — the root cover first, which a
 * pool never goes below, then the pinned pages, then by the GPU's order (`rankedPages`; no rank
 * when they all fit) —, each where it was when that range is free, at its home when the pool comes
 * to hold the catalogue, else in the first span that fits; a page no span takes is evicted. Every
 * page that moved is logged as an ordinary arrival (`residencyLog.ts`). The pages are copied into
 * the new buffer in runs: a page that keeps its offset beside one that does too is one copy, so a
 * pool that grows behind its pages copies them in one; a pool whose bytes and offsets all stay
 * keeps its buffer. Returns the evicted keys, pinned included: the caller unpins them on its side.
 *
 * Pages joined the catalogue (`grown`): their homes are added behind the others; a wider widest
 * page widens the room of a page the catalogue does not name.
 */
export function resizeGpuPages(
  context: GpuPageContext,
  slots: number,
  grown?: GrownPages,
): string[] {
  const { device, resident } = context
  const pageBytes = Math.max(context.pageBytes, grown?.pageBytes ?? context.pageBytes)
  if (grown) joinHomes(context, grown.widths)
  const bytes = pageBufferBytes(device, pageBytes, slots, context.homes)
  const old = context.placement
  const placement = createPlacement({
    bytes,
    widest: pageBytes,
    homes: context.homes,
    eviction: context.eviction,
    resident,
  })
  let total = 0
  for (const page of resident.values()) total += placement.widthFor(page.key, old.widthOf(page))
  const pages = rankedPages(resident, total <= bytes, context.eviction, context.cover)
  // The layout first, nothing moved yet: a buffer the device refuses leaves the pool as it was.
  const plan: { page: ResidentPage; offset: number; bytes: number }[] = []
  let moved = false
  for (const page of pages) {
    const from = old.widthOf(page),
      width = placement.widthFor(page.key, from),
      offset = placement.keep(page.key, width, page.offset)
    plan.push({ page, offset, bytes: Math.min(from, width) })
    if (offset !== page.offset) moved = true
  }
  const next =
    moved || bytes !== context.buffer.size
      ? ledgerReplacing(device, context.buffer.size, () => createPageBuffer(device, bytes))
      : context.buffer
  const evicted: string[] = []
  const runs: number[] = []
  for (const { page, offset, bytes: width } of plan.sort((x, y) => x.page.offset - y.page.offset)) {
    if (offset < 0) {
      evictResident(context, page, 'resize')
      evicted.push(page.key)
      continue
    }
    const at = runs.length - 3
    if (
      at >= 0 &&
      runs[at] + runs[at + 2] === page.offset &&
      runs[at + 1] + runs[at + 2] === offset
    )
      runs[at + 2] += width
    else runs.push(page.offset, offset, width)
    if (offset === page.offset) continue
    page.offset = offset
    context.changes.placed(page.key, offset)
  }
  if (next !== context.buffer) {
    const held = context.buffer
    context.buffer = next
    grownByCopy(
      device,
      [held],
      (encoder) => {
        for (let i = 0; i < runs.length; i += 3)
          encoder.copyBufferToBuffer(held, runs[i], next, runs[i + 1], runs[i + 2])
      },
      'Trillion3D geometry page cache resize',
    )
  }
  context.placement = placement
  context.slots = slots
  context.pageBytes = pageBytes
  return evicted
}

/** The homes of the addresses `widths` names, behind the pool's own. */
function joinHomes(context: GpuPageContext, widths: ReadonlyMap<string, number>) {
  if (context.homes) extendHomes(context.homes, widths)
  else context.homes = pageHomes(widths)
}
