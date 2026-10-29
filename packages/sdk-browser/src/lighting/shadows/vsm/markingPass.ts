/**
 * Page marking (step 3): its dispatches recorded into the compute pass the caller opened, after the
 * physical page address update (`encodeVsmPageCarry`), in this order, each seeing
 * the writes of those before it:
 *   clear the page requests → clear the receiver cover → clear the raster marks (the pages' dirty
 *   flags) → init the page rect bounds → clear the page table and its flags (each clear a walk of the
 *   maps' pages, `vsmResetPageTableWgsl`) → prune the light grid → mark the coarse pages → generate
 *   the page marks from the pixels (GBuffer).
 * The caller clears the stats before the pass.
 * The light grid is pruned (`vsmPruneLightGrid`, `projection/lightGridWgsl.ts`) into the shadowed
 * lights' grid after the clears: the pixel and froxel passes walk only the lights that have a map, and stop at
 * the first single-page light, which the coarse marking marks; the projection reads the same grid.
 * Where the project traces the translucent surfaces' shadow (`shadowTranslucentQuality`) and a
 * translucent front layer is in hand (`VsmMarkingFront`), and where the single-layer water drew a depth
 * before the marking (`VsmMarkingView.water`), that pass is the program that also marks the suns'
 * pages of the surface that layer holds in front of each pixel, and of the water's surface.
 * The froxel marking marks the water's surface in a second pass of its own, the suns' pages alone
 * (`froxel/froxelMarking.ts`).
 *
 * Per-page passes (the page table clears) go through a per-page dispatcher: ids
 * binned by their finest mip level (`vsmCachePerPageBins`), uploaded into `res.perPageIds`, one dispatch per
 * non-empty bin, the bin's (offset, count, pitch, thread-per-id) in a dynamic-offset uniform.
 *
 * Pipelines are cached per device and per shader text; bind groups once per frame set (`res.current`,
 * the two in turn), the pixel pass's view group again only when a resource of the view moved.
 */
import { LIGHT_KIND } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { VSM_GROUP_WIDTH, VSM_MIPS, vsmWriteDepthFromDeviceZ } from './constants.ts'
import type { VsmCacheManager } from './cacheManager.ts'
import { copyMatrix4, negateColumnMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import { writeSplitDouble } from '../../../../../math/src/float/splitDouble.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  type VsmBindingSpec,
  vsmFrameSetHeld,
  vsmSpecGroup,
  type VsmResources,
  vsmPerFrameSet,
} from './resources.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { bufferEntry, resourceEntry } from '../../../gpu/bind/liveEntries.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../../../gpu/core/computeBindings.ts'
import { vsmComputePipe, type VsmComputePipe } from './passKit.ts'
import {
  VSM_SAMPLE_MARKING_BINDING,
  VSM_SAMPLE_MARKING_ENTRY,
  vsmSampleMarkingWgsl,
} from '../../manyLightsSampled/vsmSampleMarkingWgsl.ts'
import { SAMPLED_BINDINGS } from '../../manyLightsSampled/bindings.ts'
import {
  VSM_LIGHT_GRID_GROUP,
  VSM_PRUNE_BINDING,
  VSM_PRUNE_LIGHT_GRID_ENTRY,
  vsmPruneLightGridWgsl,
} from './projection/lightGridWgsl.ts'
import { writeChanged, writeChangedSlots } from '../../../gpu/core/writeChanged.ts'
import {
  VSM_CLEAR_RASTER_MARKS_SPECS,
  VSM_CLEAR_SPECS,
  VSM_COARSE_SPECS,
  VSM_INIT_RECT_SPECS,
  VSM_MARK_PIXELS_GROUP_XY,
  VSM_FRONT_DEPTH_BINDING,
  VSM_STRANDS_MARKING_BINDING,
  VSM_WATER_DEPTH_BINDING,
  VSM_MARKING_PARAMS_BYTES,
  VSM_PER_PAGE_GROUP_XY,
  VSM_PIXELS_SPECS,
  vsmResetPageTableWgsl,
  vsmPixelPageMarkingWgsl,
  vsmPageRectInitWgsl,
  vsmClearRasterMarksWgsl,
  vsmCoarseMarkingWgsl,
  vsmDenseMarkingWgsl,
  VSM_DENSE_ENTRY_WORDS,
  VSM_DENSE_GROUPS_ACROSS,
  vsmMarkingClears,
  type VsmClearStep,
} from './markingWgsl.ts'
import { DENSE_MAX_ENTRIES } from '../classic/denseEntries.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { uniformSlotBytes, uniformSlots, type UniformSlots } from '../../../session/memory/pools.ts'
import { dispatchGrid, dispatchRows } from '../../../gpu/dispatch/grid.ts'
import type { VsmLayout } from './layout.ts'
import type { VsmInputType } from './inputType.ts'
import type { HairShadowSource } from '../../../hair/viewGpu.ts'
import { HAIR_ALL_TILES_DISPATCH } from '../../../hair/visibilityMath.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { VSM_DEFAULT_SHADOWS } from './mapSettings.ts'
import {
  FROXEL_ARGS_ENTRY,
  FROXEL_ARGS_WGSL,
  FROXEL_BUILD_ENTRY,
  FROXEL_SCENE_BINDING,
  froxelBuildWgsl,
} from './froxel/froxelBuildWgsl.ts'
import {
  createFroxelMarking,
  type FroxelMarking,
  FROXEL_ARGS_LABEL,
  FROXEL_MARK_LABEL,
  froxelBuildLabel,
  type FroxelMarkContext,
  type FroxelPipes,
  type TablesGroup,
} from './froxel/froxelMarking.ts'
import { uniformBuffer } from '../../../gpu/core/uniformBlock.ts'
import { FROXEL_MARK_ENTRY, vsmFroxelPageMarkingWgsl } from './froxel/froxelMarkWgsl.ts'

// ---- The per-page dispatcher ------------------------------------------------------------------

/** Bins: 1 (8x8 groups), small (4x4), medium (1x1), and one thread per id (0). */
const VSM_PER_PAGE_BIN_GRID = [8, 4, 1, 0] as const
export const VSM_PER_PAGE_BIN_COUNT = 4

/** The bin of a map by its finest mip: the pages its walk covers. */
function vsmPerPageBin(finestMip: number) {
  if (finestMip < 6) return Math.floor(finestMip / 2)
  return VSM_PER_PAGE_BIN_COUNT - 1
}

export interface VsmPerPageBin {
  offset: number
  count: number
}

/** Both dispatchers of the marking pass, ids concatenated: all, then directional only. */
interface VsmPerPageBins {
  ids: Uint32Array<ArrayBuffer>
  all: VsmPerPageBin[]
  directionalOnly: VsmPerPageBin[]
}

/** One entry of the projection data upload loop. */
interface VsmPerPageEntry {
  id: number
  finestMip: number
  directional: boolean
}

/** Bins `count` of `entries` (only the directional ones when `directionalOnly`) into `bins`, their
 *  ids into `ids` from `base`, in bin order (a counting sort). */
