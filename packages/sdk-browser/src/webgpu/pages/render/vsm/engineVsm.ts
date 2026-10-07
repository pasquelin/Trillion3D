/**
 * The engine's shadows: the virtual shadow maps (`../../../../vsm/`), in their frame order,
 * encoded in the direct-lighting step after the visibility and
 * material passes, before the lighting pass that reads the mask:
 *
 *   invalidation processing (box phase, previous ids) → planVirtualShadowFrame (CPU: clipmaps,
 *   local lights, ids, projection data) → instance page invalidation → physical page address
 *   update → page marking → page allocation build → non-cluster shadow map render → post render →
 *   projection (traced rays, ≤ 4 lights a pass, one layer of the mask array each) → lighting →
 *   feedback copy, mark rendered, frame data extraction.
 *
 * A shadowed light's `params.y` is `firstVsmId · 64 + k` (`store.assignSlice`): mask channel k
 * = layer k / 4, component k % 4, and the map a non-mask read samples; −1 for a light with no
 * virtual shadow map this frame.
 */
import { workgroupCount, alignUp } from '../../../../../../math/src/scalar/integers.ts'
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { createVsmResources, growVsmTables, type VsmResources } from '../../../../vsm/resources.ts'
import { constructGpuResources } from '../../../../gpu/core/errorScope.ts'
import {
  releaseVsmInvalidation,
  type VsmInvalidationPhase,
} from '../../../../vsm/invalidationPass.ts'
import {
  rebindVsmPageManagement,
  releaseVsmPageManagement,
} from '../../../../vsm/pageManagementPass.ts'
import {
  createVsmFrameState,
  VSM_NEXT_MAP_BYTES,
  type VsmFrameLight,
  type VsmFramePlan,
  type VsmFrameState,
} from '../../../../vsm/frameSetup.ts'
import { VsmFeedbackReadback, vsmFeedbackReadbackBytes } from '../../../../vsm/cacheManager.ts'
import {
  createVsmMarking,
  VSM_MARKING_BYTES,
  type VsmMarking,
} from '../../../../vsm/markingPass.ts'
import {
  releaseVsmRender,
  vsmRenderContextBytes,
  type VsmRenderStats,
} from '../../../../vsm/renderPass.ts'
import { releaseVsmProjection, vsmProjectionHeldBytes } from '../../../../vsm/projectionPass.ts'
import {
  VSM_PROJECTION_MASK_FORMAT,
  VSM_PROJECTION_MAX_LIGHTS,
  VSM_PROJECTION_TILE_FORMAT,
  vsmProjectionTiles,
} from '../../../../vsm/projectionWgsl.ts'
import { madeTextureBytes, textureBytesOf } from '../../../../gpu/core/textureBytes.ts'
import {
  releaseVsmTransmission,
  vsmTransmissionContextBytes,
  type VsmTransmission,
} from '../../../../vsm/transmissionPass.ts'
import { createVsmReadbackRing, type VsmReadbackRing } from '../../../../vsm/readbackRing.ts'
import { createVsmSettle, landVsmStats, type VsmSettle } from '../../state/vsmSettle.ts'
import {
  VSM_SUN_FINEST_LEVEL,
  VSM_SUN_COARSEST_LEVEL,
  VSM_MIPS,
  VSM_PROJECTION_RECORD_BYTES,
  VSM_COUNT_CLEARED,
  VSM_COUNTERS,
  VSM_COUNT_DYNAMIC_KEPT,
  VSM_COUNT_GRANTED,
  VSM_COUNT_WANTED,
  VSM_COUNT_STATIC_KEPT,
} from '../../../../vsm/constants.ts'
import type { VsmResourceOptions } from '../../../../vsm/layout.ts'

