import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { workgroupTallyWgsl } from '../../../gpu/core/workgroupTallyWgsl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'

/**
 * Memory layout the GPU partition shares with the Hi-Z test and with the host.
 *
 * Everything a frame decides row by row — projecting boxes into screen
 * rectangles, occluder/tested split, packing the occlusion-test bounds — is written by compute
 * kernels into these three buffers. The CPU rereads only `state`, and only on the periodic-
 * sample cadence.
 */

/**
 * Floats of a world box: eight corners, each in three coordinates carried by TWO single-
 * precision values — the rounded value and its residue.
 *
 * A corner alone in single precision carries an error of `u|x|`, and on a model whose
 * coordinates are tens of thousands that error dominates all others: the conservative bound
 * then yielded rectangles of several hundred texels. Two floats represent the original double
 * to within `u²`, and the gap to the anchor is computed without ever bringing world magnitude
 * into view: the bound becomes proportional to the cluster size again.
 */
export const CORNER_VALUES = 48

/**
 * Words per `rowData` row: the unclipped screen rectangle (four signed integers), the already-
 * corrected depth bound, and the flags. What a row held from the previous image is read before
 * this image overwrites it: that is the whole occluder history.
 */
export const ROW_DATA_U32 = 6
export const ROW_NEAREST = 4,
  ROW_FLAGS = 5
/** Bits of `rowData[ROW_FLAGS]`. */
export const FLAG_CLIP = 1,
  FLAG_PREV_REST = 2,
  FLAG_HISTORY = 4,
  /** The row's rectangle and depth were written by a projection: a row never projected — a new
   *  rank, a fresh buffer — carries nothing the previous image's pyramid could judge. */
  FLAG_PROJECTED = 8

/** A row's unclipped screen rectangle, its first four `rowData` words read as signed integers. */
export const ROW_RECT_WGSL = wgslBlock(
  'ROW_RECT_WGSL',
  [],
  `fn rowRect(base:u32)->vec4i{return vec4i(bitcast<i32>(rowData[base]),bitcast<i32>(rowData[base+1u]),
 bitcast<i32>(rowData[base+2u]),bitcast<i32>(rowData[base+3u]));}`,
)

/**
 * A tested box, the one table the partition writes it from (`classifyRows`) and the Hi-Z test
 * reads it through (`struct Bounds`): the rectangle already clipped to the viewport and expressed
 * in texels of the mip that covers it, the depth bound, the verdict row, the mip address, the
 * triangles whose count weighs a reject, and the address and shift of the coarse mip the test reads
 * first. Only a box the pyramid can judge is written: every field holds a found pick.
 */
export const TESTED_BOX = fieldLayout('Bounds', [
  ['minX', 'i32'],
  ['minY', 'i32'],
  ['maxX', 'i32'],
  ['maxY', 'i32'],
  ['nearest', 'f32'],
  ['row', 'u32'],
  ['fineOffset', 'u32'],
  ['fineWidth', 'u32'],
  ['triangles', 'u32'],
  ['coarseOffset', 'u32'],
  ['coarseWidth', 'u32'],
  ['coarseShift', 'u32'],
] as const)

/** Words of `state`: the frame counters, all atomic. */
export const STATE_WORDS = 16

/** Counters of `state`: what the frame decided and what the occlusion test then rejected. */
export const ST_TESTED = 0,
  ST_OCCLUDERS = 1,
  ST_HISTORY_OCCLUDERS = 2,
  /** Rows drawn last image that last image's pyramid withdrew from this image's occluders. */
  ST_WITHDRAWN = 3,
  ST_OVERSIZED = 4,
  ST_TESTED_TRIANGLES = 5,
  ST_OVERSIZED_TRIANGLES = 6,
  ST_REJECTED = 7,
  ST_REJECTED_TRIANGLES = 8,
  /** Box triangles of the voxel rows the cut draws, before the occlusion test: twelve a brick. */
  ST_VOXEL_TRIANGLES = 9

/** Words of `state` a workgroup tallies: up to the last counter, `ST_TESTED` left unused. */
const TALLY_WORDS = ST_VOXEL_TRIANGLES + 1
/**
 * The frame's counters, kept on a sampled frame only (`uni.counting`: the `countsDue` answer that
 * also encodes their copy, `counters.ts`), summed per workgroup (`workgroupTallyWgsl`) into
 * `state`. A module that holds `state` and a uniform `uni.counting` declares it. `ST_TESTED`, the
 * tested boxes' allocator, is never tallied.
 */
export const STATE_TALLY_WGSL = workgroupTallyWgsl(
  'STATE_TALLY_WGSL',
  TALLY_WORDS,
  'uni.counting!=0u',
  'atomicAdd(&state[lane],n);',
  ST_TESTED + 1,
)

/** Verdict of a row, one word per Hi-Z slot: the occluder half, the tested half the pyramid
 *  rejects, the tested half it keeps. The partition sets occluder and kept, the test brings some
 *  kept back to rejected; everything that draws — the tested half's compaction, the compute
 *  raster — reads this word, and a reader that would read two values loses clusters. */
export const VERDICT_OCCLUDER = 0,
  VERDICT_REJECTED = 1,
  VERDICT_KEPT = 2

/** Reject predicate, the same text in every module that binds `hizFlags`: a valid slot at the
 *  rejected verdict. Its negation is what draws. */
export const HIZ_REJECTED_WGSL = wgslBlock(
  'HIZ_REJECTED_WGSL',
  [NO_INDEX],
  `fn hizRejected(hizSlot:u32)->bool{return hizSlot!=NO_INDEX&&hizFlags[hizSlot]==${VERDICT_REJECTED}u;}`,
)

/** Bindings of the partition module, by name: the number `PARTITION_SHADER` declares each under. */
export const PARTITION_BINDING = {
  corners: 0,
  items: 1,
  flags: 2,
  rowData: 3,
  tested: 4,
  restBits: 5,
  state: 6,
  uniforms: 7,
  pyramid: 8,
  hizLevels: 9,
  selectionMask: 10,
} as const
/** What each kernel binds: each layout names only the resources its entry point reads or
 *  writes. */
export const PARTITION_KERNEL_BINDINGS = {
  clearRows: ['restBits', 'state', 'uniforms'],
  projectRows: [
    'corners',
    'items',
    'flags',
    'rowData',
    'state',
    'uniforms',
    'pyramid',
    'hizLevels',
  ],
  classifyRows: [
    'items',
    'flags',
    'rowData',
    'tested',
    'restBits',
    'state',
    'uniforms',
    'hizLevels',
    'selectionMask',
  ],
} as const satisfies Record<string, readonly (keyof typeof PARTITION_BINDING)[]>

/**
 * The frame's uniform, one table for the WGSL struct (`PARTITION_UNI_WGSL`) and its writer
 * (`uniform.ts`): view and view-projection, both ALREADY composed with the anchor translation;
 * the anchor in two single-precision values, with the near plane; then the scalars. The pyramid's
 * mip table is the Hi-Z levels uniform's (`hizMip`), bound beside it.
 */
export const PARTITION_UNI = fieldLayout('Uni', [
  ['view', 'mat4x4f'],
  ['viewProj', 'mat4x4f'],
  ['anchorHigh', 'vec3f'],
  ['near', 'f32'],
  ['anchorLow', 'vec3f'],
  ['rows', 'u32'],
  ['width', 'u32'],
  ['height', 'u32'],
  ['layerTop', 'u32'],
  ['hasRest', 'u32'],
  ['counting', 'u32'],
  ['selectionEnabled', 'u32'],
  ['selectionOffset', 'u32'],
] as const)
