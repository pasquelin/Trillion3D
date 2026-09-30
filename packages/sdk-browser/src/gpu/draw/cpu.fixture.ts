import { exclusiveScan, packDrawIndirect } from '../../../../sdk-core/src/index.ts';
import { BASE_SLOTS, slotCount } from './contract.ts';

/** A row of the draw's page table as the CPU mirror and the tests write it (`struct DrawItem`,
 *  `contract.ts`). */
export type DrawItem = {
  pageIndex: number;
  bin: 0 | 1 | 2;
  rest: 0 | 1;
  selectionIndex?: number;
  layer?: number;
  triangles?: number;
};
/** What the CPU mirror of the compaction returns. */
type CompactResult = {
  instances: Uint32Array; // compacted pageIndex in input order
  bins: Uint32Array; // compacted bin
  rests: Uint32Array; // compacted rest flag
  counts: number[]; // (bin + 3*rest + 6*layer)
  indirect: Uint32Array; // one drawIndirect per slot, four u32 each
  overflow: boolean;
};

/** A slot is a cull mode, an occluder/tested half and a coplanar layer, in that order.
 *  CPU mirror of `slotOf` (shader.ts): same product, same sum, same layer cap.
 *  Two languages, two writings; `prefixEquivalence.test.ts` opposes them. */
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

/** DrawIndirect words with firstInstance=0. Compact still records exclusive-scan starts in word[3]. */
export function indirectForDraw(compact: CompactResult): Uint32Array {
  const words = compact.indirect.slice();
  for (let s = 0; s < compact.counts.length; s++) words[s * 4 + 3] = 0;
  return words;
}