/** Directional clipmap levels a sun takes. */
const CLIPMAP_LEVELS = VSM_SUN_COARSEST_LEVEL - VSM_SUN_FINEST_LEVEL + 1
/** Full maps per page-table row: (`VSM_TABLE_ROW_WIDTH` / 2) / 128, a map being 128 pages wide. */
const TABLES_PER_ROW = 64
/** Room for `maps` full maps, rounded up to whole page-table rows (the last entry of the last row
 *  holds the single-page maps). */
export const wholeTableRows = (maps: number) => alignUp(maps + 1, TABLES_PER_ROW) - 1

/** The projection's mask, made and freed as one (`ensureMask`): its array, a layer per four
 *  shadowed lights, and its tile words, a texel per projection group naming the layers it stored,
 *  each with the one view the projection and the lighting bind. */
export interface VsmMask {
  array: GPUTexture
  view: GPUTextureView
  tiles: GPUTexture
  tilesView: GPUTextureView
}

/** What the engine keeps of the virtual shadow maps between frames. */
export interface EngineVsm {
  res: VsmResources
  /** The suns the tables' receiver cover holds (`engineVsmOptions`): more grow them. */
  suns: number
  state: VsmFrameState
  marking: VsmMarking
  feedback: VsmFeedbackReadback
  /** i32 per light slot: its first VSM id, −1 for none (marking's `lightVsmIds`). */
  lightIds: GPUBuffer
  /** The words of `lightIds`, as the GPU reads them (−1 is 0xFFFFFFFF). */
  lightIdsData: Uint32Array<ArrayBuffer>
  directionalIds: GPUBuffer
  mask: VsmMask | undefined
  /** This frame's plan, until `finishVsmFrame`. */
  plan: VsmFramePlan | undefined
  /** The plan whose pages the raster drew (or that had none to draw): another one's pages are not
   *  kept as cached (`finishVirtualShadowFrame`). */
  renderedPlan: VsmFramePlan | undefined
  /** The translucent casters' transmission atlas (`../../../../vsm/transmissionPass.ts`), made with
   *  the first blended caster. */
  transmission?: VsmTransmission
  /** The GPU budget held no first atlas: these maps make none (`vsmTransmission.ts`). */
  transmissionDenied: boolean
  /** The frame a capped or denied atlas is asked again at. */
  transmissionRetry: number
  /** The memory limits already said for these maps, by what they held back. */
  said: Set<'raster' | 'transmission' | 'mask' | 'transmission-full'>
  /** The frame a pool drawn short of the full one may ask to grow again at (`vsmGrant.ts`). */
  regrowFrame: number
  /** The box invalidation read before the plan, and the previous frame's slot count. */
  pendingBoxes: VsmInvalidationPhase | null
  prevSlots: number
  /** Page counters of the stats permutation, read back a few frames late. */
  statsReadback: VsmReadbackRing
  /** Whether the page management compiles the counters (needs 9 storage buffers a stage). */
  countersOn: boolean
  /** Whether the maps have settled, and their contents' version (`../../state/vsmSettle.ts`). */
  settle: VsmSettle
  /** Diagnostics of the last frame. */
  stats: {
    lights: number
    fullMaps: number
    singlePageMaps: number
    projectionPasses: number
    render: VsmRenderStats | undefined
    invalidationThreads: number
    pressureBiasStat: number
    freePages: number
    /** Pages requested / newly allocated / cached (static + dynamic) / cleared then rendered. */
    requestedPages: number
    allocatedPages: number
    cachedPages: number
    renderedPages: number
  }
}

/** The full maps one light takes when it casts: a clipmap's levels for a sun, six faces for a
 *  point, one for a spot. */
const mapsOf = (kind: VsmFrameLight['light']['kind']) =>
  kind === 'directional' ? CLIPMAP_LEVELS : kind === 'point' ? 6 : kind === 'spot' ? 1 : 0

/** Full maps the frame's casting lights need, with room for the unreferenced entries the cache
 *  keeps ten frames, rounded to whole page-table rows: one row at least, which holds a sun and
 *  six more maps with that room. */
