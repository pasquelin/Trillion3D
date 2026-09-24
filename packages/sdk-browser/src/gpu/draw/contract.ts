import type { LightRowMap } from './lightRows.ts';
import { MAX_DEPTH_LAYER } from '../../../../sdk-core/src/index.ts';

export const DRAW_INDIRECT_STRIDE = 16;
export const PAGE_BIND_ALIGN = 256;
export const BIN_BACK = 0,
  BIN_NONE = 1,
  BIN_FRONT = 2;
/** Slots of one coplanar layer: three cull modes × occluder-or-tested. */
export const BASE_SLOTS = 6;
export const UNIFORM_BYTES = 32,
  WORKGROUP = 64;
/**
 * u32 per draw record: the page-table row, its pipeline bin, its page index in the selection
 * catalogue, its coplanar layer, and its triangles. All five are properties of the ROW, never of
 * the frame: the GPU partition reads the last two to count its slots and weigh an occlusion
 * reject, without any per-frame walk gathering them.
 */
export const DRAW_ITEM_U32 = 5;
/** The draw record as every kernel that reads `items` declares it: `DRAW_ITEM_U32` words. */
export const DRAW_ITEM_WGSL =
  'struct DrawItem{pageIndex:u32,bin:u32,selectionIndex:u32,layer:u32,triangles:u32,}';
/**
 * Slots a compaction needs for `layerSlots` coplanar layers — one layer means the six slots this
 * path has always had, and a scene with no stacked coplanar surface asks for exactly that. Each
 * extra layer is its own set of six: its clusters are drawn by their own indirect command, with the
 * pipeline that carries their depth bias, and the clusters of layer 0 keep the order they had.
 */
export const slotCount = (layerSlots: number) => BASE_SLOTS * Math.max(1, layerSlots);
/** Slots of the tested half: the three face modes of each layer, after the occluders. */
export const restSlotCount = (layerSlots: number) => (BASE_SLOTS / 2) * layerSlots;
/** Slots the compact may have to name: every layer the cache format describes.
 *  Arrays sized once and for all refer to this; it costs a few hundred bytes and avoids
 *  reallocating when a scene carries layers. */
export const MAX_DRAW_SLOTS = slotCount(1 + MAX_DEPTH_LAYER);

export type DrawItem = {
  pageIndex: number;
  bin: 0 | 1 | 2;
  rest: 0 | 1;
  selectionIndex?: number;
  layer?: number;
  triangles?: number;
};
export type CompactResult = {
  instances: Uint32Array; // compacted pageIndex in input order
  bins: Uint32Array; // compacted bin
  rests: Uint32Array; // compacted rest flag
  counts: number[]; // (bin + 3*rest + 6*layer)
  indirect: Uint32Array; // one drawIndirect per slot, four u32 each
  overflow: boolean;
};
export type SlotLayout = {
  offsets: number[];
  rows: number[];
  tableRows: number;
};
export type GpuDraw = {
  /**
   * `items` holds packed rows of {pageIndex,bin,selectionIndex,layer,triangles}, the first `count`
   * of them drawn. Those five are properties of the page-table row and not of the frame, so only
   * the rows `[itemsFrom, itemsTo]` — the ones a page arriving, leaving or changing rank has just
   * rewritten, drawn or not — travel to the card; `itemsTo < itemsFrom` sends nothing. Nothing
   * here allocates.
   *
   * Each row's occluder/tested half (`restBits`) and each slot's row count (`slotUsed`) are no
   * longer uploaded: the GPU partition writes them into these same buffers, in the same command
   * buffer and before this pass. Without a partition they keep what their creation gave them —
   * no row in the tested half, every slot compacted.
   */
  encode(
    encoder: GPUCommandEncoder,
    items: Uint32Array,
    count: number,
    itemsFrom: number,
    itemsTo: number,
    maxVertexCount: number,
    selection?: { maskBuffer: GPUBuffer; maskOffset: number },
  ): void;
  /**
   * The page → row map a light cut's drawn pages are resolved through, created at the first call
   * for a catalogue of `pages` pages (`lightRows.ts`). The rows this draw's `encode` uploads are
   * the rows the map remaps.
   */
  lightRows(pages: number): LightRowMap;
  /** Draw records as the GPU holds them: what the GPU partition reads to know each
   *  row's bin, layer and triangles. */
  itemsBuffer: GPUBuffer;
  /** The frame's rest bits, one per row: what the GPU partition writes before the pass. */
  restBitsBuffer: GPUBuffer;
  /** Rows counted per indirect slot: what the GPU partition writes before the pass. */
  slotUsedBuffer: GPUBuffer;
  indirectBuffer: GPUBuffer; // slots × 16 bytes
  instanceBuffer: GPUBuffer; // slotCap u32 page indices, ordered
  slotOffsetsBuffer: GPUBuffer; // the per-slot group offsets locate each slot in instanceBuffer
  /** Slots this compaction was built for: `slotCount(layerSlots)`. */
  slots: number;
  dispose(): void;
};
