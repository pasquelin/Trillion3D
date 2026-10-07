/**
 * Page marking (step 3): its dispatches recorded into the compute pass the caller opened, after the
 * physical page address update (`encodeVsmPageCarry`), in this order, each seeing
 * the writes of those before it:
 *   clear the page requests, the page table, the page marks and the receiver covers, in one
 *   walk of each map's pages (`vsmResetPageTableWgsl`) → init the page rect bounds → mark the
 *   coarse pages → generate the page marks from the pixels (GBuffer).
 * The caller clears the raster marks before the pass.
 * No light grid pruning is run: the pixel pass walks the engine's light grid and skips what the
 * pruning would have dropped (lights without a VSM, single-page lights), the same marks.
 *
 * Per-page passes (the page table clears) go through a per-page dispatcher: ids
 * binned by their finest mip level (`vsmCachePerPageBins`), uploaded into `res.perPageIds`, one dispatch per
 * non-empty bin, the bin's (offset, count, pitch, thread-per-id) in a dynamic-offset uniform.
 *
 * Pipelines are cached per device and per shader text; bind groups once per frame set (`res.current`,
 * the two in turn), the pixel pass's view group again only when a resource of the view moved.
 */
import {
  VSM_GROUP_WIDTH,
  VSM_LIGHT_KIND_DIRECTIONAL,
  VSM_SINGLE_PAGE_MAP_SLOTS,
  VSM_MIPS,
  VSM_SUN_PAGE_MARGIN,
  VSM_LOCAL_PAGE_MARGIN,
  VSM_MARK_STRIDE_X,
  VSM_MARK_STRIDE_Y,
  vsmWriteDepthFromDeviceZ,
} from './constants.ts'
import type { VsmCacheManager } from './cacheManager.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  type VsmBindingSpec,
  type VsmFrameBuffers,
  type VsmResources,
  vsmPerFrameSet,
} from './resources.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { bufferEntry, resourceEntry } from '../webgpu/core/liveEntries.ts'
import { vsmBufferEntry, vsmComputePipe, type VsmComputePipe } from './passKit.ts'
import { vsmWriteChanged } from './writeChanged.ts'
import {
  VSM_CLEAR_SPECS,
  VSM_COARSE_SPECS,
  VSM_INIT_RECT_SPECS,
  VSM_MARK_PIXELS_GROUP_XY,
  VSM_MARKING_PARAMS_BYTES,
  VSM_PER_PAGE_DISPATCH_STRIDE,
  VSM_PER_PAGE_GROUP_XY,
  VSM_PIXELS_SPECS,
  vsmResetPageTableWgsl,
  vsmPixelPageMarkingWgsl,
  vsmPageRectInitWgsl,
  vsmCoarseMarkingWgsl,
  vsmMarkingClears,
} from './markingWgsl.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { dispatchGrid, dispatchRows } from '../gpu/dispatch/grid.ts'
import type { VsmLayout } from './layout.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'

// ---- The per-page dispatcher ------------------------------------------------------------------

/** Bins: 1 (8x8 groups), small (4x4), medium (1x1), and one thread per id (0). */
const VSM_PER_PAGE_BIN_GRID = [8, 4, 1, 0] as const
export const VSM_PER_PAGE_BIN_COUNT = 4

/** Whether the map is a single-page map. */
function vsmIsSinglePage(id: number) {
  return id < VSM_SINGLE_PAGE_MAP_SLOTS
}

/** The bin of a map by its id and minimum mip level. */
function vsmPerPageBin(mapId: number, finestMip: number) {
  if (vsmIsSinglePage(mapId)) return VSM_PER_PAGE_BIN_COUNT - 1
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
    if (!directionalOnly || e.directional) bins[vsmPerPageBin(e.id, e.finestMip)].count++
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
    const bin = bins[vsmPerPageBin(e.id, e.finestMip)]
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
      to.directional = data.lightKind === VSM_LIGHT_KIND_DIRECTIONAL
      if (to.directional) directional++
    }
  }
  if (bins.ids.length !== count + directional) bins.ids = new Uint32Array(count + directional)
  countingSort(entries, count, false, 0, bins.all, bins.ids)
  countingSort(entries, count, true, count, bins.directionalOnly, bins.ids)
  return bins
}

