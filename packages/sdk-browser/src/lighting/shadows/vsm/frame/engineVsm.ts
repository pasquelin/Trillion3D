/**
 * The engine's shadows: the virtual shadow maps (`../`), in their frame order,
 * encoded in the direct-lighting step after the visibility and material passes, before the
 * lighting pass that reads the mask:
 *
 *   invalidation processing (change boxes, previous ids) → planVirtualShadowFrame (CPU: clipmaps,
 *   local lights, ids, projection data) → instance page invalidation → physical page address
 *   update → page marking → page allocation build → non-cluster shadow map render → post render →
 *   projection (traced rays: the suns' pass, a layer of the suns' mask each, then the local lights' one
 *   pass, four bits a light in the pixel's mask) → lighting →
 *   translucent layers (their own traces) → feedback copy, mark rendered, frame data extraction.
 *
 * A shadowed light's `params.y` is the rank of its record in the projection's view and its two flags
 * (`shadowSliceOf`, `store.assignSlice`): a sun reads its layer of the suns' mask, a local light its
 * lane of the pixel's mask (`vsmMaskLaneOf`), or, past the lanes the mask keeps, one sample of its own
 * map; −1 for a light with no virtual shadow map this frame. The maps the lights take are `vsmLightMaps.ts`'s, the mask
 * `vsmMask.ts`'s.
 */
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { createVsmResources, type VsmResources, vsmNinthStorage } from '../resources.ts'
import { constructGpuResources } from '../../../../gpu/core/deviceLedger.ts'
import { releaseVsmInvalidation } from '../invalidation/castStale.ts'
import type { VsmCastBoxes } from '../invalidation/castBoxes.ts'
import type { CastDiffAsk } from '../../casters/castDiff.ts'
import { releaseVsmPageManagement } from '../pageManagementPass.ts'
import { keepVsmFrame } from '../pageManagementEncode.ts'
import { releaseVsmOcclusion } from '../occlusion/occlusionPass.ts'
import { createVsmFrameState, type VsmFrameState } from '../frameState.ts'
import type { VsmFramePlan } from '../frameSetup.ts'
import type { CompiledTiers } from '../render/renderParamsWgsl.ts'
import { createVsmProjectionHold } from './vsmProjectionHold.ts'
import { VsmFeedbackReadback, vsmFeedbackReadbackBytes } from '../feedbackReadback.ts'
import { VsmOverflowLog } from '../overflowLog.ts'
import { createVsmMarking, vsmMarkingBytes, type VsmMarking } from '../markingPass.ts'
import { releaseVsmRender } from '../render/renderPass.ts'
import { releaseVsmProjection } from '../projection/projectionStore.ts'
import { createReadbackRing, type ReadbackRing } from '../../../../gpu/core/readbackRing.ts'
import {
  createVsmSettle,
  landVsmStats,
  noteVsmIdleFrame,
  type VsmSettle,
} from '../../../../frame/backend/state/vsmSettle.ts'
import {
  VSM_COUNT_CLEARED,
  VSM_COUNTERS,
  VSM_COUNT_DYNAMIC_KEPT,
  VSM_COUNT_EMPTY_PAGES,
  VSM_COUNT_GRANTED,
  VSM_COUNT_WANTED,
  VSM_COUNT_STATIC_KEPT,
  VSM_COUNT_WPO_CONSIDERED,
} from '../constants.ts'
import type { VsmResourceOptions } from '../layout.ts'
import type { VsmFrameScratch } from './vsmEncode.ts'
import { destroyMask, type VsmMask } from './vsmMask.ts'
import { releaseVsmThrottle } from '../throttle.ts'
import { sunMapsOf } from './vsmLightMaps.ts'
import { createVsmEngineStats, resetVsmEngineStats, type VsmEngineStats } from './vsmStats.ts'

/** What the engine keeps of the virtual shadow maps between frames. */
export interface EngineVsm {
  res: VsmResources
  /** The clipmap maps the tables' receiver cover holds (`engineVsmOptions`): more grow them. */
  sunMaps: number
  state: VsmFrameState
  marking: VsmMarking
  feedback: VsmFeedbackReadback
  /** The overflows the frames saw, read back with the feedback. */
  overflow: VsmOverflowLog
  /** i32 per light slot: its first VSM id, −1 for none (marking's `lightVsmIds`). */
  lightIds: GPUBuffer
  /** The words of `lightIds`, as the GPU reads them (−1 is 0xFFFFFFFF). */
  lightIdsData: Uint32Array<ArrayBuffer>
  directionalIds: GPUBuffer
  mask: VsmMask | undefined
  /** What the mask was last projected from (`vsmProjectionHold.ts`). */
  projectionHold: ReturnType<typeof createVsmProjectionHold>
  /** This frame's plan, until `finishVsmFrame`, with the raster's families the frame's pipelines
   *  were compiled for and whether the compute throttle's are too (`planVsmFrame`). */
  plan: (VsmFramePlan & { tiers: CompiledTiers; throttleReady: boolean }) | undefined
  /** The plan whose pages the raster drew (or that had none to draw): another one's pages are not
   *  kept as cached (`finishVirtualShadowFrame`). */
  renderedPlan: VsmFramePlan | undefined
  /** The memory limits already said for these maps, by what they held back. */
  said: Set<'raster' | 'mask'>
  /** The frame a pool drawn short of the full one may ask to grow again at (`vsmGrant.ts`). */
  regrowFrame: number
  /** The pool size the setting asked when the set was made (`vsmAsked`): another size asked makes
   *  the set again, its cache dropped, as a pool whose size changed is. */
  poolAsked: number
  /** The box invalidation read before the plan, the maps the shadow changes stale
   *  (`vsmCastMaps`), the previous frame's slot count, and the diff of the instances' boxes the frame
   *  encodes before it (`followRoots`). */
  pendingBoxes: VsmCastBoxes | null
  pendingDiff: CastDiffAsk | null
  pendingCastMaps: Uint32Array | null
  prevSlots: number
  /** Page counters of the stats permutation, read back a few frames late. */
  statsReadback: ReadbackRing
  /** Whether the page management compiles the counters (needs 9 storage buffers a stage). */
  countersOn: boolean
  /** Whether the maps have settled, and their contents' version (`../../../../frame/backend/state/vsmSettle.ts`). */
  settle: VsmSettle
  /** What its frames rebuild in place (`./vsmEncode.ts`), made at its first frame. */
  frameScratch?: VsmFrameScratch
  /** Diagnostics of the last frame. */
  stats: VsmEngineStats
}

