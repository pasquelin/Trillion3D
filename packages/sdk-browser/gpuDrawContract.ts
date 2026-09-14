import { MAX_DEPTH_LAYER } from '../sdk-core/index.ts';

export const DRAW_INDIRECT_STRIDE = 16;
export const PAGE_BIND_ALIGN = 256;
export const BIN_BACK = 0,
  BIN_NONE = 1,
  BIN_FRONT = 2;
/** Slots of one coplanar layer: three cull modes × occluder-or-tested. */
export const BASE_SLOTS = 6;
export const UNIFORM_BYTES = 32,
  WORKGROUP = 64;
/** u32 per packed draw item: pageIndex (the page-table row), bin, selectionIndex, depth layer. */
export const DRAW_ITEM_U32 = 4;
/**
 * Slots a compaction needs for `layerSlots` coplanar layers — one layer means the six slots this
 * path has always had, and a scene with no stacked coplanar surface asks for exactly that. Each
 * extra layer is its own set of six: its clusters are drawn by their own indirect command, with the
 * pipeline that carries their depth bias, and the clusters of layer 0 keep the order they had.
 */
export const slotCount = (layerSlots: number) => BASE_SLOTS * Math.max(1, layerSlots);
/** Slots que la compaction peut avoir à nommer : toutes les couches que le format de cache décrit.
 *  Les tableaux dimensionnés une fois pour toutes s'y réfèrent ; cela coûte quelques centaines
 *  d'octets et évite de réallouer quand une scène porte des couches. */
export const MAX_DRAW_SLOTS = slotCount(1 + MAX_DEPTH_LAYER);

export type DrawItem = {
  pageIndex: number;
  bin: 0 | 1 | 2;
  rest: 0 | 1;
  selectionIndex?: number;
  layer?: number;
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
   * `items` holds `count` packed rows of {pageIndex,bin,selectionIndex,layer} and is uploaded only
   * when `itemsDirty`, because those four are properties of the page-table row and not of the frame.
   * `restBits` is the frame's occluder/rest partition, one bit per item; nothing here allocates.
   *
   * `slotItems` is what the caller counted per slot for this image — at least `slots` entries. A
   * slot it counted at zero is skipped entirely by the compaction, so a coplanar layer no cluster
   * of this batch or of this half reaches costs nothing. Omit it and every slot is compacted.
   */
  encode(
    encoder: GPUCommandEncoder,
    items: Uint32Array,
    count: number,
    itemsDirty: boolean,
    restBits: Uint32Array,
    maxVertexCount: number,
    selection?: { maskBuffer: GPUBuffer; maskOffset: number },
    slotItems?: Uint32Array,
  ): void;
  indirectBuffer: GPUBuffer; // slots × 16 bytes
  instanceBuffer: GPUBuffer; // slotCap u32 page indices, ordered
  slotOffsetsBuffer: GPUBuffer; // the per-slot group offsets locate each slot in instanceBuffer
  /** Slots this compaction was built for: `slotCount(layerSlots)`. */
  slots: number;
  dispose(): void;
};
