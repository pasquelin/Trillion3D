import { exclusiveScan, packDrawIndirect } from '../sdk-core/index.ts';
import { SLOTS, PAGE_BIND_ALIGN } from './gpuDrawContract.ts';
import type { DrawItem, CompactResult, SlotLayout } from './gpuDrawContract.ts';

function slotOf(item: DrawItem) {
  return item.rest * 3 + item.bin;
}

function emptyCompact(maxVertexCount: number, overflow: boolean): CompactResult {
  const counts: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const indirect = new Uint32Array(SLOTS * 4);
  for (let s = 0; s < SLOTS; s++) indirect.set(packDrawIndirect(maxVertexCount, 0), s * 4);
  return {
    instances: new Uint32Array(0),
    bins: new Uint32Array(0),
    rests: new Uint32Array(0),
    counts,
    indirect,
    overflow,
  };
}

/** Stable exclusive-scan compact into six (bin + 3*rest) drawIndirect slots. Overflow zeros instance counts. */
export function evaluateDrawCompact(
  items: DrawItem[],
  maxVertexCount: number,
  slotCap: number,
): CompactResult {
  if (items.length > slotCap) return emptyCompact(maxVertexCount, true);
  const n = items.length;
  const counts: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) counts[slotOf(items[i])]++;
  const [starts] = exclusiveScan(counts);
  const indirect = new Uint32Array(SLOTS * 4);
  for (let s = 0; s < SLOTS; s++) {
    const words = packDrawIndirect(maxVertexCount, counts[s]);
    words[3] = starts[s];
    indirect.set(words, s * 4);
  }
  const instances = new Uint32Array(n);
  const bins = new Uint32Array(n);
  const rests = new Uint32Array(n);
  const writePos = [starts[0], starts[1], starts[2], starts[3], starts[4], starts[5]];
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const slot = slotOf(item);
    const dst = writePos[slot]++;
    instances[dst] = item.pageIndex;
    bins[dst] = item.bin;
    rests[dst] = item.rest;
  }
  return {
    instances,
    bins,
    rests,
    counts,
    indirect,
    overflow: false,
  };
}

/** Pad each compact region so a storage bind offset is a multiple of `align` (WebGPU minStorageBufferOffsetAlignment). */
export function compactSlotLayout(
  counts: ArrayLike<number>,
  stride: number,
  align = PAGE_BIND_ALIGN,
): SlotLayout {
  const offsets: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  const rows: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  let bytes = 0,
    used = 0;
  for (let s = 0; s < SLOTS; s++) {
    if (bytes % align) bytes += align - (bytes % align);
    offsets[s] = bytes;
    rows[s] = stride ? bytes / stride : 0;
    bytes += counts[s] * stride;
    if (counts[s]) used = bytes;
  }
  return { offsets, rows, tableRows: Math.max(1, stride ? used / stride : 1) };
}

/** DrawIndirect words with firstInstance=0. Compact still records exclusive-scan starts in word[3]. */
export function indirectForDraw(compact: CompactResult): Uint32Array {
  const words = compact.indirect.slice();
  for (let s = 0; s < SLOTS; s++) words[s * 4 + 3] = 0;
  return words;
}
