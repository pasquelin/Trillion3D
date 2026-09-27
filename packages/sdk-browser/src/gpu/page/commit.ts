import type { GpuPageContext, ResidentPage } from './types.ts';

/** A page leaves residency: the change log and the sample both say so, wherever the
 *  departure came from. The slot is not returned here — the caller knows what it does with it. */
export function evictResident(
  context: GpuPageContext,
  page: ResidentPage,
  reason: 'capacity' | 'explicit-unload' | 'resize',
) {
  const { resident, pins, changeKeys, changeSlots, state } = context;
  resident.delete(page.key);
  pins.delete(page.key);
  context.eviction.lower.delete(page.key);
  changeKeys.push(page.key);
  changeSlots.push(-1);
  state.evictions++;
  context.reader.emit('gpu-page-eviction', 'Page removed from GPU residency', () => ({
    version: 1,
    key: page.key,
    slot: page.slot,
    generation: page.generation,
    bytes: page.bytes,
    reason,
    drawDetached: false,
  }));
}

/** The order's next resident, unpinned page, each entry passed once: one pinned when passed waits
 *  in `held` for its unpin; one a lower tier touched since the last order (`touch`) goes in `late`,
 *  taken after every other (#483 rules 1 and 7). */
function orderedVictim({ eviction, resident, pins }: GpuPageContext) {
  const { order, epoch, lower, held, late } = eviction;
  const free = (key: string) => (pins.has(key) ? undefined : resident.get(key));
  while (eviction.at < order!.count) {
    const key = order!.keyAt(eviction.at++);
    if (!resident.has(key)) continue;
    if ((lower.get(key) ?? -2) >= epoch - 1) late.push(key);
    else if (pins.has(key)) held.push(key);
    else return resident.get(key);
  }
  let page: ResidentPage | undefined;
  for (let i = 0; i < held.length && !page; i++) page = free(held[i]);
  while (!page && eviction.lateAt < late.length) page = free(late[eviction.lateAt++]);
  return page;
}

/** The least recently loaded or touched unpinned page; everything pinned is stated in O(1). */
function leastRecentVictim({ resident, pins }: GpuPageContext) {
  if (pins.size < resident.size)
    for (const page of resident.values()) if (!pins.has(page.key)) return page;
  return undefined;
}

/** Reserves a slot, evicts only an unpinned page, and uploads one complete fixed-size GPU slot. */
export function commitGpuPage(
  context: GpuPageContext,
  key: string,
  bytes: Uint8Array,
  requestStarted: number,
): ResidentPage {
  const { state, free, resident, pins, slots, changeKeys, changeSlots } = context;
  const { staging, device, buffer, pageBytes, reader } = context;
  const { emit, now, report } = reader;
  state.bytesRead += bytes.byteLength;
  let slot = free.pop();
  if (slot === undefined) {
    const ordered = !!context.eviction.order;
    const victim = ordered ? orderedVictim(context) : leastRecentVictim(context);
    if (!victim) {
      emit('gpu-page-admission-blocked', 'No evictable GPU slot', () => ({
        version: 1,
        key,
        reason: ordered ? 'eviction-queue-spent' : 'all-pages-pinned',
        resident: resident.size,
        slots,
        pinned: pins.size,
      }));
      throw new Error('ALL_PAGES_PINNED');
    }
    evictResident(context, victim, 'capacity');
    slot = victim.slot;
  }
  const uploadStarted = now();
  // A slot is the size of the scene's LARGEST cluster. Writing the whole slot would charge every
  // page — even a tiny one — a clear, a copy and a transfer of that size, while nothing ever
  // reads the slot's tail: a page-table row names its offset and triangle count, and the
  // visibility pass does not leave that range. Only the page's bytes go, padded to the multiple
  // of four that `writeBuffer` requires.
  const size = bytes.byteLength,
    padded = size + (size % 4 ? 4 - (size % 4) : 0);
  staging.set(bytes);
  if (padded !== size) staging.fill(0, size, padded);
  device.queue.writeBuffer(buffer, slot * pageBytes, staging, 0, padded);
  const uploadDurationMs = report ? performance.now() - uploadStarted : null;
  state.uploadedBytes += padded;
  const page = {
    key,
    slot,
    offset: slot * pageBytes,
    bytes: bytes.byteLength,
    generation: ++state.generation,
  };
  resident.set(key, page);
  changeKeys.push(key);
  changeSlots.push(page.offset / 4);
  emit('gpu-page-upload', 'Page written into a GPU slot', () => ({
    version: 1,
    key,
    slot,
    offset: slot * pageBytes,
    generation: page.generation,
    actualDataBytes: bytes.byteLength,
    uploadedBytes: padded,
    uploadDurationMs,
    gpuMs: null,
    drawDetached: false,
  }));
  emit('gpu-page-load-end', 'GPU load finished', () => ({
    version: 1,
    key,
    slot,
    generation: page.generation,
    actualDataBytes: bytes.byteLength,
    uploadedBytes: padded,
    durationMs: report ? performance.now() - requestStarted : null,
  }));
  return page;
}