/** The thread-per-id bin's groups of 8 × 8, in rows past one dimension's (`dispatchRows`): its
 *  kernel's `y · gridWidth + x` already ranks the threads of every row (`vsmMapWalkOf`). */
const threadPerIdGroups = (bin: VsmPerPageBin) => ceilDiv(bin.count, VSM_PER_PAGE_GROUP_XY ** 2)

/** Bin `b`'s `VsmMapWalkParams` words — offset, count, row pitch, thread per id —
 *  at `out[at]`. */
export function vsmWritePerPageBinArgs(
  out: Uint32Array,
  at: number,
  bin: VsmPerPageBin,
  b: number,
) {
  const dim = VSM_PER_PAGE_BIN_GRID[b]
  out[at] = bin.offset
  out[at + 1] = bin.count
  // Thread-per-id: the row pitch of its launch's rows (`threadPerIdGroups`).
  out[at + 2] =
    dim === 0
      ? dispatchGrid(threadPerIdGroups(bin))[0] * VSM_PER_PAGE_GROUP_XY
      : dim * VSM_PER_PAGE_GROUP_XY
  out[at + 3] = dim === 0 ? 1 : 0
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
  for (let i = 0; i < 16; i++) out[i] = projection[i]
  for (let r = 0; r < 4; r++) out[8 + r] = -projection[8 + r]
  return out
}

// ---- Pass inputs -------------------------------------------------------------------------------

/** What the per-pixel marking reads of the engine's frame (the shadow demand pass's inputs). */
interface VsmMarkingView {
  depth: GPUTextureView
  normalRough: GPUTextureView
  flags: GPUTextureView
  /** The deferred pass's `View` uniform (VIEW_WGSL). */
  view: GPUBuffer
  directLights: GPUBuffer
  tileLights: GPUBuffer
  /** i32 per `directLights.items` entry: its VSM id (first face for a point light), −1 for none. */
  lightVsmIds: GPUBuffer
  /** The u32 ids of this view's directional (clipmap) maps. */
  sunMapIds: GPUBuffer
  sunMapCount: number
  viewRectMin: readonly [number, number]
  viewSize: readonly [number, number]
  /** The +z-forward view-to-clip (`vsmForwardZViewToClip`). */
  viewToClip: ArrayLike<number>
  /** The map view's origin shift (−camera position), double precision, split high/low. */
  originShift: readonly [number, number, number]
}

export interface VsmMarkingFrame {
  fullMapCount: number
  singlePageMapCount: number
  perPage: VsmPerPageBins
  /** Absent: no pixel marking (pixel page marking off). */
  view?: VsmMarkingView
}

// ---- Pipelines (cached per device) ------------------------------------------------------------

/** GPUShaderStage.COMPUTE, read at call time (no WebGPU global needed to import this module). */
const C = () => GPUShaderStage.COMPUTE
const uniformEntry = (binding: number, hasDynamicOffset = false): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: C(),
  buffer: { type: 'uniform', hasDynamicOffset },
})
const storageEntry = (binding: number, type: GPUBufferBindingType) =>
  vsmBufferEntry(binding, C(), type)
const textureEntry = (
  binding: number,
  sampleType: GPUTextureSampleType,
): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: C(),
  texture: { sampleType },
})

// ---- Pipes -------------------------------------------------------------------------------------

/** The labels of the marking's kernels, their pipes' and groups' alike. */
const RECT_LABEL = 'vsm.initPageRects',
  COARSE_LABEL = 'vsm.markCoarse',
  PIXELS_LABEL = 'vsm.markPagesFromPixels'

/** The marking's pipes for `layout` (`vsmComputePipe`: made once a device and source), each made
 *  when first asked and kept: its WGSL is built and hashed the first time only. */