function countingSort(
  entries: readonly VsmPerPageEntry[],
  count: number,
  directionalOnly: boolean,
  base: number,
  bins: VsmPerPageBin[],
  ids: Uint32Array,
) {
  for (const bin of bins) bin.count = 0
  for (let k = 0; k < count; k++) {
    const e = entries[k]
    if (!directionalOnly || e.directional) bins[vsmPerPageBin(e.finestMip)].count++
  }
  let offset = base
  for (const bin of bins) {
    bin.offset = offset
    offset += bin.count
    bin.count = 0
  }
  for (let k = 0; k < count; k++) {
    const e = entries[k]
    if (directionalOnly && !e.directional) continue
    const bin = bins[vsmPerPageBin(e.finestMip)]
    ids[bin.offset + bin.count++] = e.id
  }
}

const emptyBins = () =>
  Array.from({ length: VSM_PER_PAGE_BIN_COUNT }, () => ({ offset: 0, count: 0 }))

/** A frame's per-page entries and their bins, filled again frame after frame
 *  (`vsmCachePerPageBins`). */
export interface VsmPerPageFrame {
  entries: VsmPerPageEntry[]
  bins: VsmPerPageBins
}
export const vsmPerPageFrame = (): VsmPerPageFrame => ({
  entries: [],
  bins: { ids: new Uint32Array(0), all: emptyBins(), directionalOnly: emptyBins() },
})

/**
 * Builds and initialises both dispatchers over every map `cache` gives
 * projection data this frame, into `frame`: its entries rewritten in place, its
 * ids made again only when their number changed. Returns its bins.
 */
export function vsmCachePerPageBins(cache: VsmCacheManager, frame: VsmPerPageFrame) {
  const { entries, bins } = frame
  let count = 0,
    directional = 0
  for (const entry of cache.entries.values()) {
    if (entry.mapId < 0) continue
    const maps = entry.mapCaches
    for (let index = 0; index < maps.length; index++, count++) {
      const data = maps[index].projectionData,
        to = (entries[count] ??= { id: 0, finestMip: 0, directional: false })
      to.id = entry.mapId + index
      to.finestMip = data.finestMip
      to.directional = data.lightKind === LIGHT_KIND.directional
      if (to.directional) directional++
    }
  }
  if (bins.ids.length !== count + directional) bins.ids = new Uint32Array(count + directional)
  countingSort(entries, count, false, 0, bins.all, bins.ids)
  countingSort(entries, count, true, count, bins.directionalOnly, bins.ids)
  return bins
}

/** The thread-per-id bin's groups of 8 × 8, in rows past one dimension's (`dispatchRows`): its
 *  kernel ranks its threads of every row with `flatIndex` (`vsmMapWalkOf`). */
const threadPerIdGroups = (bin: VsmPerPageBin) => ceilDiv(bin.count, VSM_PER_PAGE_GROUP_XY ** 2)

/** Words of one bin's slot, the `VsmMapWalkParams` a per-page dispatch binds. */
export const VSM_PER_PAGE_BIN_WORDS = 4

/** Bin `b`'s `VsmMapWalkParams` words — offset, count, page-walk step (0 for the thread-per-id bin), thread per id —
 *  at `out[at]`. */
function vsmWritePerPageBinArgs(out: Uint32Array, at: number, bin: VsmPerPageBin, b: number) {
  const dim = VSM_PER_PAGE_BIN_GRID[b]
  out[at] = bin.offset
  out[at + 1] = bin.count
  out[at + 2] = dim * VSM_PER_PAGE_GROUP_XY
  out[at + 3] = dim === 0 ? 1 : 0
}

/** The slot of bin `b` of the `all` set, or of the directional-only one: the sets follow one another, `VSM_PER_PAGE_BIN_COUNT` slots each. */
export const perPageSlot = (directionalOnly: boolean, b: number) =>
  (directionalOnly ? VSM_PER_PAGE_BIN_COUNT : 0) + b

/** The per-page slots of `args` (laid as the buffer, `slots` apart) written for the bin sets `sets`, the `all`
 *  bins first and the directional-only ones after them: a bin a frame does not have holds zeros, the padding
 *  past a slot's words is never touched. The marking and the page management each write their own. */
export function vsmWritePerPageSlots(
  args: Uint32Array,
  slots: UniformSlots,
  sets: readonly (readonly VsmPerPageBin[])[],
) {
  for (let s = 0; s * VSM_PER_PAGE_BIN_COUNT < slots.count; s++) {
    const set = sets[s] ?? []
    for (let b = 0; b < VSM_PER_PAGE_BIN_COUNT; b++) {
      const at = perPageSlot(s === 1, b) * slots.strideWords
      if (b < set.length) vsmWritePerPageBinArgs(args, at, set[b], b)
      else args.fill(0, at, at + slots.words)
    }
  }
}

/** Bin `b`'s dispatch: `dim`² groups per id, or one thread per id for the last bin. The ids of
 *  a grouped bin run along z in rows past one dimension's (`dispatchGrid`), each row `dim` groups
 *  up y: its kernel ranks a map by its row and z (`vsmMapWalkOf`). */
export function vsmDispatchPerPageBin(pass: GPUComputePassEncoder, bin: VsmPerPageBin, b: number) {
  const dim = VSM_PER_PAGE_BIN_GRID[b]
  if (dim === 0) dispatchRows(pass, threadPerIdGroups(bin))
  else {
    const [z, rows] = dispatchGrid(bin.count)
    pass.dispatchWorkgroups(dim, dim * rows, z)
  }
}

// ---- Map view looking down +z ----------------------------------------------------------------

/**
 * The view-to-clip of a view looking down +z (w = its depth) from the engine's projection of a
 * right-handed view looking down −z (WebGPU depth range): P · diag(1, 1, −1, 1), its third column
 * negated, column-major as the engine's.
 */
export function vsmForwardZViewToClip(projection: ArrayLike<number>, out = new Float32Array(16)) {
  return negateColumnMatrix4(out, projection, 2)
}

// ---- Pass inputs -------------------------------------------------------------------------------

