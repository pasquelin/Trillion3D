import type { GpuPageContext, ResidentPage } from './types.ts'
import { ledgerReplacing } from '../core/deviceLedger.ts'
import { pendingBuffers } from '../core/tableGrowth.ts'
import { evictResident } from './commit.ts'
import type { Eviction } from './eviction.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { extendHomes, heldHomes, pageHomes, type PageHomes } from './homes.ts'
import {
  homePlacement,
  quarterBytesOf,
  SLOT_SPLIT,
  slotPlacement,
  wholeSlots,
  type SlotLayout,
} from './placement.ts'

/** Bytes of a pool of `slots`: its pages' own homes when it holds the whole catalogue
 *  (`homes.ts`), a slot of `pageBytes` each otherwise. */
export const pageBufferBytes = (
  device: GPUDevice,
  pageBytes: number,
  slots: number,
  homes?: PageHomes,
) => {
  const size = heldHomes(homes, slots)?.bytes ?? pageBytes * slots
  if (!Number.isSafeInteger(slots) || slots < 1 || size > storageBufferCap(device.limits))
    throw new Error('INVALID_PAGE_BUDGET')
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
  slots: number,
  eviction: Eviction,
  cover: ReadonlySet<string>,
): ResidentPage[] {
  const pages = [...resident.values()]
  if (pages.length <= slots) return pages
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

/** The catalogue a pool is laid out for when pages join it: the slot width the widest of them
 *  asks, and the width of each address new to it (`extendHomes`). */
export type GrownPages = { pageBytes: number; widths: ReadonlyMap<string, number> }

/**
 * The pool changes size WITHOUT losing what it holds. The pages that matter most keep a place, wherever they
 * were: the root cover first — which a pool never goes below —, then the pinned
 * pages, then by the GPU's order. A page whose slot survives is copied on the GPU in the same place;
 * one whose slot disappears takes a slot left free — by the new size or by a page that ranks
 * below it — and the rest is evicted. A pool that comes to hold the whole catalogue moves every
 * page to its own home (`homes.ts`); one that leaves it ranks them all as displaced, a home being
 * no fixed slot. Each move goes through the change log, which the residency mirror reads as an
 * ordinary arrival or departure. Returns the evicted keys, pinned included: the caller unpins
 * them on its side.
 *
 * Pages joined the catalogue (`grown`): their homes are added behind the others, a pool that holds
 * the catalogue growing by their bytes with every page where it was; a slot made wider takes every
 * page to its place in the wider slots, as a pool of another size does.
 */
export function resizeGpuPages(
  context: GpuPageContext,
  slots: number,
  grown?: GrownPages,
): string[] {
  const { device, resident } = context
  const was = context.pageBytes,
    pageBytes = Math.max(was, grown?.pageBytes ?? was)
  const from = heldHomes(context.homes, context.slots)
  if (grown) joinHomes(context, grown.widths)
  const to = heldHomes(context.homes, slots)
  const widened = pageBytes !== was
  // Both hold the whole catalogue: every page keeps its home, in the buffer it is in — a larger one
  // when homes were added behind them.
  if (from && to) return growHomes(context, slots, to, pageBytes)
  // The new pool replaces the old, freed once its pages are copied: the budget admits it so.
  const next = ledgerReplacing(device, context.buffer.size, () =>
    createPageBuffer(device, pageBufferBytes(device, pageBytes, slots, to)),
  )
  const encoder = device.createCommandEncoder({ label: 'Trillion3D geometry page cache resize' })
  // Split slots move their quarters with them: the pool is laid out again, page by page.
  const repack = !from && !to && context.placement.split.size > 0
  if (!from && !to && !repack && !widened)
    encoder.copyBufferToBuffer(
      context.buffer,
      0,
      next,
      0,
      Math.min(context.slots, slots) * pageBytes,
    )
  const evicted: string[] = []
  const leave = (page: ResidentPage) => {
    evictResident(context, page, 'resize')
    evicted.push(page.key)
  }
  /** Each page's width before the move: its quarter's or its slot's. */
  const quarterBytes = quarterBytesOf(was)
  const widths = new Map<string, number>()
  for (const page of resident.values())
    widths.set(page.key, context.placement.split.get(page.slot)?.has(page.key) ? quarterBytes : was)
  /** Copies a page and what follows it in its place — its tails — to `offset` of the new pool:
   *  its home's width where it has or takes one, never a byte of a neighbour's. */
  const move = (page: ResidentPage, slot: number, offset: number) => {
    const home = (to ?? from)?.homes.get(page.key)
    encoder.copyBufferToBuffer(
      context.buffer,
      page.offset,
      next,
      offset,
      home?.bytes ?? widths.get(page.key)!,
    )
    page.slot = slot
    if (page.offset === offset) return
    page.offset = offset
    context.changes.placed(page.key, offset)
  }
  if (repack) repackPages(context, slots, pageBytes, leave, move)
  else if (to) {
    // Each page to its own home; one the catalogue does not name has none, and leaves.
    for (const page of [...resident.values()]) {
      const home = to.homes.get(page.key)
      if (!home) leave(page)
      else move(page, home.rank, home.offset)
    }
    context.placement = homePlacement(to, to.homes.size - resident.size)
  } else {
    const pages = rankedPages(resident, slots, context.eviction, context.cover)
    // The first `slots` pages stay; those already inside the new pool keep their slot, the
    // others take the slots the rest leaves free.
    const occupied = new Uint8Array(slots)
    const displaced: ResidentPage[] = []
    for (let i = 0; i < pages.length && i < slots; i++)
      if (!from && !widened && pages[i].slot < slots) occupied[pages[i].slot] = 1
      else displaced.push(pages[i])
    for (let i = slots; i < pages.length; i++) leave(pages[i])
    // Free slots are taken from the top by a load; a displaced page takes the lowest.
    const free: number[] = []
    for (let slot = 0; slot < slots; slot++) if (!occupied[slot]) free.push(slot)
    // Every displaced page has a free slot: the pool keeps at most `slots` pages.
    displaced.forEach((page, i) => move(page, free[i], free[i] * pageBytes))
    free.splice(0, displaced.length)
    context.placement = slotPlacement(pageBytes, wholeSlots(free), context.eviction, resident)
  }
  pendingBuffers([next], () => {
    device.queue.submit([encoder.finish()])
    const held = context.buffer
    context.buffer = next
    context.slots = slots
    context.pageBytes = pageBytes
    return [held]
  }).commit()
  return evicted
}

/** The homes of the addresses `widths` names, behind the pool's own. */
function joinHomes(context: GpuPageContext, widths: ReadonlyMap<string, number>) {
  if (context.homes) extendHomes(context.homes, widths)
  else context.homes = pageHomes(widths)
}

/** A pool that holds the whole catalogue before and after: every page keeps its home, the buffer
 *  made larger, and copied whole, when the homes added need bytes it lacks. */
function growHomes(context: GpuPageContext, slots: number, to: PageHomes, pageBytes: number) {
  const { device, resident } = context
  if (context.buffer.size < to.bytes) {
    const next = ledgerReplacing(device, context.buffer.size, () =>
      createPageBuffer(device, pageBufferBytes(device, context.pageBytes, slots, to)),
    )
    const encoder = device.createCommandEncoder({ label: 'Trillion3D geometry page cache growth' })
    encoder.copyBufferToBuffer(context.buffer, 0, next, 0, context.buffer.size)
    device.queue.submit([encoder.finish()])
    context.buffer.destroy()
    context.buffer = next
  }
  context.placement = homePlacement(to, to.homes.size - resident.size)
  context.slots = slots
  context.pageBytes = pageBytes
  return []
}

/**
 * A pool with split slots laid out again for `slots`: the pages ranked as a resize keeps them
 * (`rankedPages`), each placed in turn from the first slot — a whole page a slot, a page a quarter
 * of a slot (`placement.ts`) a quarter of the slot its last neighbour opened —, those past the last
 * slot leaving. Every page is copied to its place, each one that moved logged.
 */
function repackPages(
  context: GpuPageContext,
  slots: number,
  pageBytes: number,
  leave: (page: ResidentPage) => void,
  move: (page: ResidentPage, slot: number, offset: number) => void,
) {
  const { resident } = context
  const quarterBytes = quarterBytesOf(pageBytes)
  const layout: SlotLayout = wholeSlots([])
  const { free, quarters, split } = layout
  const pages = rankedPages(resident, slots * SLOT_SPLIT, context.eviction, context.cover)
  let cursor = 0,
    open = -1,
    taken = SLOT_SPLIT
  for (const page of pages) {
    const small = quarterBytes > 0 && page.bytes <= quarterBytes
    if (small && taken < SLOT_SPLIT) {
      move(page, open, open * pageBytes + taken++ * quarterBytes)
      split.get(open)!.add(page.key)
    } else if (cursor < slots) {
      const slot = cursor++
      if (small) {
        open = slot
        taken = 1
        split.set(slot, new Set([page.key]))
      }
      move(page, slot, slot * pageBytes)
    } else leave(page)
  }
  for (let quarter = taken; open >= 0 && quarter < SLOT_SPLIT; quarter++)
    quarters.add(open * SLOT_SPLIT + quarter)
  for (let slot = cursor; slot < slots; slot++) free.push(slot)
  context.placement = slotPlacement(pageBytes, layout, context.eviction, resident)
}
