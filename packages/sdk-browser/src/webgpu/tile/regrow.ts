import { MAX_LEVELS, type TileLayout } from '../../texture/tiles.ts'
import {
  createWebgpuTilePageTable,
  PAGE_HEADER_WORDS,
  PAGE_SLOT_WORDS,
  type WebgpuTilePageTable,
} from './pageTable.ts'

/**
 * An atlas's page table laid out again for `layouts` at `feedbackOffset`: a texture was
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
  replaced = -1,
) {
  const table = createWebgpuTilePageTable(device, layouts, options),
    held = old.words
  for (let slot = 0; slot < Math.min(held[1], layouts.length); slot++) {
    if (slot === replaced) continue
    const header = PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS
    table.words.set(held.subarray(header, header + PAGE_SLOT_WORDS), header)
    const count = layouts[slot].entries
    if (!count) continue
    const oldStart = held[held[3] + slot * MAX_LEVELS]
    const newStart = table.words[table.words[3] + slot * MAX_LEVELS]
    table.words.set(held.subarray(oldStart, oldStart + count), newStart)
  }
  device.queue.writeBuffer(table.buffer, 0, table.words)
  old.destroy()
  return table
}