/** What the per-pixel marking reads of the engine's frame (the shadow demand pass's inputs). */
export interface VsmMarkingView {
  depth: GPUTextureView
  normalRough: GPUTextureView
  flags: GPUTextureView
  /** The deferred pass's `View` uniform (VIEW_WGSL). */
  view: GPUBuffer
  directLights: GPUBuffer
  tileLights: GPUBuffer
  /** The shadowed lights' grid the pruning of `tileLights` writes and the passes walk in its place, as
   *  long as the light grid's view part (`vsmLightGridFor`), over `gridCells` cells (columns × depth
   *  slices). */
  lightGrid: GPUBuffer
  gridCells: number
  /** i32 per `directLights.items` entry: its VSM id (first face for a point light), −1 for none. */
  lightVsmIds: GPUBuffer
  /** The u32 ids of this view's directional (clipmap) maps. */
  sunMapIds: GPUBuffer
  sunMapCount: number
  viewRectMin: [number, number]
  viewSize: [number, number]
  /** The +z-forward view-to-clip (`vsmForwardZViewToClip`). */
  viewToClip: ArrayLike<number>
  /** The matrix from the view's space to the shifted one (`froxel/froxelView.ts`), the froxel marking's. */
  viewToShifted: ArrayLike<number>
  /** The map view's origin shift (−camera position), double precision, split high/low. */
  originShift: [number, number, number]
  /** The translucent front layer, where the pass marks from it (`vsmPixelPageMarkingWgsl` `front`);
   *  none: the program without it runs. */
  front?: VsmMarkingFront
  /** The scene's depth with the single-layer water drawn into it, where the pass marks the water's
   *  surface (`vsmPixelPageMarkingWgsl` `water`); none: the program without it runs. */
  water?: GPUTextureView
  /** The hair strands of the view, where it holds valid ones: their pages are marked after the
   *  surfaces', from either the pixels or the froxels (`vsmPixelPageMarkingWgsl` input `strands`). */
  hair?: HairShadowSource
  /** The sampled lighting's samples, where it lights the view with the maps' pages marked from them alone (`sampledLightsVsmMarkPages`): the pixel pass then
   *  leaves the local lights out and the sample pass marks their pages (`vsmSampleMarkingWgsl.ts`). */
  samples?: VsmMarkingSamples
  /** The same for the nearest translucent layer's samples, which stand on the layer's depth (`sampledLightsFrontLayer`): its lights' pages are marked too. */
  frontSamples?: VsmMarkingFrontSamples
}

/** The samples the marking marks the local lights' pages from. */
export interface VsmMarkingSamples {
  /** The samples' texture (`r32uint`), and the sampled lighting's uniform. */
  texture: GPUTextureView
  params: GPUBuffer
  /** The groups across and down: the samples' size over the group's side. */
  workgroups: readonly [number, number]
}

/** The samples of the nearest translucent layer, and the depth of the layer they stand on. */
export interface VsmMarkingFrontSamples extends VsmMarkingSamples {
  depth: GPUTextureView
}

/** The translucent front layer, as the marking reads it: the image before's, or the image's own. */
export interface VsmMarkingFront {
  /** The Hi-Z's level 0, both layers (`HIZ_FRONT_LAYER`): zero depth where no translucent surface lay. */
  depth: GPUTextureView
  /** Whether the layer is this image's own, drawn before the marking: read at the pixel, with no
   *  reprojection; else the image before's. */
  sameImage: boolean
  /** The view-projection of the image before, referred to this image's eye (`matrixAtRenderOrigin`),
   *  column-major. */
  previousViewProjection: Float64Array
  /** The size that image drew its layer at. */
  size: [number, number]
}

export interface VsmMarkingFrame {
  /** The frame's slots: ids [0, mapCount). */
  mapCount: number
  /** The maps claimed (`VsmMapIds.claimedCount`), the first `singleMaps` of them at the ids [0, singleMaps), the others from the id
   *  `VSM_MAX_SINGLE_PAGE_MAPS`: the marking's kernels that walk the maps walk these. */
  claimed: number
  singleMaps: number
  perPage: VsmPerPageBins
  /** The camera's kind as the engine knows it, never a matrix test (`projection/projectionPass.ts`). */
  perspective: boolean
  /** Absent: no pixel marking (pixel page marking off). */
  view?: VsmMarkingView
  /** The view's shadow settings the marking reads (the page dilation, the pixel stride, the
   *  backface cull); absent, every default. */
  settings?: ShadowValues
  /** The pages of the classic shadow maps (`shadowVirtualEnable` off) to ask for, `count` entries of `VSM_DENSE_ENTRY_WORDS` words in `words`
   *  (`denseEntries.ts`); absent, none. */
  dense?: { readonly words: Uint32Array<ArrayBuffer>; readonly count: number }
  /** Whether the compute throttle runs this frame: the programs that read each map's own bias. */
  throttled?: boolean
  /** Encoded into the pass between the page rects' initialisation and the clear of the page tables: the compute throttle. */
  afterRects?: (pass: GPUComputePassEncoder) => void
}

// ---- Pipelines (cached per device) ------------------------------------------------------------

// ---- Pipes -------------------------------------------------------------------------------------

/** The labels of the marking's kernels, their pipes' and groups' alike. */
const RECT_LABEL = 'vsm.initPageRects',
  RASTER_MARKS_LABEL = 'vsm.clearRasterMarks',
  COARSE_LABEL = 'vsm.markCoarse',
  DENSE_LABEL = 'vsm.markDense',
  PRUNE_LABEL = 'vsm.pruneLightGrid',
  PIXELS_LABEL = 'vsm.markPagesFromPixels'
/** The pixel pass's programs, by the layers they mark (the translucent front layer's marks bit 0, the
 *  water's bit 1), or none, over the surfaces; and the one over the hair strands (input `strands`). */
const PIXELS_VARIANTS = ['pixels', 'pixelsFront', 'pixelsWater', 'pixelsFrontWater'] as const
type PixelsVariant = (typeof PIXELS_VARIANTS)[number] | 'pixelsStrands'
/** The index of the variant that marks the `front` layer and the `water`. */
const pixelsIndex = (front: boolean, water: boolean) => (front ? 1 : 0) | (water ? 2 : 0)
/** The variant of the pixel pass of `input` that marks the `front` layer and the `water` (the
 *  strands' marks neither). */
const pixelsVariant = (
  front: boolean,
  water: boolean,
  input: VsmInputType = 'gbuffer',
): PixelsVariant =>
  input === 'strands' ? 'pixelsStrands' : PIXELS_VARIANTS[pixelsIndex(front, water)]
/** The label of that variant's pipe and groups: the pass's, the variant's name past `pixels` (a
 *  suffix for each layer it marks, or the strands'); made where a pipe or group is, not each frame. */
const pixelsLabel = (
  front: boolean,
  water: boolean,
  throttled = false,
  input: VsmInputType = 'gbuffer',
) =>
  PIXELS_LABEL +
  pixelsVariant(front, water, input).slice('pixels'.length) +
  (throttled ? 'Throttled' : '')
/** The key of a variant's pipe in `held`: the compute throttle's programs (`throttled`) are pipes of their
 *  own, the frame picks the pair it runs; their bind groups are the plain ones' (same bindings). */
const pixelsPipeKey = (front: boolean, water: boolean, throttled: boolean, input: VsmInputType) =>
  throttled
    ? (`${pixelsVariant(front, water, input)}Throttled` as const)
    : pixelsVariant(front, water, input)

