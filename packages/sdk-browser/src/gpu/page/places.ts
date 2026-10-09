import type { GpuPageContext, ResidentPage } from './types.ts'

/**
 * WHERE A PAGE LIES IN A POOL OF FIXED SLOTS: a slot is the size of the scene's largest cluster,
 * and a page that fits a quarter of it takes a quarter, four to a slot (`SLOT_SPLIT`) — the world's
 * super-roots, eight hundred bytes in a slot of four thousand, are held four times as many in the
 * same bytes. A quarter lies at its slot's offset plus its rank's share; the page table names
 * every page by its offset alone, so nothing that reads a page knows which it took. One pool, one
 * eviction, one set of pins: a slot is free, held whole, or split, and a split slot is free again
 * once its last quarter leaves. A pool whose slot does not divide into four whole words, or that
 * holds the whole catalogue at its pages' own places (`homes.ts`), splits none.
 */
export const SLOT_SPLIT = 4

/** The bytes of a quarter of a slot of `pageBytes`, or 0 when a slot does not split. */
export const quarterBytesOf = (pageBytes: number) =>
  pageBytes % (4 * SLOT_SPLIT) === 0 ? pageBytes / SLOT_SPLIT : 0

/** Where a page is placed: its slot, and its quarter (-1 for the slot whole). */
export type Place = { slot: number; quarter: number }

/** The byte offset of `place` in a pool of `pageBytes` slots. */
export const placeOffset = ({ slot, quarter }: Place, pageBytes: number) =>
  slot * pageBytes + (quarter < 0 ? 0 : (quarter * pageBytes) / SLOT_SPLIT)

/** The quarter of its slot `page` lies in, -1 when it holds the slot whole. */
export const quarterOf = (context: GpuPageContext, page: ResidentPage) =>
  context.split.get(page.slot)?.has(page.key)
    ? (page.offset - page.slot * context.pageBytes) / context.quarterBytes
    : -1

/** Whether a page of `bytes` takes a quarter in `context`'s pool. */
export const takesQuarter = (context: GpuPageContext, bytes: number) =>
  context.quarterBytes > 0 && bytes <= context.quarterBytes

/** `slot` split: its first quarter is the caller's, the three others free. */
function split(context: GpuPageContext, slot: number): Place {
  context.split.set(slot, new Set())
  for (let quarter = 1; quarter < SLOT_SPLIT; quarter++)
    context.quarters.add(slot * SLOT_SPLIT + quarter)
  return { slot, quarter: 0 }
}

/** A free quarter, taken: a free one, else one of a free slot split. */
function freeQuarter(context: GpuPageContext): Place | undefined {
  for (const at of context.quarters) {
    context.quarters.delete(at)
    return { slot: Math.floor(at / SLOT_SPLIT), quarter: at % SLOT_SPLIT }
  }
  const slot = context.free.pop()
  return slot === undefined ? undefined : split(context, slot)
}

/** `page`'s place given back: a whole slot to the free ones, a quarter to the free quarters — its
 *  slot whole and free again once it holds none. */
export function releasePlace(context: GpuPageContext, page: ResidentPage) {
  const quarter = quarterOf(context, page)
  if (quarter < 0) return void context.free.push(page.slot)
  const held = context.split.get(page.slot)
  held?.delete(page.key)
  context.quarters.add(page.slot * SLOT_SPLIT + quarter)
  if (held && held.size > 0) return
  for (let quarter = 0; quarter < SLOT_SPLIT; quarter++)
    context.quarters.delete(page.slot * SLOT_SPLIT + quarter)
  context.split.delete(page.slot)
  context.free.push(page.slot)
}

/** Whether every page of split `slot` may leave: none pinned. */
const slotUnpinned = (context: GpuPageContext, slot: number) => {
  for (const key of context.split.get(slot) ?? []) if (context.pins.has(key)) return false
  return true
}

/**
 * A place for a page of `bytes`, taken from a free one when there is one, else from the pages
 * `victim` names among those `accept` takes — each evicted by `evict` and its place given back —:
 * a quarter from any unpinned page, a whole slot from a whole page or a split slot none of whose
 * pages is pinned. `undefined` when no unpinned page leaves room.
 */
export function takePlace(
  context: GpuPageContext,
  bytes: number,
  victim: (accept: (page: ResidentPage) => boolean) => ResidentPage | undefined,
  evict: (page: ResidentPage) => void,
): Place | undefined {
  const quarter = takesQuarter(context, bytes)
  const accept = (page: ResidentPage) =>
    quarter || quarterOf(context, page) < 0 || slotUnpinned(context, page.slot)
  for (;;) {
    const free = quarter ? freeQuarter(context) : context.free.pop()
    if (free !== undefined) return typeof free === 'number' ? { slot: free, quarter: -1 } : free
    const page = victim(accept)
    if (!page) return undefined
    // A whole slot asked of a split one leaves with every page of it; any other victim alone.
    const leaving =
      quarter || quarterOf(context, page) < 0
        ? [page]
        : [...context.split.get(page.slot)!].map((key) => context.resident.get(key)!)
    for (const gone of leaving) {
      evict(gone)
      releasePlace(context, gone)
    }
  }
}

/** `page`, now resident at `place`: a quarter is counted in its slot. */
export function holdPlace(context: GpuPageContext, page: ResidentPage, place: Place) {
  if (place.quarter >= 0) context.split.get(page.slot)?.add(page.key)
}
