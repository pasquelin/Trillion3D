import type { TileLayout } from '../../texture/tiles.ts';
import {
  createWebgpuTilePageTable,
  PAGE_HEADER_WORDS,
  type WebgpuTilePageTable,
} from './pageTable.ts';

/**
 * An atlas's page table laid out again for `layouts` at `feedbackOffset` (#847): a texture was
 * appended to it, or the atlas before it grew. Each texture it held keeps its header words — tail
 * place, sampling, transform — and its entries — the tiles resident, the ancestors serving the
 * others —; only the head and the absolute level addresses move. The table is copied into a
 * buffer of its new size, sent whole, and the old one destroyed: every group naming it is rebuilt.
 */
export function regrownPageTable(
  device: Pick<GPUDevice, 'createBuffer' | 'queue'>,
  old: WebgpuTilePageTable,
  layouts: TileLayout[],
  options: { kind: 'color' | 'data'; feedbackOffset: number },
) {
  const table = createWebgpuTilePageTable(device, layouts, options),
    held = old.words;
  table.words.set(held.subarray(PAGE_HEADER_WORDS, held[3]), PAGE_HEADER_WORDS);
  table.words.set(held.subarray(held[2]), table.words[2]);
  device.queue.writeBuffer(table.buffer, 0, table.words);
  old.destroy();
  return table;
}
