import { MAX_SHADOW_SLICES, SHADOW_RECORD_FLOATS } from '../../../../sdk-core/src/index.ts';
import {
  grownShadowEntries,
  type ShadowTable,
} from '../../../../sdk-core/src/scene/light-shadow/table.ts';
import { SHADOW_TABLE_ENTRIES } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { pendingBuffers } from '../core/tableGrowth.ts';
import { MAX_SHADOW_REGIONS } from './recordPack.ts';
import { SHADOW_FACE_STRIDE } from './batchBudget.ts';

/** Bytes of the records, before the page table in the same buffer: where the table starts. */
export const SHADOW_TABLE_OFFSET = MAX_SHADOW_SLICES * SHADOW_RECORD_FLOATS * 4;
/** Bytes of the records then a page table of `tableEntries` words, one buffer. */
const shadowDataBytes = (tableEntries: number) => SHADOW_TABLE_OFFSET + tableEntries * 4;
/** Bytes of the buffers beside the pool — faces, records, a table of `tableEntries` (`atlas.ts`). */
export const shadowBufferBytes = (tableEntries: number) =>
  MAX_SHADOW_REGIONS * (SHADOW_FACE_STRIDE + 4) + shadowDataBytes(tableEntries);
/** Those bytes with every slice's span: what the grant counts, the most the table holds. */
export const SHADOW_BUFFER_BYTES = shadowBufferBytes(SHADOW_TABLE_ENTRIES);

/** Sends `count` words of `table` from `first` into `data`'s page table, those it holds: the one
 *  clamp of every table write (`writeWords`, the GPU pool's `seed`). */
export function writeShadowTable(
  queue: GPUQueue,
  data: GPUBuffer,
  table: ShadowTable,
  first: number,
  count: number,
) {
  const held = Math.min(count, (data.size - SHADOW_TABLE_OFFSET) / 4 - first);
  if (held > 0) queue.writeBuffer(data, SHADOW_TABLE_OFFSET + first * 4, table.words, first, held);
}

/**
 * THE BUFFER OF EVERY LIGHT'S RECORD THEN THE PAGE TABLE (`SHADOW_DATA_WGSL`), its table as long as
 * the host's (`table.heldEntries`), as Unreal gives page-table entries only to the shadow-casting
 * lights in use: one sun holds one slice's span, not the 64 slices' 16 MiB. A slice past it waits
 * (`table.fits`) while the buffer grows by the tables' own path (`grow`, `pendingBuffers`): made
 * under the device's out-of-memory check, then put in place with the copy of the old one's words,
 * submitted with it, before any frame binds it (every reader takes `buffer` each frame).
 */
export function createShadowData(device: GPUDevice, tableEntries: number) {
  const make = (entries: number) =>
    device.createBuffer({
      label: 'Trillion3D shadow records and page table v1',
      size: shadowDataBytes(entries),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
  let entries = tableEntries,
    buffer = make(entries);
  return {
    get buffer() {
      return buffer;
    },
    /** Table words the buffer holds. */
    get entries() {
      return entries;
    },
    /** The buffer grown for `wanted` table words (`grownShadowEntries`), made now and put in place
     *  by `commit`, its words copied over, `adopted` told the bytes it grew; `undefined` when it
     *  holds them. */
    grow(wanted: number, adopted: (bytes: number) => void) {
      if (wanted <= entries) return undefined;
      const size = grownShadowEntries(entries, wanted, SHADOW_TABLE_ENTRIES),
        next = make(size);
      return pendingBuffers([next], () => {
        const old = buffer,
          encoder = device.createCommandEncoder({ label: 'Trillion3D shadow page table growth' });
        encoder.copyBufferToBuffer(old, 0, next, 0, old.size);
        device.queue.submit([encoder.finish()]);
        adopted((size - entries) * 4);
        [buffer, entries] = [next, size];
        return [old];
      });
    },
    /** Sends the table words `table` changed. */
    writeWords: (table: ShadowTable, first: number, count: number) =>
      writeShadowTable(device.queue, buffer, table, first, count),
    destroy: () => buffer.destroy(),
  };
}