export function vsmMarkingPipes(device: GPUDevice, layout: VsmLayout) {
  const entries = (specs: readonly VsmBindingSpec[]) =>
    vsmBindGroupLayoutEntries(specs, layout, C())
  const clears = vsmMarkingClears(layout)
  const held: Partial<Record<ClearSet | 'rect' | 'coarse' | 'pixels', VsmComputePipe>> = {}
  const clear = (set: ClearSet) =>
    (held[set] ??= vsmComputePipe(
      device,
      `vsm.resetPageTable(${set})`,
      vsmResetPageTableWgsl(clears[set], layout),
      'vsmClearPageTables',
      [
        [
          ...entries(VSM_CLEAR_SPECS),
          uniformEntry(3, true),
          ...clears[set].map((_, n) => storageEntry(4 + n, 'storage')),
        ],
      ],
    ))
  return {
    /** The tables each clear walks the maps of (`vsmMarkingClears`). */
    clears,
    /** The clear of the tables `set` walks the maps of; none when it clears none. */
    clear: (set: ClearSet) => (clears[set].length ? clear(set) : undefined),
    rect: () =>
      (held.rect ??= vsmComputePipe(
        device,
        RECT_LABEL,
        vsmPageRectInitWgsl(layout),
        'vsmInitPageRects',
        [[...entries(VSM_INIT_RECT_SPECS), uniformEntry(4)]],
      )),
    coarse: () =>
      (held.coarse ??= vsmComputePipe(
        device,
        COARSE_LABEL,
        vsmCoarseMarkingWgsl(layout),
        'vsmMarkCoarse',
        [[...entries(VSM_COARSE_SPECS), uniformEntry(4)]],
      )),
    pixels: () =>
      (held.pixels ??= vsmComputePipe(
        device,
        PIXELS_LABEL,
        vsmPixelPageMarkingWgsl(layout),
        'vsmMarkPagesFromPixels',
        [
          entries(VSM_PIXELS_SPECS),
          [
            textureEntry(0, 'depth'),
            textureEntry(1, 'unfilterable-float'),
            textureEntry(2, 'uint'),
            uniformEntry(3),
            storageEntry(4, 'read-only-storage'),
            storageEntry(5, 'read-only-storage'),
            storageEntry(6, 'read-only-storage'),
            storageEntry(7, 'read-only-storage'),
            uniformEntry(8),
          ],
        ],
      )),
  }
}

// ---- Marking object ----------------------------------------------------------------------------

export interface VsmMarking {
  /** Records the marking's dispatches into `pass` (uniform/id uploads go through the queue). */
  encode(pass: GPUComputePassEncoder, frame: VsmMarkingFrame): void
  destroy(): void
}

const DISPATCHERS = 2
/** The marking's groups over the tables of a frame set (`vsmPerFrameSet`), made as asked. */
interface TableGroups {
  clear: Partial<Record<ClearSet, GPUBindGroup>>
  rect?: GPUBindGroup
  coarse?: GPUBindGroup
  pixels?: GPUBindGroup
}
const newTableGroups = (): TableGroups => ({ clear: {} })
/** The maps a clear walks (`vsmMarkingClears`). */
type ClearSet = 'all' | 'directionalOnly'
/** Each per-page slot's dynamic offset, all then directional-only bins (`resetPageTables`). */
const SLOT_OFFSETS = Array.from({ length: DISPATCHERS * VSM_PER_PAGE_BIN_COUNT }, (_, slot) => [
  slot * VSM_PER_PAGE_DISPATCH_STRIDE,
])
const PER_PAGE_BYTES = DISPATCHERS * VSM_PER_PAGE_BIN_COUNT * VSM_PER_PAGE_DISPATCH_STRIDE
/** Bytes a marking holds on the device: its parameters and its per-page dispatch slots. */
export const VSM_MARKING_BYTES = VSM_MARKING_PARAMS_BYTES + PER_PAGE_BYTES