export function fullMapsFor(lights: readonly VsmFrameLight[]) {
  let maps = 0
  for (const { light } of lights) {
    if (!light.castsShadow) continue
    maps += mapsOf(light.kind)
  }
  return wholeTableRows(2 * maps + 16)
}

/** The frame's lights that cast a shadow: the mask takes a layer per four of them. */
export function castingCount(lights: readonly VsmFrameLight[]) {
  let count = 0
  for (const { light } of lights) if (light.castsShadow) count++
  return count
}

/** The raster's views the frame's casting lights take at most (`vsmRenderViews`): a view per
 *  clipmap level of one mip, a view per local map of every mip. */
export function renderViewBound(lights: readonly VsmFrameLight[]) {
  let views = 0,
    mips = 0
  for (const { light } of lights) {
    if (!light.castsShadow) continue
    const maps = mapsOf(light.kind)
    views += maps
    mips += light.kind === 'directional' ? maps : maps * VSM_MIPS
  }
  return { viewWords: 4 * views, viewMips: mips }
}

export function directionalCount(lights: readonly VsmFrameLight[]) {
  let count = 0
  for (const { light } of lights) if (light.castsShadow && light.kind === 'directional') count++
  return Math.max(1, count)
}

/** Light slots the marking's ids first hold, and the suns' ids. */
const LIGHT_SLOTS = 256,
  DIRECTIONAL_IDS_BYTES = 4 * 64
/** Copies of the page counters read back at once (`vsmFrameEnd.ts`). */
const STATS_READBACKS = 3
/** Bytes the maps hold beside their set (`vsmResourceBytes`) and the frame's lists: the marking,
 *  the light and sun ids, the status feedback and the counters' readbacks. */
export const ENGINE_VSM_SIDE_BYTES =
  VSM_MARKING_BYTES +
  4 * LIGHT_SLOTS +
  DIRECTIONAL_IDS_BYTES +
  vsmFeedbackReadbackBytes() +
  STATS_READBACKS * VSM_COUNTERS * 4

/** Lands the page counters `mapped` in `stats` (`vsmSubmitted`); the pages drawn. */
function readVsmStats(stats: EngineVsm['stats'], mapped: ArrayBuffer) {
  const words = new Uint32Array(mapped)
  stats.requestedPages = words[VSM_COUNT_WANTED]
  stats.allocatedPages = words[VSM_COUNT_GRANTED]
  stats.cachedPages = words[VSM_COUNT_STATIC_KEPT] + words[VSM_COUNT_DYNAMIC_KEPT]
  return (stats.renderedPages = words[VSM_COUNT_CLEARED])
}

