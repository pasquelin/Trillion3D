import { exclusiveScan, packDrawIndirect } from '../sdk-core/src/index.ts';
import { BASE_SLOTS, PAGE_BIND_ALIGN, slotCount } from './gpuDrawContract.ts';
import type { DrawItem, CompactResult, SlotLayout } from './gpuDrawContract.ts';

/** A slot is a cull mode, an occluder/tested half and a coplanar layer, in that order.
 *  CPU mirror of `slotOf` (gpuDrawShader.ts): same product, same sum, same layer cap.
 *  Two languages, two writings; `gpuDrawPrefixEquivalence.test.ts` opposes them. */
function slotOf(item: DrawItem, layerSlots: number) {
  return item.rest * 3 + item.bin + BASE_SLOTS * Math.min(item.layer ?? 0, layerSlots - 1);
}

function emptyCompact(maxVertexCount: number, overflow: boolean, slots: number): CompactResult {
  const counts = new Array(slots).fill(0) as number[];
  const indirect = new Uint32Array(slots * 4);
  for (let s = 0; s < slots; s++) indirect.set(packDrawIndirect(maxVertexCount, 0), s * 4);
  return {
    instances: new Uint32Array(0),
    bins: new Uint32Array(0),
    rests: new Uint32Array(0),
    counts,
    indirect,
    overflow,
  };
}

/** Stable exclusive-scan compact into the (bin + 3*rest + 6*layer) drawIndirect slots. Overflow
 *  zeros instance counts. `layerSlots` is 1 for a scene with no stacked coplanar surface. */
export function evaluateDrawCompact(
  items: DrawItem[],
  maxVertexCount: number,
  slotCap: number,
  layerSlots = 1,
): CompactResult {
  const slots = slotCount(layerSlots);
  if (items.length > slotCap) return emptyCompact(maxVertexCount, true, slots);
  const n = items.length;
  const counts = new Array(slots).fill(0) as number[];
  for (let i = 0; i < n; i++) counts[slotOf(items[i], Math.max(1, layerSlots))]++;
  const [starts] = exclusiveScan(counts);
  const indirect = new Uint32Array(slots * 4);
  for (let s = 0; s < slots; s++) {
    const words = packDrawIndirect(maxVertexCount, counts[s]);
    words[3] = starts[s];
    indirect.set(words, s * 4);
  }
  const instances = new Uint32Array(n);
  const bins = new Uint32Array(n);
  const rests = new Uint32Array(n);
  const writePos = Array.from(starts);
  for (let i = 0; i < n; i++) {
    const item = items[i];
    const slot = slotOf(item, Math.max(1, layerSlots));
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
  const offsets = new Array(counts.length).fill(0) as number[];
  const rows = new Array(counts.length).fill(0) as number[];
  let bytes = 0,
    used = 0;
  for (let s = 0; s < counts.length; s++) {
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
  for (let s = 0; s < compact.counts.length; s++) words[s * 4 + 3] = 0;
  return words;
}
