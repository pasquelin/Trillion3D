import type { GpuPageContext, ResidentPage } from './types.ts';
import { evictResident } from './commit.ts';

/** Bytes a page buffer may occupy on this device: the smaller of its limits. */
export const pageBufferCap = (limits?: {
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
}) => Math.min(limits?.maxBufferSize ?? Infinity, limits?.maxStorageBufferBindingSize ?? Infinity);

export const pageBufferBytes = (device: GPUDevice, pageBytes: number, slots: number) => {
  const size = pageBytes * slots;
  if (!Number.isSafeInteger(slots) || slots < 1 || size > pageBufferCap(device.limits))
    throw new Error('INVALID_PAGE_BUDGET');
  return size;
};

export const createPageBuffer = (device: GPUDevice, size: number) =>
  device.createBuffer({
    label: 'WG geometry page cache',
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
  held?: ReadonlySet<string>,
): ResidentPage[] {
  const pages = [...resident.values()];
  if (pages.length <= slots) return pages;
  const buckets: ResidentPage[][] = [[], [], [], []];
  for (const page of pages)
    buckets[(held?.has(page.key) ? 2 : 0) + (pins.has(page.key) ? 1 : 0)].push(page);
  return buckets.reverse().flatMap((bucket) => bucket.sort(byRecency));
}

/**
 * The pool changes size WITHOUT losing what it holds: the reference, by contrast, empties its
 * pool when `StreamingPoolSize` changes. The pages that matter most keep a place, wherever they
 * were: the `held` cover first — the root cover, which a pool never goes below —, then the pinned
 * pages, then the most recent. A page whose slot survives is copied on the GPU in the same place;
 * one whose slot disappears takes a slot left free — by the new size or by a page that ranks
 * below it — and the rest is evicted. Each move goes through the change log, which the residency
 * mirror reads as an ordinary arrival or departure. Returns the evicted keys, pinned included:
 * the caller unpins them on its side.
 */
export function resizeGpuPages(
  context: GpuPageContext,
  slots: number,
  held?: ReadonlySet<string>,
): string[] {
  const { device, pageBytes, resident, pins, free } = context;
  const size = pageBufferBytes(device, pageBytes, slots);
  const next = createPageBuffer(device, size);
  const encoder = device.createCommandEncoder({ label: 'WG geometry page cache resize' });
  encoder.copyBufferToBuffer(
    context.buffer,
    0,
    next,
    0,
    Math.min(context.slots, slots) * pageBytes,
  );
  const pages = rankedPages(resident, slots, pins, held);
  // The first `slots` pages stay; those already inside the new pool keep their slot, the others
  // take the slots the rest leaves free.
  const occupied = new Uint8Array(slots);
  const displaced: ResidentPage[] = [];
  for (let i = 0; i < pages.length && i < slots; i++)
    if (pages[i].slot < slots) occupied[pages[i].slot] = 1;
    else displaced.push(pages[i]);
  const evicted: string[] = [];
  for (let i = slots; i < pages.length; i++) {
    evictResident(context, pages[i], 'resize');
    evicted.push(pages[i].key);
  }
  // Free slots are taken from the top by a load; a displaced page takes the lowest.
  free.length = 0;
  for (let slot = 0; slot < slots; slot++) if (!occupied[slot]) free.push(slot);
  // Every displaced page has a free slot: the pool keeps at most `slots` pages.
  displaced.forEach((page, i) => {
    const slot = free[i];
    encoder.copyBufferToBuffer(context.buffer, page.offset, next, slot * pageBytes, pageBytes);
    page.slot = slot;
    page.offset = slot * pageBytes;
    context.changeKeys.push(page.key);
    context.changeSlots.push(page.offset / 4);
  });
  free.splice(0, displaced.length);
  device.queue.submit([encoder.finish()]);
  context.buffer.destroy();
  context.buffer = next;
  context.slots = slots;
  return evicted;
}