/** The marking's light ids (`EngineVsm.lightIds`): one i32 per light slot. */
export const lightIdsBuffer = (device: GPUDevice, size: number) =>
  device.createBuffer({
    label: 'vsm.engine.lightIds',
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

/** The set's options for `fullMapCapacity` maps and `directional` suns, at `poolPages`:
 *  the receiver cover holds the suns' clipmap levels. */
export const engineVsmOptions = (
  fullMapCapacity: number,
  directional: number,
  poolPages?: number,
): VsmResourceOptions => ({
  fullMapCapacity,
  sunMapCapacity: CLIPMAP_LEVELS * directional + 1,
  poolPages,
})

/** The suns the receiver cover of `options` holds (`engineVsmOptions`). */
const sunsOf = (options: VsmResourceOptions) => ((options.sunMapCapacity ?? 1) - 1) / CLIPMAP_LEVELS

/** Whether `device` takes the page management's counters: their kernels bind one more storage
 *  buffer (the stats permutation, `VsmPageManagementFrame.options`). */
export const vsmCountersOn = (device: GPUDevice) =>
  device.limits.maxStorageBuffersPerShaderStage >= 9

/** The engine's maps of `options` (`engineVsmOptions`, at the pages `vsmPoolWithin` drew): made
 *  whole, or nothing left made (`constructGpuResources`). */
export function createEngineVsm(device: GPUDevice, options: VsmResourceOptions): EngineVsm {
  return constructGpuResources(device, () => {
    const res = createVsmResources(device, options)
    const state = createVsmFrameState(device, res)
    const lightIds = lightIdsBuffer(device, 4 * LIGHT_SLOTS)
    const directionalIds = device.createBuffer({
      label: 'vsm.engine.directionalIds',
      size: DIRECTIONAL_IDS_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    const stats: EngineVsm['stats'] = {
      lights: 0,
      fullMaps: 0,
      singlePageMaps: 0,
      projectionPasses: 0,
      render: undefined,
      invalidationThreads: 0,
      pressureBiasStat: 0,
      freePages: 0,
      requestedPages: 0,
      allocatedPages: 0,
      cachedPages: 0,
      renderedPages: 0,
    }
    const settle = createVsmSettle()
    return {
      res,
      suns: sunsOf(options),
      state,
      marking: createVsmMarking(device, res),
      feedback: new VsmFeedbackReadback(device, state.cache),
      lightIds,
      lightIdsData: new Uint32Array(LIGHT_SLOTS),
      directionalIds,
      mask: undefined,
      plan: undefined,
      renderedPlan: undefined,
      transmissionDenied: false,
      transmissionRetry: 0,
      said: new Set(),
      regrowFrame: 0,
      pendingBoxes: null,
      prevSlots: 0,
      statsReadback: createVsmReadbackRing(
        device,
        { label: 'vsm.engine.statsReadback', bytes: VSM_COUNTERS * 4, count: STATS_READBACKS },
        (mapped, staging) => landVsmStats(settle, staging, readVsmStats(stats, mapped)),
      ),
      countersOn: vsmCountersOn(device),
      settle,
      stats,
    }
  })
}

/**
 * The tables of `vsm` grown in place to `options` (`growVsmTables`): the pool, its pages, their
 * cache and the passes' state kept, the groups that bound the old tables made again. Made whole
 * or not at all (`constructGpuResources`); false when `options` asks no more than held.
 */
export function growEngineVsmTables(
  device: GPUDevice,
  vsm: EngineVsm,
  options: VsmResourceOptions,
) {
  const layout = constructGpuResources(device, () => growVsmTables(device, vsm.res, options))
  if (!layout) return false
  vsm.suns = Math.max(vsm.suns, sunsOf(options))
  rebindVsmPageManagement(vsm.res)
  const { state } = vsm
  const slots = layout.mapSlots
  state.projectionImage = grownImage(state.projectionImage, slots * VSM_PROJECTION_RECORD_BYTES)
  state.nextMapsImage = grownImage(state.nextMapsImage, slots * VSM_NEXT_MAP_BYTES)
  return true
}

/** `image` copied into the prefix of `bytes` bytes. */
function grownImage(image: ArrayBuffer, bytes: number) {
  const grown = new ArrayBuffer(bytes)
  new Uint8Array(grown).set(new Uint8Array(image))
  return grown
}

export function destroyEngineVsm(vsm: EngineVsm) {
  vsm.marking.destroy()
  vsm.feedback.destroy()
  releaseVsmRender(vsm.res)
  releaseVsmPageManagement(vsm.res)
  releaseVsmInvalidation(vsm.res)
  releaseVsmProjection(vsm.res)
  vsm.res.destroy()
  vsm.lightIds.destroy()
  vsm.directionalIds.destroy()
  destroyMask(vsm.mask)
  if (vsm.transmission) releaseVsmTransmission(vsm.transmission)
  vsm.transmission?.destroy()
  vsm.statsReadback.destroy()
}

/** No light reads a shadow this frame. */
export function unshadowLights(store: WebgpuPagesRuntime['lights']['store']) {
  for (let slot = 0; slot < store.count; slot++) store.assignSlice(slot, -1)
}

/** The mask array's layers for `lights` shadowed lights: one per four, one at least. */
export const maskLayersFor = (lights: number) => workgroupCount(lights, VSM_PROJECTION_MAX_LIGHTS)

const maskDescriptor = (width: number, height: number, layers: number) => ({
  label: 'vsm.engine.shadowMask',
  size: [width, height, layers],
  format: VSM_PROJECTION_MASK_FORMAT,
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
})

/** The mask's tile words at `width` × `height`: a texel per projection group. */
const maskTilesDescriptor = (width: number, height: number) => ({
  label: 'vsm.engine.shadowMaskTiles',
  size: vsmProjectionTiles(width, height),
  format: VSM_PROJECTION_TILE_FORMAT,
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
})

/** Bytes of the mask `ensureMask` makes for `lights` shadowed lights at `width` × `height`: its
 *  array and its tile words. */
export const maskBytes = (width: number, height: number, lights: number) =>
  textureBytesOf(maskDescriptor(width, height, maskLayersFor(lights)))! +
  textureBytesOf(maskTilesDescriptor(width, height))!

/** Bytes the mask `vsm` holds: its array and its tile words. */
const heldMaskBytes = ({ mask }: EngineVsm) =>
  mask ? madeTextureBytes(mask.array) + madeTextureBytes(mask.tiles) : 0

const destroyMask = (mask: VsmMask | undefined) => {
  mask?.array.destroy()
  mask?.tiles.destroy()
}

/** Bytes the mask asks beyond the one `vsm` holds, to be made at `width` × `height` for exactly
 *  `lights` shadowed lights (`ensureMask` frees the held one first). */
export function maskGrowth(vsm: EngineVsm, width: number, height: number, lights: number) {
  if (maskKept(vsm, width, height, maskLayersFor(lights), true)) return 0
  return maskBytes(width, height, lights) - heldMaskBytes(vsm)
}

/** Whether the mask of `vsm` serves `layers` layers at `width` × `height`, exactly or at least. */
const maskKept = (
  { mask }: EngineVsm,
  width: number,
  height: number,
  layers: number,
  exact: boolean,
) => {
  const array = mask?.array
  return (
    !!array &&
    array.width === width &&
    array.height === height &&
    (exact ? array.depthOrArrayLayers === layers : array.depthOrArrayLayers >= layers)
  )
}

/** Bytes freeing `vsm` gives back (`destroyEngineVsm`): its set, mask, projection views and blue
 *  noise, raster lists and coloured transmission, each as the device ledger counted it. */
export const engineVsmBytes = (vsm: EngineVsm) =>
  vsm.res.bytes +
  vsmProjectionHeldBytes(vsm.res) +
  heldMaskBytes(vsm) +
  vsmRenderContextBytes(vsm.res) +
  (vsm.transmission ? vsm.transmission.bytes + vsmTransmissionContextBytes(vsm.transmission) : 0)

/** The mask at the targets' size, one layer per four shadowed lights at least — `exact` when the
 *  plan reserves it for every casting light (`reserveProjection`, `vsmGrant.ts`), the frame then
 *  drawing into as many as its own lights take —, made whole or not at all
 *  (`constructGpuResources`). */
export function ensureMask(
  device: GPUDevice,
  vsm: EngineVsm,
  width: number,
  height: number,
  layers: number,
  exact = false,
): VsmMask {
  if (vsm.mask && maskKept(vsm, width, height, layers, exact)) return vsm.mask
  destroyMask(vsm.mask)
  // Never a destroyed mask left in place should the new one be refused (`ledgerTentative`).
  vsm.mask = undefined
  return (vsm.mask = constructGpuResources(device, () => {
    const array = device.createTexture(maskDescriptor(width, height, layers))
    const tiles = device.createTexture(maskTilesDescriptor(width, height))
    return {
      array,
      view: array.createView({ dimension: '2d-array' }),
      tiles,
      tilesView: tiles.createView(),
    }
  }))
}