/** Light slots the marking's ids first hold, and the suns' ids. */
const LIGHT_SLOTS = 256,
  DIRECTIONAL_IDS_BYTES = 4 * 64
/** Copies of the page counters read back at once (`vsmFrameEnd.ts`). */
const STATS_READBACKS = 3
/** Bytes the maps hold beside their set (`vsmResourceBytes`) and the frame's lists on a device of
 *  `limits`: the marking, the light and sun ids, the feedback and the counters' readbacks. */
export const engineVsmSideBytes = (limits: GPUSupportedLimits) =>
  vsmMarkingBytes(limits) +
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
  stats.emptyPages = words[VSM_COUNT_EMPTY_PAGES]
  stats.wpoConsideredPages = words[VSM_COUNT_WPO_CONSIDERED]
  return (stats.renderedPages = words[VSM_COUNT_CLEARED])
}

/** The marking's light ids (`EngineVsm.lightIds`): one i32 per light slot. */
export const lightIdsBuffer = (device: GPUDevice, size: number) =>
  device.createBuffer({
    label: 'vsm.engine.lightIds',
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

/** Whether `device` takes the page management's counters, a ninth storage buffer a stage. */
export const vsmCountersOn = vsmNinthStorage

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
    const stats = createVsmEngineStats()
    const overflow = new VsmOverflowLog()
    const settle = createVsmSettle()
    return {
      res,
      sunMaps: sunMapsOf(options),
      state,
      marking: createVsmMarking(device, res),
      feedback: new VsmFeedbackReadback(device, state.cache, overflow),
      overflow,
      lightIds,
      lightIdsData: new Uint32Array(LIGHT_SLOTS),
      directionalIds,
      mask: undefined,
      projectionHold: createVsmProjectionHold(),
      plan: undefined,
      renderedPlan: undefined,
      said: new Set(),
      regrowFrame: 0,
      poolAsked: 0,
      pendingBoxes: null,
      pendingDiff: null,
      pendingCastMaps: null,
      prevSlots: 0,
      statsReadback: createReadbackRing(
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

export function destroyEngineVsm(vsm: EngineVsm) {
  vsm.marking.destroy()
  vsm.feedback.destroy()
  releaseVsmRender(vsm.res)
  releaseVsmPageManagement(vsm.res)
  releaseVsmOcclusion(vsm.res)
  releaseVsmInvalidation(vsm.res)
  releaseVsmProjection(vsm.res)
  releaseVsmThrottle(vsm.res)
  vsm.res.destroy()
  vsm.lightIds.destroy()
  vsm.directionalIds.destroy()
  destroyMask(vsm.mask)
  vsm.statsReadback.destroy()
}

/** Frees the maps `lights` hold and forgets them: the next frame that shadows makes them anew,
 *  their cache restarted. */
export function releaseEngineVsm(lights: WebgpuPagesRuntime['lights']) {
  if (lights.vsm) destroyEngineVsm(lights.vsm)
  lights.vsm = undefined
}

/** The maps `vsm` holds are kept while no light reads a shadow, their cache dropped: the pages in
 *  the pool are no longer known to match the casters (which change unseen), so the next frame that
 *  shadows draws every light uncached, as a pool newly made is, and projects its mask again. The
 *  plan, what it left pending and the frame's counts are forgotten: the set counts no light and no
 *  map, as a frame of no map does, and the frame `frame` settles at once (`noteVsmIdleFrame`). Every
 *  idle frame does it, and a repeat leaves the same state. */
export function dropEngineVsmCache(vsm: EngineVsm, frame: number) {
  vsm.state.cache.invalidate()
  keepVsmFrame(vsm.res, 'drop')
  vsm.projectionHold.drop()
  vsm.plan = undefined
  vsm.renderedPlan = undefined
  vsm.pendingBoxes = null
  vsm.pendingDiff = null
  vsm.pendingCastMaps = null
  resetVsmEngineStats(vsm.stats)
  noteVsmIdleFrame(vsm.settle, frame)
}

/** No light reads a shadow this frame. */
export function unshadowLights(store: WebgpuPagesRuntime['lights']['store']) {
  for (let slot = 0; slot < store.count; slot++) store.assignSlice(slot, -1)
}
