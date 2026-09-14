export const DRAW_INDIRECT_STRIDE = 16;
export const PAGE_BIND_ALIGN = 256;
export const BIN_BACK = 0,
  BIN_NONE = 1,
  BIN_FRONT = 2;
export const SLOTS = 6,
  UNIFORM_BYTES = 32,
  WORKGROUP = 64;
/** u32 per packed draw item: pageIndex (the page-table row), bin, selectionIndex, padding. */
export const DRAW_ITEM_U32 = 4;

export type DrawItem = { pageIndex: number; bin: 0 | 1 | 2; rest: 0 | 1; selectionIndex?: number };
export type CompactResult = {
  instances: Uint32Array; // compacted pageIndex in input order
  bins: Uint32Array; // compacted bin
  rests: Uint32Array; // compacted rest flag
  counts: [number, number, number, number, number, number]; // (bin + 3*rest)
  indirect: Uint32Array; // 6 * 4 u32, one drawIndirect per (bin, rest)
  overflow: boolean;
};
export type SlotLayout = {
  offsets: [number, number, number, number, number, number];
  rows: [number, number, number, number, number, number];
  tableRows: number;
};
export type GpuDraw = {
  /**
   * `items` holds `count` packed rows of {pageIndex,bin,selectionIndex,pad} and is uploaded only when
   * `itemsDirty`, because those three are properties of the page-table row and not of the frame.
   * `restBits` is the frame's occluder/rest partition, one bit per item; nothing here allocates.
   */
  encode(
    encoder: GPUCommandEncoder,
    items: Uint32Array,
    count: number,
    itemsDirty: boolean,
    restBits: Uint32Array,
    maxVertexCount: number,
    selection?: { maskBuffer: GPUBuffer; maskOffset: number },
  ): void;
  indirectBuffer: GPUBuffer; // 6 * 16 bytes
  instanceBuffer: GPUBuffer; // slotCap u32 page indices, ordered
  slotOffsetsBuffer: GPUBuffer; // first six group offsets locate each slot in instanceBuffer
  dispose(): void;
};