/** The bind group layouts of the marking's kernels, the entries of the group past the tables'. */
const clearGroups = (tables: GPUBindGroupLayoutEntry[], written: readonly unknown[]) => [
  [
    ...tables,
    computeUniformEntry(3, { hasDynamicOffset: true }),
    ...written.map((_, n) => computeBufferEntry(4 + n, 'storage')),
  ],
]
const froxelBuildGroups = (water: boolean) => [
  [
    computeTextureEntry(0, 'depth'),
    computeUniformEntry(1),
    computeBufferEntry(2, 'storage'),
    ...(water ? [computeTextureEntry(FROXEL_SCENE_BINDING, 'depth')] : []),
  ],
]
const froxelArgsGroups = () => [
  [computeUniformEntry(0), computeBufferEntry(1, 'storage'), computeBufferEntry(2, 'storage')],
]
/** The layout entries the froxel and pixel marking passes share past their own: the view (3), the lights' buffers (4 to 7) and the marking's parameters (8). */
const lightsLayout = () => [
  computeUniformEntry(3),
  computeBufferEntry(4, 'read-only-storage'),
  computeBufferEntry(5, 'read-only-storage'),
  computeBufferEntry(6, 'read-only-storage'),
  computeBufferEntry(7, 'read-only-storage'),
  computeUniformEntry(8),
]
const froxelMarkGroups = (tables: GPUBindGroupLayoutEntry[]) => [
  tables,
  [computeUniformEntry(0), computeBufferEntry(1, 'read-only-storage'), ...lightsLayout()],
]
const pixelsGroups = (
  tables: GPUBindGroupLayoutEntry[],
  front: boolean,
  water: boolean,
  input: VsmInputType,
) => [
  tables,
  [
    ...(input === 'strands'
      ? [
          computeTextureEntry(VSM_STRANDS_MARKING_BINDING.hairDepth, 'unfilterable-float'),
          // A uniform: with the tables and the lights, the pass holds the eight storage buffers a stage
          // is given at least.
          computeUniformEntry(VSM_STRANDS_MARKING_BINDING.counts),
          computeBufferEntry(VSM_STRANDS_MARKING_BINDING.tiles, 'read-only-storage'),
        ]
      : [
          computeTextureEntry(0, 'depth'),
          computeTextureEntry(1, 'unfilterable-float'),
          computeTextureEntry(2, 'uint'),
        ]),
    ...lightsLayout(),
    ...(front
      ? [computeTextureEntry(VSM_FRONT_DEPTH_BINDING, 'unfilterable-float', '2d-array')]
      : []),
    ...(water ? [computeTextureEntry(VSM_WATER_DEPTH_BINDING, 'depth')] : []),
  ],
]

/** The pipes the marking has made so far, by name. */
type HeldPipes = Partial<
  Record<
    | VsmClearStep
    | 'prune'
    | 'rasterMarks'
    | 'rect'
    | 'coarse'
    | 'dense'
    | PixelsVariant
    | `${PixelsVariant}${'' | 'Throttled'}${'' | 'NoLocals'}`
    | 'samples'
    | 'samplesThrottled'
    | 'froxelBuild'
    | 'froxelWaterBuild'
    | 'froxelArgs'
    | 'froxelMark'
    | 'froxelMarkThrottled',
    VsmComputePipe
  >
>

/** The key of the froxel build of the scene's froxels, or of the water's, in `held`. */
const froxelBuildVariant = (water: boolean) => (water ? 'froxelWaterBuild' : 'froxelBuild')

/** The froxels' build — the scene's and, over the water's depth, the water's —, the arguments of the
 *  marking over them and the marking itself (`froxel/`), where the view marks the pages from the
 *  froxels; each made when first asked, into `held`. */
const froxelMarkingPipes = (
  device: GPUDevice,
  layout: VsmLayout,
  held: HeldPipes,
): FroxelPipes => ({
  froxelBuild: (water = false) =>
    (held[froxelBuildVariant(water)] ??= vsmComputePipe(
      device,
      froxelBuildLabel(water),
      froxelBuildWgsl(water),
      FROXEL_BUILD_ENTRY,
      froxelBuildGroups(water),
    )),
  froxelArgs: () =>
    (held.froxelArgs ??= vsmComputePipe(
      device,
      FROXEL_ARGS_LABEL,
      FROXEL_ARGS_WGSL,
      FROXEL_ARGS_ENTRY,
      froxelArgsGroups(),
    )),
  froxelMark: (throttled = false) =>
    (held[throttled ? 'froxelMarkThrottled' : 'froxelMark'] ??= vsmComputePipe(
      device,
      throttled ? `${FROXEL_MARK_LABEL}Throttled` : FROXEL_MARK_LABEL,
      vsmFroxelPageMarkingWgsl(layout, throttled),
      FROXEL_MARK_ENTRY,
      froxelMarkGroups(vsmBindGroupLayoutEntries(VSM_PIXELS_SPECS, COMPUTE)),
    )),
})

type MarkingEntries = (
  specs: readonly VsmBindingSpec[],
) => ReturnType<typeof vsmBindGroupLayoutEntries>

/** The marking's small passes: the raster marks' clear, the light grid's pruning, the page rects, the coarse and the dense marking. */
function utilityPipes(
  device: GPUDevice,
  layout: VsmLayout,
  held: HeldPipes,
  entries: MarkingEntries,
) {
  return {
    /** The raster marks' clear. */
    rasterMarks: () =>
      (held.rasterMarks ??= vsmComputePipe(
        device,
        RASTER_MARKS_LABEL,
        vsmClearRasterMarksWgsl(layout),
        'vsmClearRasterMarks',
        [entries(VSM_CLEAR_RASTER_MARKS_SPECS)],
      )),
    /** The pruning of the light grid into the shadowed lights' grid. */
    prune: () =>
      (held.prune ??= vsmComputePipe(
        device,
        PRUNE_LABEL,
        vsmPruneLightGridWgsl(),
        VSM_PRUNE_LIGHT_GRID_ENTRY,
        [
          [
            computeUniformEntry(VSM_PRUNE_BINDING.view),
            computeBufferEntry(VSM_PRUNE_BINDING.directLights, 'read-only-storage'),
            computeBufferEntry(VSM_PRUNE_BINDING.tileLights, 'read-only-storage'),
            computeBufferEntry(VSM_PRUNE_BINDING.lightGrid, 'storage'),
          ],
        ],
      )),
  }
}

/** The marking's page rects, coarse and dense passes. */
function pagePipes(device: GPUDevice, layout: VsmLayout, held: HeldPipes, entries: MarkingEntries) {
  return {
    rect: () =>
      (held.rect ??= vsmComputePipe(
        device,
        RECT_LABEL,
        vsmPageRectInitWgsl(layout),
        'vsmInitPageRects',
        [[...entries(VSM_INIT_RECT_SPECS), computeUniformEntry(4)]],
      )),
    coarse: () =>
      (held.coarse ??= vsmComputePipe(
        device,
        COARSE_LABEL,
        vsmCoarseMarkingWgsl(layout),
        'vsmMarkCoarse',
        [[...entries(VSM_COARSE_SPECS), computeUniformEntry(4)]],
      )),
    /** The dense marking of the classic shadow maps, made when the first frame with `shadowVirtualEnable` off asks for it. */
    dense: () =>
      (held.dense ??= vsmComputePipe(
        device,
        DENSE_LABEL,
        vsmDenseMarkingWgsl(layout),
        'vsmMarkDense',
        [
          [...entries(VSM_COARSE_SPECS), computeUniformEntry(4)],
          [computeBufferEntry(0, 'read-only-storage')],
        ],
      )),
  }
}