export function createVsmMarking(device: GPUDevice, res: VsmResources): VsmMarking {
  const layout = res.layout
  const params = device.createBuffer({
    label: 'vsm.marking.params',
    size: VSM_MARKING_PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const perPage = device.createBuffer({
    label: 'vsm.marking.perPage',
    size: PER_PAGE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const paramData = new ArrayBuffer(VSM_MARKING_PARAMS_BYTES),
    paramF32 = new Float32Array(paramData),
    paramU32 = new Uint32Array(paramData)
  const perPageData = new Uint32Array(PER_PAGE_BYTES / 4)

  const pipes = vsmMarkingPipes(device, layout)

  function writeParams(frame: VsmMarkingFrame) {
    const f = paramF32,
      u = paramU32
    f.fill(0)
    const v = frame.view
    if (v) {
      for (let i = 0; i < 16; i++) f[i] = v.viewToClip[i]
      // From the f32 matrix just written, the one the shader holds; a perspective by its M[3][3].
      vsmWriteDepthFromDeviceZ(f, 16, f, f[15] < 1)
      for (let k = 0; k < 3; k++) {
        const high = Math.fround(v.originShift[k])
        f[20 + k] = high
        f[24 + k] = v.originShift[k] - high
      }
      u[28] = v.viewRectMin[0]
      u[29] = v.viewRectMin[1]
      u[30] = v.viewSize[0]
      u[31] = v.viewSize[1]
      u[34] = v.sunMapCount
    }
    f[23] = VSM_SUN_PAGE_MARGIN
    f[27] = VSM_LOCAL_PAGE_MARGIN
    // The pixel stride is clamped to [1, 128].
    u[32] = clamp(VSM_MARK_STRIDE_X, 1, 128)
    u[33] = clamp(VSM_MARK_STRIDE_Y, 1, 128)
    // A pixel facing away from a light marks no page of it (its own back shadows it).
    u[35] = 1
    // The number of page rects to clear.
    u[36] = (frame.fullMapCount + frame.singlePageMapCount) * VSM_MIPS
    // A local map asks for its last mip's page: a far receiver always finds one.
    u[37] = 1
    vsmWriteChanged(device, params, paramU32, 0, paramU32.length)
  }

  /** Per-bin args, written for both dispatchers. */
  function writePerPage(bins: VsmPerPageBins) {
    if (bins.ids.length > res.layout.mapSlots)
      throw new Error('VSM: per-page ids exceed res.perPageIds')
    // The ids only when they changed: a new set's buffer starts zeroed (`vsmWriteChanged`).
    vsmWriteChanged(device, res.perPageIds, bins.ids, 0, bins.ids.length)
    perPageData.fill(0)
    for (let b = 0; b < VSM_PER_PAGE_BIN_COUNT; b++) {
      const stride = VSM_PER_PAGE_DISPATCH_STRIDE / 4
      vsmWritePerPageBinArgs(perPageData, b * stride, bins.all[b], b)
      vsmWritePerPageBinArgs(
        perPageData,
        (VSM_PER_PAGE_BIN_COUNT + b) * stride,
        bins.directionalOnly[b],
        b,
      )
    }
    vsmWriteChanged(device, perPage, perPageData, 0, perPageData.length)
  }

  /** The clears of the tables `set` walks the maps of: one dispatch per non-empty bin. */
  function resetPageTables(pass: GPUComputePassEncoder, set: ClearSet, bins: VsmPerPageBins) {
    const p = pipes.clear(set)
    if (!p) return
    const targets = pipes.clears[set]
    const groups = tableGroups()
    const group = (groups.clear[set] ??= device.createBindGroup({
      label: `vsm.resetPageTable(${set})`,
      layout: p.groups[0],
      entries: [
        ...vsmBindGroupEntries(res, VSM_CLEAR_SPECS),
        { binding: 3, resource: { buffer: perPage, size: 16 } },
        ...targets.map((target, n) => ({
          binding: 4 + n,
          resource: { buffer: res.current[target] },
        })),
      ],
    }))
    const list = bins[set]
    pass.setPipeline(p.pipeline)
    for (let b = 0; b < list.length; b++) {
      const bin = list[b]
      if (bin.count <= 0) continue
      pass.setBindGroup(
        0,
        group,
        SLOT_OFFSETS[(set === 'directionalOnly' ? 1 : 0) * VSM_PER_PAGE_BIN_COUNT + b],
      )
      vsmDispatchPerPageBin(pass, bin, b)
    }
  }

  const tables = new WeakMap<VsmFrameBuffers, TableGroups>()
  const tableGroups = () => vsmPerFrameSet(tables, res, newTableGroups, undefined)
  /** Group 0 of `p` over the tables `specs` name and the parameters at `paramsBinding`. */
  const tablesGroup = (
    label: string,
    p: VsmComputePipe,
    specs: readonly VsmBindingSpec[],
    paramsBinding?: number,
  ) =>
    device.createBindGroup({
      label,
      layout: p.groups[0],
      entries:
        paramsBinding === undefined
          ? vsmBindGroupEntries(res, specs)
          : [
              ...vsmBindGroupEntries(res, specs),
              { binding: paramsBinding, resource: { buffer: params } },
            ],
    })
  /** The pixel pass's view group (group 1): its entries read the frame's `view`, the group made
   *  again when a resource they name moved (`entriesMoved`). */
  let view: VsmMarkingView | undefined, viewGroup: GPUBindGroup | undefined
  const viewBound = createWebgpuBindIdentity()
  const viewEntries = (viewBound.entries[0] = [
    resourceEntry(0, () => view?.depth),
    resourceEntry(1, () => view?.normalRough),
    resourceEntry(2, () => view?.flags),
    bufferEntry(3, () => view?.view),
    bufferEntry(4, () => view?.directLights),
    bufferEntry(5, () => view?.tileLights),
    bufferEntry(6, () => view?.lightVsmIds),
    bufferEntry(7, () => view?.sunMapIds),
    bufferEntry(8, () => params),
  ])

  /** One dispatch of `p` in `pass`: its tables' group `g0`, the view's `g1` when it has one,
   *  `groups` workgroups, split in rows past one dimension's (`dispatchRows`). */
  function dispatch(
    pass: GPUComputePassEncoder,
    p: VsmComputePipe,
    g0: GPUBindGroup,
    g1: GPUBindGroup | undefined,
    groups: number,
  ) {
    pass.setPipeline(p.pipeline)
    pass.setBindGroup(0, g0)
    if (g1) pass.setBindGroup(1, g1)
    dispatchRows(pass, groups)
  }

  /** The pixel pass's group 1 over `v`. */
  function pixelsViewGroup(p: VsmComputePipe, v: VsmMarkingView) {
    view = v
    if (viewBound.entriesMoved(p.groups[1])) viewGroup = undefined
    return (viewGroup ??= device.createBindGroup({
      label: PIXELS_LABEL,
      layout: p.groups[1],
      entries: viewEntries,
    }))
  }

  return {
    encode(pass, frame) {
      const mapCount = frame.fullMapCount + frame.singlePageMapCount
      // No shadow map: nothing to mark.
      if (mapCount === 0) return
      writeParams(frame)
      writePerPage(frame.perPage)
      resetPageTables(pass, 'all', frame.perPage)
      resetPageTables(pass, 'directionalOnly', frame.perPage)
      const groups = tableGroups()
      const rect = pipes.rect()
      groups.rect ??= tablesGroup(RECT_LABEL, rect, VSM_INIT_RECT_SPECS, 4)
      dispatch(pass, rect, groups.rect, undefined, ceilDiv(mapCount * VSM_MIPS, VSM_GROUP_WIDTH))
      // The coarse pages after the clears: pixel marks must be able to overwrite its plain stores.
      const coarse = pipes.coarse()
      groups.coarse ??= tablesGroup(COARSE_LABEL, coarse, VSM_COARSE_SPECS, 4)
      dispatch(pass, coarse, groups.coarse, undefined, ceilDiv(mapCount, VSM_GROUP_WIDTH))
      const v = frame.view
      if (v) {
        const stridedX = ceilDiv(v.viewSize[0], paramU32[32]),
          stridedY = ceilDiv(v.viewSize[1], paramU32[33])
        const pixels = pipes.pixels()
        groups.pixels ??= tablesGroup(PIXELS_LABEL, pixels, VSM_PIXELS_SPECS)
        dispatch(
          pass,
          pixels,
          groups.pixels,
          pixelsViewGroup(pixels, v),
          // A group a tile, in rows: the kernel reads its tile back (`vsmMarkPagesFromPixels`).
          ceilDiv(stridedX, VSM_MARK_PIXELS_GROUP_XY) * ceilDiv(stridedY, VSM_MARK_PIXELS_GROUP_XY),
        )
      }
    },
    destroy() {
      params.destroy()
      perPage.destroy()
      // Nothing of the last frame's view held past the marking.
      view = viewGroup = undefined
      viewBound.next.length = 0
      viewBound.moved()
    },
  }
}
