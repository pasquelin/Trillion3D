import { createSparseInts } from '../../page/cut/sparseInts.ts';
import { keyBase, poolBase, selectionListCap } from './layout.ts';
import { canonicalPage } from './evict.ts';
import type { PackedDag } from './types.ts';

/**
 * The keys the pool holds, as the eviction queue sweeps them (`shader/evictWgsl.ts`): a count, then
 * one canonical page per held slot, fed by the cache's arrivals and departures and kept dense — a
 * departure takes the last entry's place —, so the sweep is bounded by the slots, never the
 * catalogue (#483 rule 6). `note` returns whether the list moved.
 */
export function createDagPoolList(r: {
  device: GPUDevice;
  packed: PackedDag;
  pageCones: GPUBuffer;
}) {
  const { device, packed, pageCones } = r,
    { buffer, byteOffset, length } = packed.pageCones,
    words = new Uint32Array(buffer, byteOffset, length),
    base = poolBase(packed.pageCount),
    keys = keyBase(packed.pageCount),
    cap = selectionListCap(packed.pageCount);
  /** Each listed page's entry, 1 for the first. */
  const entry = createSparseInts();
  const write = (word: number) =>
    device.queue.writeBuffer(pageCones, word * 4, buffer as ArrayBuffer, byteOffset + word * 4, 4);
  const note = (page: number, held: boolean) => {
    const full = held && words[base] >= cap;
    if (canonicalPage(words[keys + page]) !== page || entry.has(page) === held || full)
      return false;
    const at = held ? ++words[base] : entry.set(page, 0),
      moved = held ? page : words[base + words[base]--];
    if (moved !== page || held) entry.set(moved, at);
    words[base + at] = moved;
    write(base + at);
    write(base);
    return true;
  };
  return { note, entry };
}