/** The pixel pass and the samples' marking. */
function pixelPipes(
  device: GPUDevice,
  layout: VsmLayout,
  held: HeldPipes,
  entries: MarkingEntries,
) {
  return {
    /** The pixel pass; `front`, `water`, `throttled` and the `input` (`inputType.ts`) pick its program. */
    pixels: (
      front = false,
      water = false,
      throttled = false,
      input: VsmInputType = 'gbuffer',
      locals = true,
    ) =>
      (held[
        `${pixelsPipeKey(front, water, throttled, input)}${locals ? '' : 'NoLocals'}` as keyof HeldPipes
      ] ??= vsmComputePipe(
        device,
        pixelsLabel(front, water, throttled, input) + (locals ? '' : 'NoLocals'),
        vsmPixelPageMarkingWgsl(layout, front, water, throttled, input, locals),
        'vsmMarkPagesFromPixels',
        pixelsGroups(entries(VSM_PIXELS_SPECS), front, water, input),
      )),
    /** The marks of the local lights' pages from the sampled lighting's samples. */
    samples: (throttled = false) =>
      (held[throttled ? 'samplesThrottled' : 'samples'] ??= vsmComputePipe(
        device,
        'vsm.markSamples',
        vsmSampleMarkingWgsl(layout, throttled),
        VSM_SAMPLE_MARKING_ENTRY,
        [
          entries(VSM_PIXELS_SPECS),
          [
            computeTextureEntry(VSM_SAMPLE_MARKING_BINDING.depth, 'depth'),
            computeUniformEntry(VSM_SAMPLE_MARKING_BINDING.view),
            computeBufferEntry(VSM_SAMPLE_MARKING_BINDING.directLights, 'read-only-storage'),
            computeBufferEntry(VSM_SAMPLE_MARKING_BINDING.lightIds, 'read-only-storage'),
            computeBufferEntry(VSM_SAMPLE_MARKING_BINDING.sunIds, 'read-only-storage'),
            computeUniformEntry(VSM_SAMPLE_MARKING_BINDING.marking),
            computeUniformEntry(SAMPLED_BINDINGS.params),
            computeTextureEntry(VSM_SAMPLE_MARKING_BINDING.samples, 'uint'),
          ],
        ],
      )),
  }
}

/** The marking's pipes for `layout` (`vsmComputePipe`: made once a device and source), each made
 *  when first asked and kept: its WGSL is built and hashed the first time only. */
export function vsmMarkingPipes(device: GPUDevice, layout: VsmLayout) {
  const entries = (specs: readonly VsmBindingSpec[]) => vsmBindGroupLayoutEntries(specs, COMPUTE)
  const clears = vsmMarkingClears(layout)
  const held: HeldPipes = {}
  const clear = (step: VsmClearStep) =>
    (held[step] ??= vsmComputePipe(
      device,
      `vsm.resetPageTable(${step})`,
      vsmResetPageTableWgsl(clears[step].targets, layout),
      'vsmClearPageTables',
      clearGroups(entries(VSM_CLEAR_SPECS), clears[step].targets),
    ))
  return {
    /** The tables each clear clears and the maps it walks (`vsmMarkingClears`). */
    clears,
    /** The clear `step`; none when it clears no table. */
    clear: (step: VsmClearStep) => (clears[step].targets.length ? clear(step) : undefined),
    ...utilityPipes(device, layout, held, entries),
    ...pagePipes(device, layout, held, entries),
    ...froxelMarkingPipes(device, layout, held),
    ...pixelPipes(device, layout, held, entries),
  }
}

// ---- Marking object ----------------------------------------------------------------------------

export interface VsmMarking {
  /** Records the marking's dispatches into `pass` (uniform/id uploads go through the queue). */
  encode(pass: GPUComputePassEncoder, frame: VsmMarkingFrame): void
  destroy(): void
}

const DISPATCHERS = 2
/** A pixel stride of the marking, held to [1, 128] as the setting's own range. */
const markStride = (stride: number) => clamp(stride, 1, 128)
/** The marking's groups over the tables of a frame set (`vsmPerFrameSet`), made as asked. */
interface TableGroups {
  clear: Partial<Record<VsmClearStep, GPUBindGroup>>
  rasterMarks?: GPUBindGroup
  rect?: GPUBindGroup
  coarse?: GPUBindGroup
  dense?: GPUBindGroup
  pixels: Partial<Record<PixelsVariant, GPUBindGroup>>
  samples?: GPUBindGroup
  froxelMark?: GPUBindGroup
}
const newTableGroups = (): TableGroups => ({ clear: {}, pixels: {} })
/** The per-page dispatch slots: all then directional-only bins (`resetPageTables`). */
const PER_PAGE_SLOTS = DISPATCHERS * VSM_PER_PAGE_BIN_COUNT
/** Bytes a marking holds on a device of `limits`: its parameters and its per-page dispatch slots,
 *  the device's `uniformStride` apart (`createVsmMarking`). */
export const vsmMarkingBytes = (limits: { minUniformBufferOffsetAlignment?: number }) =>
  VSM_MARKING_PARAMS_BYTES + uniformSlotBytes(limits, PER_PAGE_SLOTS)

/** The marking's parameters of `frame`, laid as the uniform: `f` and `u` are the two views of its
 *  words. */
function fillMarkingParams(f: Float32Array, u: Uint32Array, frame: VsmMarkingFrame) {
  f.fill(0)
  const v = frame.view
  const s = frame.settings ?? VSM_DEFAULT_SHADOWS
  f[50] = s.shadowPageDilationBorderSizeDirectional
  f[51] = s.shadowPageDilationBorderSizeLocal
  u[52] = markStride(s.shadowPageMarkingPixelStrideX)
  u[53] = markStride(s.shadowPageMarkingPixelStrideY)
  u[54] = s.shadowCullBackfacingPixels ? 1 : 0
  f[55] = s.shadowFirstPersonPixelRequestBias
  u[56] = s.shadowFirstPersonRequestMinLevelClamp
  if (v) {
    copyMatrix4(f, v.viewToClip)
    vsmWriteDepthFromDeviceZ(f, 16, f, frame.perspective)
    for (let k = 0; k < 3; k++) writeSplitDouble(f, 20 + k, 24 + k, v.originShift[k])
    u[28] = v.viewRectMin[0]
    u[29] = v.viewRectMin[1]
    u[30] = v.viewSize[0]
    u[31] = v.viewSize[1]
    u[23] = v.sunMapCount
    const front = v.front
    if (front) {
      copyMatrix4(f, front.previousViewProjection, 32)
      f[48] = front.size[0]
      f[49] = front.size[1]
      u[57] = front.sameImage ? 1 : 0
    }
  }
  // The number of page rects to clear, and where the claimed maps lie.
  u[27] = frame.claimed * VSM_MIPS
  u[58] = frame.singleMaps
}

/** One dispatch of `p` in `pass`: its tables' group `g0`, the view's `g1` when it has one,
 *  `groups` workgroups, split in rows past one dimension's (`dispatchRows`). */
function dispatch(
  pass: GPUComputePassEncoder,
  p: VsmComputePipe,
  g0: GPUBindGroup,
  g1: GPUBindGroup | undefined,
  groups: number,
) {
  if (!p.pipeline) return
  pass.setPipeline(p.pipeline)
  pass.setBindGroup(0, g0)
  if (g1) pass.setBindGroup(1, g1)
  dispatchRows(pass, groups)
}

