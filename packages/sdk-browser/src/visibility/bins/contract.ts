import { VIS_TRIANGLE_BITS } from '../visWords.ts'
import { MAX_DEPTH_LAYER } from '../../../../sdk-core/src/lod/depthLayer.ts'
import { ceilDiv, workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DEPTH_BUCKETS } from '../raster/contract.ts'

/** Words of a hardware slot's draw command, and its bytes: the vertex count, the instance count, the
 *  first vertex and the first instance. */
const DRAW_INDIRECT_STRIDE = 16
/** Corners an indirect instance launches at most: 32 triangles, three 32-lane vertex groups, the
 *  batch of a vertex-reuse raster: each vertex is shaded once for the triangles that share it. */
const BATCH_CORNERS = 96
/** An instance word: its cluster's index in the list of visible clusters, then its batch's first
 *  triangle in the identifier's triangle bits (`../visWords.ts`). */
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
 * each instance launches, at most `BATCH_CORNERS`, and the instances a cluster takes at most.
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
 * The face modes a cluster's bin names: back, none, front. A cutout cluster's bin is its face
 * mode's plus this, a voxel cluster's plus twice this (`BIN_KINDS`): their own slots, after the
 * opaque ones of their half. A slot of either pass then draws its opaque clusters with the stage that
 * never reads a cutout, and the depth keys they wrote let a hidden cutout fragment leave before it
 * reads its page (`visPasses`); a voxel cluster, whose fragment traces its depth before it can
 * compare it, is drawn last.
 */
export const CULL_BINS = 3
/** The kinds of clusters a half's slots tell apart, in their order: opaque, cutout, voxel, then the
 *  clusters the software raster draws this image, whatever their kind, which the x-ray view
 *  alone draws by the hardware raster (`SOFTWARE_SLOTS`, `../passes/slotWalk.ts`): the
 *  hardware raster walks none of their slots. */
export const BIN_KIND = { OPAQUE: 0, CUTOUT: 1, VOXEL: 2, SOFTWARE: 3 } as const
export type BinKind = (typeof BIN_KIND)[keyof typeof BIN_KIND]
const BIN_KINDS = 4
/** Slots of one half — the main pass's, or the post pass's — of a coplanar layer: the face modes
 *  of each kind. */
export const HALF_SLOTS = BIN_KINDS * CULL_BINS
/** Slots of one coplanar layer: the main pass's half, then the post pass's. */
export const BASE_SLOTS = 2 * HALF_SLOTS
/** Bytes of the bins' uniform (`BinParams`, `./binsWgsl.ts`). */
export const BIN_UNIFORM_BYTES = 24
/** The bins' `indirect` buffer for `slots` slots: one command per slot. */
export const drawIndirectBytes = (slots: number) => slots * DRAW_INDIRECT_STRIDE
/**
 * Slots a bin needs for `layerSlots` coplanar layers — one layer means `BASE_SLOTS`, and a scene
 * with no stacked coplanar surface asks for exactly that. Each extra layer is its own set: its
 * clusters are drawn by their own indirect commands, their depth bias carried by their record
 * (`page.depthBias`, the visibility key), and the clusters of layer 0 keep the order they had.
 */
export const slotCount = (layerSlots: number) => BASE_SLOTS * Math.max(1, layerSlots)
/** Slots the bins may have to name: every layer the cache format describes. Arrays sized once and for
 *  all refer to this; it costs a few hundred bytes and avoids reallocating when a scene carries
 *  layers. */
export const MAX_DRAW_SLOTS = slotCount(1 + MAX_DEPTH_LAYER)

/**
 * The groups the bins count: every slot (hardware), then the software raster's clusters with no
 * cutout, those with one — ordered by depth bucket —, and the clusters the tessellation seeds from.
 */
export const binGroups = (slots: number) => ({
  /** The first software group: opaque clusters, in no order. */
  softwareOpaque: slots,
  /** The software cutout clusters, nearest depth bucket first. */
  softwareMasked: slots + 1,
  /** The clusters whose displaced surface the frame tessellates. */
  tessellated: slots + 2,
  total: slots + 3,
})

/**
 * The words of the bins' scratch buffer a pass counts in, from `binScratchBase` on (cleared before
 * each pass): per group its count, its base and its cursor, then, per group, `DEPTH_BUCKETS`
 * counters of the depth buckets of the clusters it orders. The head of the buffer, before them, is
 * the decode's (`../decode/contract.ts`).
 */
export function binScratch(slots: number) {
  const { total } = binGroups(slots)
  const count = 0,
    base = total,
    cursor = 2 * total,
    buckets = 3 * total
  return { count, base, cursor, buckets, words: buckets + total * DEPTH_BUCKETS }
}
