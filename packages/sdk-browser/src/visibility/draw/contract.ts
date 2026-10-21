import type { OpenPass } from '../../gpu/core/lazyComputePass.ts'
import type { PendingGrowth } from '../../gpu/core/tableGrowth.ts'
import { VIS_TRIANGLE_BITS } from '../visWords.ts'
import { MAX_DEPTH_LAYER } from '../../../../sdk-core/src/lod/depthLayer.ts'
import { ceilDiv, workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'

const DRAW_INDIRECT_STRIDE = 16
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
 * this, a voxel row's plus twice this (`BIN_KINDS`): their own slots, after the opaque ones of
 * their half. A slot of either pass then draws its opaque rows with the stage that never reads a
 * cutout, and the depth keys they wrote let a hidden cutout fragment leave before it reads its page
 * (`visPasses`); a voxel row, whose fragment traces its depth before it can compare it, is drawn
 * last.
 */
export const CULL_BINS = 3
/** The kinds of rows a half's slots tell apart, in their order (`rowKind`): opaque, cutout,
 *  voxel, then the rows the software raster draws this image (`DrawItem.raster`), whatever
 *  their kind: the hardware raster walks none of their slots, the x-ray view walks them all
 *  (`../passes/drawer.ts`). */
export const BIN_KIND = { OPAQUE: 0, CUTOUT: 1, VOXEL: 2, SOFTWARE: 3 } as const
export type BinKind = (typeof BIN_KIND)[keyof typeof BIN_KIND]
const BIN_KINDS = 4
/** Slots of one half — the cut's main pass, the occluders, or its post pass, the tested rows — of
 *  a coplanar layer: the face modes of each kind. */
export const HALF_SLOTS = BIN_KINDS * CULL_BINS
/** Slots of one coplanar layer: the main pass's half, then the post pass's. */
export const BASE_SLOTS = 2 * HALF_SLOTS
export const UNIFORM_BYTES = 32
/**
 * The compaction's one `groups` buffer for `slotCap` rows and `slots` slots: two regions of
 * `entries` words, one per group of `WORKGROUP_THREADS` rows and slot (`group*slots+slot`). Each
 * group's offset at `[0, entries)`, first, where the raster reads a slot's first instance (group
 * 0's, `slotOffsets[slot]`); each group's count at `[entries, 2·entries)`. The host sizes the
 * buffer by `words` and sends `entries` as the kernels' `uni.groupEntries`: one formula, the
 * regions never drift from the allocation.
 */
export function drawGroupWords(slotCap: number, slots: number) {
  const entries = ceilDiv(slotCap, WORKGROUP_THREADS) * slots
  return { entries, words: 2 * entries }
}
/**
 * The compaction's `indirect` buffer for `slots` slots: one command per slot, then each slot's
 * total — between the count and the prefix of a run, zero otherwise — and where the occluder
 * half's instances end, `slots + 1` words the groups sum at once, the one atomic region.
 */
export const drawIndirectBytes = (slots: number) => slots * DRAW_INDIRECT_STRIDE + (slots + 1) * 4
/**
 * u32 per draw record: the page-table row, its bin (face mode, plus `CULL_BINS` times its kind:
 * one a cutout row, two a voxel row), its page index in the selection
 * catalogue, its coplanar layer, and its triangles — five properties of the ROW, never of the
 * frame: the compaction reads the layer and the triangles to name each row's slot and count its
 * batches (`./shader.ts`), without any per-frame walk gathering them. The sixth word, `raster`, is the
 * image's: which raster draws the row (`RASTER_HARDWARE`, `RASTER_SOFTWARE`), written by the
 * cluster split on the GPU before either compaction reads it (`../raster/binWgsl.ts`); the host
 * sends it as zero with the row's other words.
 */
export const DRAW_ITEM_U32 = 6
/** The draw record as every kernel that reads `items` declares it: `DRAW_ITEM_U32` words. */
export const DRAW_ITEM_WGSL = wgslBlock(
  'DRAW_ITEM_WGSL',
  [],
  `struct DrawItem{pageIndex:u32,bin:u32,selectionIndex:u32,layer:u32,triangles:u32,raster:u32,}`,
)
/** The two values of `DrawItem.raster`: the row's slot is its kind's, or its software bin. */
export const RASTER_HARDWARE = 0,
  RASTER_SOFTWARE = 1
/**
 * Slots a compaction needs for `layerSlots` coplanar layers — one layer means `BASE_SLOTS`, and a
 * scene with no stacked coplanar surface asks for exactly that. Each extra layer is its own set:
 * its clusters are drawn by their own indirect commands, their depth bias carried by their row
 * (`page.depthBias`, the visibility key), and the clusters of layer 0 keep the order they had.
 */
export const slotCount = (layerSlots: number) => BASE_SLOTS * Math.max(1, layerSlots)
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
   * Compacts the main pass's half of the `count` rows the card holds into one indirect command per
   * slot, as dispatches of the frame's compute pass, and writes the post slots empty: the rows the
   * cut's frame mask holds before its post pass (`selection.maskOffset`), every row without a cut.
   */
  encode(
    open: OpenPass,
    count: number,
    selection?: { maskBuffer: GPUBuffer; maskOffset: number },
  ): void
  /**
   * Compacts the post pass's half of the rows `encode` counted, once the cut's post pass wrote its
   * mask: the rows the post mask holds (`postMaskOffset`, a word of the mask buffer `encode`
   * bound). Encoded only in an image whose cut ran its post pass.
   */
  encodePost(open: OpenPass, postMaskOffset: number): void
  /** Row buffers for `rows` rows, made now and put in place by `commit` (`../../gpu/core/tableGrowth.ts`). */
  grow(rows: number): PendingGrowth
  /** Draw records as the GPU holds them: each row's bin, layer and triangles, which the compaction
   *  reads (`./shader.ts`), and its raster, which the cluster split writes
   *  (`../raster/binWgsl.ts`). */
  itemsBuffer: GPUBuffer
  /** One command per slot, then the slots' totals (`drawIndirectBytes`). */
  indirectBuffer: GPUBuffer
  instanceBuffer: GPUBuffer // slotCap × perRow u32 instance words (row, batch), ordered
  /** The `groups` buffer (`drawGroupWords`): the groups' offsets, then their counts. Its first
   *  `slots` words, group 0's offsets, locate each slot in `instanceBuffer`: the raster reads them
   *  there (`slotOffsets`). One binding for both keeps each half within the eight storage buffers
   *  a stage is guaranteed. */
  groupsBuffer: GPUBuffer
  /** Slots this compaction was built for: `slotCount(layerSlots)`. */
  slots: number
  /** Corners each instance launches, and instances a row takes at most (`drawBatches`). */
  corners: number
  perRow: number
  dispose(): void
}