/** The pixel pass's view group (group 1): its entries read the frame's `view` (its strands for the
 *  input `strands`), the group made again when a resource they name moved (`entriesMoved`). A view
 *  marking both inputs holds one of these for each. */
function createPixelsView(device: GPUDevice, params: GPUBuffer) {
  let view: VsmMarkingView | undefined, viewGroup: GPUBindGroup | undefined
  const viewBound = createWebgpuBindIdentity()
  const lightEntries = [
    bufferEntry(3, () => view?.view),
    bufferEntry(4, () => view?.directLights),
    // The light grid pruned (`vsmPruneLightGrid`): the walk reads it as the engine's, `tileLights`.
    bufferEntry(5, () => view?.lightGrid),
    bufferEntry(6, () => view?.lightVsmIds),
    bufferEntry(7, () => view?.sunMapIds),
    bufferEntry(8, () => params),
  ]
  const viewEntries = [
    resourceEntry(0, () => view?.depth),
    resourceEntry(1, () => view?.normalRough),
    resourceEntry(2, () => view?.flags),
    ...lightEntries,
  ]
  const frontEntry = resourceEntry(VSM_FRONT_DEPTH_BINDING, () => view?.front?.depth),
    waterEntry = resourceEntry(VSM_WATER_DEPTH_BINDING, () => view?.water)
  const entriesOf = {
    pixels: viewEntries,
    pixelsFront: [...viewEntries, frontEntry],
    pixelsWater: [...viewEntries, waterEntry],
    pixelsFrontWater: [...viewEntries, frontEntry, waterEntry],
    pixelsStrands: [
      resourceEntry(VSM_STRANDS_MARKING_BINDING.hairDepth, () => view?.hair?.hairDepth),
      ...lightEntries,
      bufferEntry(VSM_STRANDS_MARKING_BINDING.counts, () => view?.hair?.counts),
      bufferEntry(VSM_STRANDS_MARKING_BINDING.tiles, () => view?.hair?.tiles),
    ],
  } satisfies Record<PixelsVariant, GPUBindGroupEntry[]>
  return {
    /** The pixel pass's group 1 over `v` for `input`: with the front layer's depth and the water's
     *  where `v` holds them, or over its strands. */
    group(p: VsmComputePipe, v: VsmMarkingView, input: VsmInputType = 'gbuffer') {
      view = v
      const variant = pixelsVariant(!!v.front, !!v.water, input)
      const entries = (viewBound.entries[0] = entriesOf[variant])
      if (viewBound.entriesMoved(p.groups[1])) viewGroup = undefined
      return (viewGroup ??= device.createBindGroup({
        label: pixelsLabel(!!v.front, !!v.water, false, input),
        layout: p.groups[1],
        entries,
      }))
    },
    /** Nothing of the last frame's view held. */
    release() {
      view = viewGroup = undefined
      viewBound.next.length = 0
      viewBound.moved()
    },
  }
}

/** The sample pass's view group (group 1): the depth, the view, the lights and their maps' ids, the marking's parameters and the samples, made again
 *  when a resource they name moved. */
function createSamplesView(device: GPUDevice, params: GPUBuffer, front = false) {
  let view: VsmMarkingView | undefined, viewGroup: GPUBindGroup | undefined
  const viewBound = createWebgpuBindIdentity()
  const entries = [
    resourceEntry(VSM_SAMPLE_MARKING_BINDING.depth, () =>
      front ? view?.frontSamples?.depth : view?.depth,
    ),
    bufferEntry(VSM_SAMPLE_MARKING_BINDING.view, () => view?.view),
    bufferEntry(VSM_SAMPLE_MARKING_BINDING.directLights, () => view?.directLights),
    bufferEntry(VSM_SAMPLE_MARKING_BINDING.lightIds, () => view?.lightVsmIds),
    bufferEntry(VSM_SAMPLE_MARKING_BINDING.sunIds, () => view?.sunMapIds),
    bufferEntry(VSM_SAMPLE_MARKING_BINDING.marking, () => params),
    bufferEntry(
      SAMPLED_BINDINGS.params,
      () => (front ? view?.frontSamples : view?.samples)?.params,
    ),
    resourceEntry(
      VSM_SAMPLE_MARKING_BINDING.samples,
      () => (front ? view?.frontSamples : view?.samples)?.texture,
    ),
  ]
  return {
    group(p: VsmComputePipe, v: VsmMarkingView) {
      view = v
      viewBound.entries[0] = entries
      if (viewBound.entriesMoved(p.groups[1])) viewGroup = undefined
      return (viewGroup ??= device.createBindGroup({
        label: 'vsm.markSamples',
        layout: p.groups[1],
        entries,
      }))
    },
    release() {
      view = viewGroup = undefined
      viewBound.next.length = 0
      viewBound.moved()
    },
  }
}

/** The pruning's group over the frame's view, lights, light grid and shadowed lights' grid, made again
 *  when one of them moved. */
function createPrune(device: GPUDevice) {
  let key: readonly unknown[] = [],
    group: GPUBindGroup | undefined
  return {
    /** The pruning of `v`'s light grid into its shadowed lights' grid: a thread a cell. */
    encode(pass: GPUComputePassEncoder, p: VsmComputePipe, v: VsmMarkingView) {
      const next = [p.groups[0], v.view, v.directLights, v.tileLights, v.lightGrid]
      if (!group || next.some((resource, k) => resource !== key[k])) {
        key = next
        group = device.createBindGroup({
          label: PRUNE_LABEL,
          layout: p.groups[0],
          entries: [
            { binding: VSM_PRUNE_BINDING.view, resource: { buffer: v.view } },
            { binding: VSM_PRUNE_BINDING.directLights, resource: { buffer: v.directLights } },
            { binding: VSM_PRUNE_BINDING.tileLights, resource: { buffer: v.tileLights } },
            { binding: VSM_PRUNE_BINDING.lightGrid, resource: { buffer: v.lightGrid } },
          ],
        })
      }
      if (!p.pipeline) return
      pass.setPipeline(p.pipeline)
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroups(ceilDiv(v.gridCells, VSM_LIGHT_GRID_GROUP))
    },
    /** Nothing of the last frame's buffers held. */
    release() {
      key = []
      group = undefined
    },
  }
}

/** What the page-table clears hold: the per-page args buffer `perPage` (`slots` apart, `perPageData`
 *  laid as it), the ids in `res.perPageIds`, the pipes and the frame set's groups. */
interface PageClears {
  device: GPUDevice
  res: VsmResources
  pipes: ReturnType<typeof vsmMarkingPipes>
  perPage: GPUBuffer
  slots: ReturnType<typeof uniformSlots>
  perPageData: Uint32Array<ArrayBuffer>
  tableGroups: () => TableGroups
}

