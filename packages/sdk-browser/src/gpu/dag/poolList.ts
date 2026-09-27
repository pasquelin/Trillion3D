import { createSparseInts } from '../../page/cut/sparseInts.ts';
import { keyBase, poolBase, selectionListCap } from './layout.ts';
import { canonicalPage } from './evict.ts';
import type { PackedDag } from './types.ts';

/**
 * The keys the pool holds, as the eviction queue sweeps them (`shader/evictWgsl.ts`): a count, then
 * one canonical page per held slot, fed by the cache's own arrivals and departures and kept dense
 * by difference — an arrival appends, a departure takes the last entry's place. The sweep is thus
 * bounded by the pool's slots, never the catalogue (#483 rule 6). `note` returns whether it moved.
 */
export function createDagPoolList(resources: {
  device: GPUDevice;
  packed: PackedDag;
  pageCones: GPUBuffer;
}) {
  const { device, packed, pageCones } = resources,
    { buffer, byteOffset, length } = packed.pageCones,
    words = new Uint32Array(buffer, byteOffset, length);
  const base = poolBase(packed.pageCount),
    keys = keyBase(packed.pageCount),
    cap = selectionListCap(packed.pageCount);
  /** Each listed page's entry, 1 for the first. */
  const entry = createSparseInts();
  const write = (word: number) =>
    device.queue.writeBuffer(pageCones, word * 4, buffer as ArrayBuffer, byteOffset + word * 4, 4);
  const note = (page: number, held: boolean) => {
    if (canonicalPage(words[keys + page]) !== page || entry.has(page) === held) return false;
    if (held) {
      if (words[base] >= cap) return false;
      entry.set(page, ++words[base]);
      words[base + words[base]] = page;
      write(base + words[base]);
    } else {
      const at = entry.set(page, 0),
        last = words[base + words[base]--];
      if (last !== page) entry.set(last, at);
      words[base + at] = last;
      write(base + at);
    }
    write(base);
    return true;
  };
  return Object.defineProperty(note, 'hostBytes', {
    get: () => entry.byteLength,
  }) as typeof note & { readonly hostBytes: number };
}
