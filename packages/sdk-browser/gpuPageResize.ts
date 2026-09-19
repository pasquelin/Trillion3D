import type { GpuPageContext, ResidentPage } from './gpuPageTypes.ts';
import { evictResident } from './gpuPageCommit.ts';

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

/**
 * The pool changes size WITHOUT losing what it holds: the reference, by contrast, empties its
 * pool when `StreamingPoolSize` changes. Pages in slots that survive are copied on the GPU in
 * the same place; those in slots that disappear are moved into a free slot of the new pool while
 * any remain — pinned first, then most recent — and only then evicted. Each move goes through
 * the change log, which the residency mirror reads as an ordinary arrival or departure. Returns
 * the evicted keys, pinned included: the caller unpins them on its side.
 */
export function resizeGpuPages(context: GpuPageContext, slots: number): string[] {
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
  // One pass over residency: occupied slots that survive, and pages that are moved — pinned
  // first, then most recent, when room runs out.
  const occupied = new Uint8Array(slots);
  const displaced: ResidentPage[] = [];
  for (const page of resident.values()) {
    if (page.slot < slots) occupied[page.slot] = 1;
    else displaced.push(page);
  }
  free.length = 0;
  for (let slot = 0; slot < slots; slot++) if (!occupied[slot]) free.push(slot);
  displaced.sort(
    (a, b) => Number(pins.has(b.key)) - Number(pins.has(a.key)) || b.generation - a.generation,
  );
  const evicted: string[] = [];
  let taken = 0;
  for (const page of displaced) {
    if (taken === free.length) {
      evictResident(context, page, 'resize');
      evicted.push(page.key);
      continue;
    }
    const slot = free[taken++];
    encoder.copyBufferToBuffer(context.buffer, page.offset, next, slot * pageBytes, pageBytes);
    page.slot = slot;
    page.offset = slot * pageBytes;
    context.changeKeys.push(page.key);
    context.changeSlots.push(page.offset / 4);
  }
  free.splice(0, taken);
  device.queue.submit([encoder.finish()]);
  context.buffer.destroy();
  context.buffer = next;
  context.slots = slots;
  return evicted;
}