/** Per-bin args, written for both dispatchers. */
function writePerPage(
  { device, res, perPage, slots, perPageData }: PageClears,
  bins: VsmPerPageBins,
) {
  if (bins.ids.length > res.layout.mapSlots)
    throw new Error('VSM: per-page ids exceed res.perPageIds')
  // The ids only when they changed: a new set's buffer starts zeroed (`writeChanged`).
  writeChanged(device, res.perPageIds, bins.ids, 0, bins.ids.length)
  // Every slot's words are written again: nothing is cleared first.
  vsmWritePerPageSlots(perPageData, slots, [bins.all, bins.directionalOnly])
  writeChangedSlots(device, perPage, perPageData, slots)
}

/** The clear `step` over the maps it walks (`vsmMarkingClears`): one dispatch per non-empty bin. */
function resetPageTables(
  { device, res, pipes, perPage, slots, tableGroups }: PageClears,
  pass: GPUComputePassEncoder,
  step: VsmClearStep,
  bins: VsmPerPageBins,
) {
  const p = pipes.clear(step)
  if (!p) return
  const { walk, targets } = pipes.clears[step]
  const groups = tableGroups()
  const group = (groups.clear[step] ??= device.createBindGroup({
    label: `vsm.resetPageTable(${step})`,
    layout: p.groups[0],
    entries: [
      ...vsmBindGroupEntries(res, VSM_CLEAR_SPECS),
      ...sequentialEntries(
        [
          { buffer: perPage, size: 16 },
          ...targets.map((target) => ({ buffer: res.current[target] })),
        ],
        3,
      ),
    ],
  }))
  const list = bins[walk]
  if (!p.pipeline) return
  pass.setPipeline(p.pipeline)
  for (let b = 0; b < list.length; b++) {
    const bin = list[b]
    if (bin.count <= 0) continue
    pass.setBindGroup(0, group, slots.offset(perPageSlot(walk === 'directionalOnly', b)))
    vsmDispatchPerPageBin(pass, bin, b)
  }
}

/** What the marking holds past its buffers: the kernels' pipes, their groups and the parts that
 *  mark. */
interface MarkingState {
  device: GPUDevice
  res: VsmResources
  params: GPUBuffer
  /** Group 0 of a pipe over the tables a kernel names (`tablesGroup`). */
  group: TablesGroup
  paramF32: Float32Array<ArrayBuffer>
  paramU32: Uint32Array<ArrayBuffer>
  pipes: ReturnType<typeof vsmMarkingPipes>
  clears: PageClears
  pixelsView: ReturnType<typeof createPixelsView>
  /** The strands' pass's view group, its own: a view marks both inputs. */
  strandsView: ReturnType<typeof createPixelsView>
  /** The sample pass's view group, and the nearest translucent layer's. */
  samplesView: ReturnType<typeof createSamplesView>
  frontSamplesView: ReturnType<typeof createSamplesView>
  prune: ReturnType<typeof createPrune>
  froxels: FroxelMarking
  /** What the froxel passes take of the frame beside its view, rewritten by each frame. */
  froxelContext: FroxelMarkContext
  /** The classic shadow maps' entries buffer and its group, made when the first frame that has them asks. */
  dense: { buffer?: GPUBuffer; group?: GPUBindGroup }
}

/** Group 0 of `p` over the tables `specs` name and the parameters at `paramsBinding`. */
const tablesGroup =
  (device: GPUDevice, res: VsmResources, params: GPUBuffer): TablesGroup =>
  (label, p, specs, paramsBinding) =>
    vsmSpecGroup(
      device,
      p.groups[0],
      res,
      specs,
      label,
      paramsBinding === undefined ? [] : [{ binding: paramsBinding, resource: { buffer: params } }],
    )

/** What the marking marks past the coarse pages: nothing where `shadowMarkPixelPages` is off (the
 *  pages of the view are not asked), else the pages from the pixels or, with
 *  `shadowMarkPagesUseFroxels`, from the froxels, which read the water's depth (the suns' pages of
 *  its surface) but not the front layer. */
export const viewMarking = (shadows: ShadowValues): 'none' | 'pixels' | 'froxels' | 'dense' =>
  !shadows.shadowVirtualEnable
    ? 'dense'
    : !shadows.shadowMarkPixelPages
      ? 'none'
      : shadows.shadowMarkPagesUseFroxels
        ? 'froxels'
        : 'pixels'

/** The marks from the pixels of the view `v`, one group a tile. */
function markFromPixels(
  state: MarkingState,
  pass: GPUComputePassEncoder,
  v: VsmMarkingView,
  s: ShadowValues,
  groups: TableGroups,
  throttled: boolean,
) {
  const stridedX = ceilDiv(v.viewSize[0], markStride(s.shadowPageMarkingPixelStrideX)),
    stridedY = ceilDiv(v.viewSize[1], markStride(s.shadowPageMarkingPixelStrideY))
  const front = !!v.front,
    water = !!v.water
  // With the samples marking the local lights' pages, the pixel pass leaves those out.
  const locals = !v.samples
  const pixels = state.pipes.pixels(front, water, throttled, 'gbuffer', locals)
  const key = pixelsVariant(front, water)
  groups.pixels[key] ??= state.group(pixelsLabel(front, water), pixels, VSM_PIXELS_SPECS)
  dispatch(
    pass,
    pixels,
    groups.pixels[key],
    state.pixelsView.group(pixels, v),
    // A group a tile, in rows: the kernel reads its tile back (`vsmMarkPagesFromPixels`).
    ceilDiv(stridedX, VSM_MARK_PIXELS_GROUP_XY) * ceilDiv(stridedY, VSM_MARK_PIXELS_GROUP_XY),
  )
  if (v.samples) markFromSamples(state, pass, v, groups, throttled, v.samples, state.samplesView)
  if (v.frontSamples)
    markFromSamples(state, pass, v, groups, throttled, v.frontSamples, state.frontSamplesView)
}

/** The marks of the local lights' pages from the sampled lighting's samples `from` (the surfaces', or the nearest translucent layer's), a thread a sample, over the group `view`. */
function markFromSamples(
  state: MarkingState,
  pass: GPUComputePassEncoder,
  v: VsmMarkingView,
  groups: TableGroups,
  throttled: boolean,
  from: VsmMarkingSamples,
  view: ReturnType<typeof createSamplesView>,
) {
  const samples = state.pipes.samples(throttled)
  if (!samples.pipeline) return
  groups.samples ??= state.group('vsm.markSamples', samples, VSM_PIXELS_SPECS)
  pass.setPipeline(samples.pipeline)
  pass.setBindGroup(0, groups.samples)
  pass.setBindGroup(1, view.group(samples, v))
  pass.dispatchWorkgroups(from.workgroups[0], from.workgroups[1])
}

/** The marks from the hair strands `hair` of the view `v`, after the surfaces': one group a tile of the
 *  list of all the tiles with strands, an indirect dispatch over it. */
