import { MAX_SHADOW_SLICES, SHADOW_RECORD_FLOATS } from '../../../../sdk-core/src/index.ts';
import type { ShadowTable } from '../../../../sdk-core/src/scene/light-shadow/table.ts';
import { SHADOW_TABLE_ENTRIES } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
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

/**
 * THE BUFFER OF EVERY LIGHT'S RECORD THEN THE PAGE TABLE (`SHADOW_DATA_WGSL`), its table as long as
 * the slices claimed reach (`table.heldEntries`), as Unreal gives page-table entries only to the
 * shadow-casting lights in use: one sun holds one slice's span, not the 64 slices' 16 MiB. A light
 * whose slice reaches past it grows the buffer (`hold`): the new one takes the old one's words by a
 * copy submitted at once, before this frame's commands, which bind the new one (every reader takes
 * `buffer` each frame). The words past the table the host holds are never written: no slice reaches
 * them.
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
    /** Grows the buffer to hold `wanted` table words, its words kept; returns the bytes it grew. */
    hold(wanted: number) {
      if (wanted <= entries) return 0;
      const next = make(wanted),
        encoder = device.createCommandEncoder({ label: 'Trillion3D shadow page table growth' });
      encoder.copyBufferToBuffer(buffer, 0, next, 0, shadowDataBytes(entries));
      device.queue.submit([encoder.finish()]);
      buffer.destroy();
      buffer = next;
      const grown = (wanted - entries) * 4;
      entries = wanted;
      return grown;
    },
    /** Sends the table words `table` changed that the buffer holds: all of them, as no slice
     *  reaches past it. */
    writeWords(table: ShadowTable, first: number, count: number) {
      const held = Math.min(count, entries - first);
      if (held > 0)
        device.queue.writeBuffer(buffer, SHADOW_TABLE_OFFSET + first * 4, table.words, first, held);
    },
    destroy: () => buffer.destroy(),
  };
}
