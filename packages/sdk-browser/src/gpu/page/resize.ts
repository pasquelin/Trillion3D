import type { GpuPageContext, ResidentPage } from './types.ts';
import { evictResident } from './commit.ts';
import { storageBufferCap } from '../../residency/pools.ts';
import { heldHomes, type PageHomes } from './homes.ts';

/** Bytes of a pool of `slots`: its pages' own homes when it holds the whole catalogue
 *  (`homes.ts`), a slot of `pageBytes` each otherwise. */
export const pageBufferBytes = (
  device: GPUDevice,
  pageBytes: number,
  slots: number,
  homes?: PageHomes,
) => {
  const size = heldHomes(homes, slots)?.bytes ?? pageBytes * slots;
  if (!Number.isSafeInteger(slots) || slots < 1 || size > storageBufferCap(device.limits))
    throw new Error('INVALID_PAGE_BUDGET');
  return size;
};

export const createPageBuffer = (
  device: GPUDevice,
  size: number,
  label = 'Trillion3D geometry page cache',
) =>
  device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

const byRecency = (a: ResidentPage, b: ResidentPage) => b.generation - a.generation;

/** The resident pages, ranked only when some must leave: the `held` cover first, then the pinned
 *  pages, then by recency. A pool that keeps everything has no rank to compute. */
function rankedPages(
  resident: ReadonlyMap<string, ResidentPage>,
  slots: number,
  pins: ReadonlySet<string>,
  held: ReadonlySet<string>,
): ResidentPage[] {
  const pages = [...resident.values()];
  if (pages.length <= slots) return pages;
  const buckets: ResidentPage[][] = [[], [], []];
  for (const page of pages) buckets[held.has(page.key) ? 2 : pins.has(page.key) ? 1 : 0].push(page);
  return buckets.reverse().flatMap((bucket) => bucket.sort(byRecency));
}

/**
 * The pool changes size WITHOUT losing what it holds. The pages that matter most keep a place, wherever they
 * were: the `held` cover first — the root cover, which a pool never goes below —, then the pinned
 * pages, then the most recent. A page whose slot survives is copied on the GPU in the same place;
 * one whose slot disappears takes a slot left free — by the new size or by a page that ranks
 * below it — and the rest is evicted. A pool that comes to hold the whole catalogue moves every
 * page to its own home (`homes.ts`); one that leaves it ranks them all as displaced, a home being
 * no fixed slot. Each move goes through the change log, which the residency mirror reads as an
 * ordinary arrival or departure. Returns the evicted keys, pinned included: the caller unpins
 * them on its side.
 */
export function resizeGpuPages(context: GpuPageContext, slots: number): string[] {
  const { device, pageBytes, resident, pins, held, free } = context;
  const from = heldHomes(context.homes, context.slots),
    to = heldHomes(context.homes, slots);
  // Both hold the whole catalogue: every page keeps its home, in the buffer it is in.
  if (from && to) return ((context.slots = slots), []);
  const next = createPageBuffer(device, pageBufferBytes(device, pageBytes, slots, to));
  const encoder = device.createCommandEncoder({ label: 'Trillion3D geometry page cache resize' });
  if (!from && !to)
    encoder.copyBufferToBuffer(
      context.buffer,
      0,
      next,
      0,
      Math.min(context.slots, slots) * pageBytes,
    );
  const evicted: string[] = [];
  const leave = (page: ResidentPage) => {
    evictResident(context, page, 'resize');
    evicted.push(page.key);
  };
  /** Copies a page and what follows it in its place — its tails — to `offset` of the new pool:
   *  its home's width where it has or takes one, never a byte of a neighbour's. */
  const move = (page: ResidentPage, slot: number, offset: number) => {
    const home = (to ?? from)?.homes.get(page.key);
    encoder.copyBufferToBuffer(context.buffer, page.offset, next, offset, home?.bytes ?? pageBytes);
    page.slot = slot;
    if (page.offset === offset) return;
    page.offset = offset;
    context.changeKeys.push(page.key);
    context.changeSlots.push(offset / 4);
  };
  free.length = 0;
  if (to) {
    // Each page to its own home; one the catalogue does not name has none, and leaves.
    const occupied = new Uint8Array(to.homes.size);
    for (const page of [...resident.values()]) {
      const home = to.homes.get(page.key);
      if (!home) leave(page);
      else {
        occupied[home.rank] = 1;
        move(page, home.rank, home.offset);
      }
    }
    for (let rank = 0; rank < occupied.length; rank++) if (!occupied[rank]) free.push(rank);
  } else {
    const pages = rankedPages(resident, slots, pins, held);
    // The first `slots` pages stay; those already inside the new pool keep their slot, the
    // others take the slots the rest leaves free.
    const occupied = new Uint8Array(slots);
    const displaced: ResidentPage[] = [];
    for (let i = 0; i < pages.length && i < slots; i++)
      if (!from && pages[i].slot < slots) occupied[pages[i].slot] = 1;
      else displaced.push(pages[i]);
    for (let i = slots; i < pages.length; i++) leave(pages[i]);
    // Free slots are taken from the top by a load; a displaced page takes the lowest.
    for (let slot = 0; slot < slots; slot++) if (!occupied[slot]) free.push(slot);
    // Every displaced page has a free slot: the pool keeps at most `slots` pages.
    displaced.forEach((page, i) => move(page, free[i], free[i] * pageBytes));
    free.splice(0, displaced.length);
  }
  device.queue.submit([encoder.finish()]);
  context.buffer.destroy();
  context.buffer = next;
  context.slots = slots;
  return evicted;
}
