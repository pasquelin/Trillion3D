import type { OpenPass } from '../core/lazyComputePass.ts'
import type { PendingGrowth } from '../core/tableGrowth.ts'
import { VIS_TRIANGLE_BITS } from '../../visibility/visWords.ts'
import { MAX_DEPTH_LAYER } from '../../../../sdk-core/src/index.ts'
import { ceilDiv, workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

export const DRAW_INDIRECT_STRIDE = 16
/** Corners an indirect instance launches at most: 32 triangles, three 32-lane vertex groups, the
 *  batch of a vertex-reuse raster: each vertex is shaded once for the triangles that share it. */
const BATCH_CORNERS = 96
/** An instance word: its page-table row, then its batch's first triangle in the identifier's
 *  triangle bits (`visWords.ts`). */
export const BATCH_SHIFT = 32 - VIS_TRIANGLE_BITS
/** The instance word's two halves, as every kernel reading an instance list decodes them. */
export const INSTANCE_WORD_WGSL = wgslBlock(
  'INSTANCE_WORD_WGSL',
  [],
  `fn instanceRow(word:u32)->u32{return word&${(1 << BATCH_SHIFT) - 1}u;}
fn instanceCorner(word:u32)->u32{return (word>>${BATCH_SHIFT}u)*3u;}`,
)
/**
 * The indirect draw's shape for a catalogue whose widest page has `maxCorners` corners: the corners
 * each instance launches, at most `BATCH_CORNERS`, and the instances a row takes at most.
 */
export function drawBatches(maxCorners: number) {
  const perRow = workgroupCount(maxCorners, BATCH_CORNERS)
  // The widest page in `perRow` equal batches of whole triangles: at most a triangle per batch over.
  return { corners: 3 * ceilDiv(ceilDiv(maxCorners, 3), perRow), perRow }
}
export const BIN_BACK = 0,
  BIN_NONE = 1,
  BIN_FRONT = 2
/**
 * The face modes a row's bin names: back, none, front. A cutout row's bin is its face mode's plus
 * this: its own slot, after the opaque ones of its half. An occluder slot, or a compacted tested
 * one, then draws its opaque rows with the stage that never discards — one cutout row does not
 * take the early depth reject from a whole slot —, and the depth they wrote rejects a hidden
 * cutout fragment before it reads its page.
 */
export const CULL_BINS = 3
/** Slots of one half — occluder or tested — of a coplanar layer: the face modes, then the same
 *  for cutout rows. */
export const HALF_SLOTS = 2 * CULL_BINS
/** Slots of one coplanar layer: the occluder half, then the tested half. */
export const BASE_SLOTS = 2 * HALF_SLOTS
export const UNIFORM_BYTES = 32,
  WORKGROUP = 64
/**
 * u32 per draw record: the page-table row, its bin (face mode, plus `CULL_BINS` on a cutout
 * row), its page index in the selection
 * catalogue, its coplanar layer, and its triangles. All five are properties of the ROW, never of
 * the frame: the GPU partition reads the last two to count its slots and weigh an occlusion
 * reject, without any per-frame walk gathering them.
 */
export const DRAW_ITEM_U32 = 5
/** The draw record as every kernel that reads `items` declares it: `DRAW_ITEM_U32` words. */
export const DRAW_ITEM_WGSL = wgslBlock(
  'DRAW_ITEM_WGSL',
  [],
  `struct DrawItem{pageIndex:u32,bin:u32,selectionIndex:u32,layer:u32,triangles:u32,}`,
)
/**
 * Slots a compaction needs for `layerSlots` coplanar layers — one layer means `BASE_SLOTS`, and a
 * scene with no stacked coplanar surface asks for exactly that. Each extra layer is its own set:
 * its clusters are drawn by their own indirect commands, with the pipelines that carry their depth
 * bias, and the clusters of layer 0 keep the order they had.
 */
export const slotCount = (layerSlots: number) => BASE_SLOTS * Math.max(1, layerSlots)
/** Slots of the tested half: the `HALF_SLOTS` bins of each layer, after the occluders. */
export const restSlotCount = (layerSlots: number) => HALF_SLOTS * layerSlots
/** Slots the compact may have to name: every layer the cache format describes.
 *  Arrays sized once and for all refer to this; it costs a few hundred bytes and avoids
 *  reallocating when a scene carries layers. */
export const MAX_DRAW_SLOTS = slotCount(1 + MAX_DEPTH_LAYER)

export type GpuDraw = {
  /**
   * `items` holds packed rows of {pageIndex,bin,selectionIndex,layer,triangles}. Those five are
   * properties of the page-table row and not of the frame, so only the rows `[from, to]` a page
   * arriving, leaving or changing rank has just rewritten, drawn or not, travel to the card, one
   * call per run of such rows. Nothing here allocates.
   */
  uploadItems(items: Uint32Array, from: number, to: number): void
  /**
   * Compacts the `count` rows the card holds into one indirect command per slot, as dispatches
   * of the frame's compute pass.
   *
   * Each row's occluder/tested half (`restBits`) and each slot's row count (`slotUsed`) are no
   * longer uploaded: the GPU partition writes them into these same buffers, by dispatches of the
   * same pass before these. Without a partition they keep what their creation gave them —
   * no row in the tested half, every slot compacted.
   */
  encode(
    open: OpenPass,
    count: number,
    selection?: { maskBuffer: GPUBuffer; maskOffset: number },
  ): void
  /** Row buffers for `rows` rows, made now and put in place by `commit` (`../core/tableGrowth.ts`). */
  grow(rows: number): PendingGrowth
  /** Draw records as the GPU holds them: what the GPU partition reads to know each
   *  row's bin, layer and triangles. */
  itemsBuffer: GPUBuffer
  /** The frame's rest bits, one per row: what the GPU partition writes before the pass. */
  restBitsBuffer: GPUBuffer
  /** Rows counted per indirect slot: what the GPU partition writes before the pass. */
  slotUsedBuffer: GPUBuffer
  indirectBuffer: GPUBuffer // slots × 16 bytes
  instanceBuffer: GPUBuffer // slotCap × perRow u32 instance words (row, batch), ordered
  slotOffsetsBuffer: GPUBuffer // the per-slot group offsets locate each slot in instanceBuffer
  /** Slots this compaction was built for: `slotCount(layerSlots)`. */
  slots: number
  /** Corners each instance launches, and instances a row takes at most (`drawBatches`). */
  corners: number
  perRow: number
  dispose(): void
}