function markFromStrands(
  state: MarkingState,
  pass: GPUComputePassEncoder,
  v: VsmMarkingView,
  hair: HairShadowSource,
  groups: TableGroups,
  throttled: boolean,
) {
  const strands = state.pipes.pixels(false, false, throttled, 'strands')
  if (!strands.pipeline) return
  groups.pixels.pixelsStrands ??= state.group(
    pixelsLabel(false, false, false, 'strands'),
    strands,
    VSM_PIXELS_SPECS,
  )
  pass.setPipeline(strands.pipeline)
  pass.setBindGroup(0, groups.pixels.pixelsStrands)
  pass.setBindGroup(1, state.strandsView.group(strands, v, 'strands'))
  pass.dispatchWorkgroupsIndirect(hair.dispatchArgs, HAIR_ALL_TILES_DISPATCH)
}

/** The pages of the classic shadow maps `frame.dense` names, asked for as the coarse pages are: a row of groups an entry. */
function markDense(
  state: MarkingState,
  pass: GPUComputePassEncoder,
  groups: TableGroups,
  frame: VsmMarkingFrame,
) {
  const entries = frame.dense
  if (!entries || entries.count === 0) return
  const dense = state.pipes.dense()
  if (!dense.pipeline) return
  const { device } = state
  groups.dense ??= state.group(DENSE_LABEL, dense, VSM_COARSE_SPECS, 4)
  const held = state.dense
  held.buffer ??= device.createBuffer({
    label: DENSE_LABEL,
    size: DENSE_MAX_ENTRIES * VSM_DENSE_ENTRY_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  held.group ??= device.createBindGroup({
    label: DENSE_LABEL,
    layout: dense.groups[1],
    entries: [{ binding: 0, resource: { buffer: held.buffer } }],
  })
  device.queue.writeBuffer(held.buffer, 0, entries.words, 0, entries.count * VSM_DENSE_ENTRY_WORDS)
  pass.setPipeline(dense.pipeline)
  pass.setBindGroup(0, groups.dense)
  pass.setBindGroup(1, held.group)
  pass.dispatchWorkgroups(VSM_DENSE_GROUPS_ACROSS, entries.count)
}

/** The marking's dispatches of `frame` into `pass`. */
function encodeMarking(state: MarkingState, pass: GPUComputePassEncoder, frame: VsmMarkingFrame) {
  const { device, params, pipes, clears } = state
  const mapCount = frame.mapCount
  const s = frame.settings ?? VSM_DEFAULT_SHADOWS
  const marking = viewMarking(s)
  // The froxels' buffers (the water's with the scene's) are held while the marking is from them, a
  // frame without a map included.
  if (marking !== 'froxels') state.froxels.destroy()
  // No shadow map: nothing to mark.
  if (mapCount === 0) return
  fillMarkingParams(state.paramF32, state.paramU32, frame)
  writeChanged(device, params, state.paramU32, 0, state.paramU32.length)
  writePerPage(clears, frame.perPage)
  // The page requests, the receiver cover and the raster marks cleared, the page rects set to empty,
  // then the page table and its flags cleared.
  resetPageTables(clears, pass, 'requests', frame.perPage)
  resetPageTables(clears, pass, 'receiver', frame.perPage)
  const groups = clears.tableGroups()
  const rasterMarks = pipes.rasterMarks()
  groups.rasterMarks ??= state.group(RASTER_MARKS_LABEL, rasterMarks, VSM_CLEAR_RASTER_MARKS_SPECS)
  dispatch(
    pass,
    rasterMarks,
    groups.rasterMarks,
    undefined,
    ceilDiv(state.res.rasterMarks.size / 4, VSM_GROUP_WIDTH),
  )
  const rect = pipes.rect()
  groups.rect ??= state.group(RECT_LABEL, rect, VSM_INIT_RECT_SPECS, 4)
  dispatch(pass, rect, groups.rect, undefined, ceilDiv(frame.claimed * VSM_MIPS, VSM_GROUP_WIDTH))
  frame.afterRects?.(pass)
  resetPageTables(clears, pass, 'tables', frame.perPage)
  // The shadowed lights' grid: the marking and the projection both read it, whatever the projection holds.
  if (frame.view?.gridCells) state.prune.encode(pass, pipes.prune(), frame.view)
  // The coarse pages after the clears: pixel marks must be able to overwrite its plain stores.
  const coarse = pipes.coarse()
  groups.coarse ??= state.group(COARSE_LABEL, coarse, VSM_COARSE_SPECS, 4)
  dispatch(pass, coarse, groups.coarse, undefined, ceilDiv(frame.claimed, VSM_GROUP_WIDTH))
  // The classic shadow maps ask for every page they draw, from no pixel of the view.
  if (marking === 'dense') return markDense(state, pass, groups, frame)
  const v = frame.view
  if (!v || marking === 'none') return
  if (marking === 'pixels') markFromPixels(state, pass, v, s, groups, !!frame.throttled)
  else {
    const froxels = state.froxelContext
    froxels.perspective = frame.perspective
    froxels.throttled = !!frame.throttled
    froxels.groups = groups
    state.froxels.mark(pass, v, froxels)
  }
  // The strands' pages after the surfaces', whichever marked them, as the reference marks them.
  if (v.hair) markFromStrands(state, pass, v, v.hair, groups, !!frame.throttled)
}

export function createVsmMarking(device: GPUDevice, res: VsmResources): VsmMarking {
  const params = uniformBuffer(device, 'vsm.marking.params', VSM_MARKING_PARAMS_BYTES)
  // The per-page slots lie at the device's dynamic-offset alignment.
  const slots = uniformSlots(device.limits, PER_PAGE_SLOTS, VSM_PER_PAGE_BIN_WORDS)
  const perPage = uniformBuffer(device, 'vsm.marking.perPage', slots.bytes)
  const paramData = new ArrayBuffer(VSM_MARKING_PARAMS_BYTES)
  const pipes = vsmMarkingPipes(device, res.layout)
  const tables = vsmFrameSetHeld<TableGroups>()
  const group = tablesGroup(device, res, params)
  const state: MarkingState = {
    device,
    res,
    params,
    group,
    paramF32: new Float32Array(paramData),
    paramU32: new Uint32Array(paramData),
    pipes,
    clears: {
      device,
      res,
      pipes,
      perPage,
      slots,
      // Laid as the buffer; the padding past each slot's words stays zero, never compared.
      perPageData: new Uint32Array(slots.bytes / 4),
      tableGroups: () => vsmPerFrameSet(tables, res, newTableGroups, undefined),
    },
    pixelsView: createPixelsView(device, params),
    strandsView: createPixelsView(device, params),
    samplesView: createSamplesView(device, params),
    frontSamplesView: createSamplesView(device, params, true),
    prune: createPrune(device),
    froxels: createFroxelMarking(device, pipes, params),
    dense: {},
    froxelContext: {
      perspective: true,
      throttled: false,
      groups: {},
      tablesGroup: group,
      specs: VSM_PIXELS_SPECS,
    },
  }
  return {
    encode: (pass, frame) => encodeMarking(state, pass, frame),
    destroy() {
      params.destroy()
      perPage.destroy()
      state.froxels.destroy()
      state.dense.buffer?.destroy()
      // Nothing of the last frame's view held past the marking.
      state.pixelsView.release()
      state.strandsView.release()
      state.samplesView.release()
      state.frontSamplesView.release()
      state.prune.release()
    },
  }
}
