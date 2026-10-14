/**
 * The engine's shadows: the virtual shadow maps (`../../../../vsm/`), in their frame order,
 * encoded in the direct-lighting step after the visibility and material passes, before the
 * lighting pass that reads the mask:
 *
 *   invalidation processing (change boxes, previous ids) → planVirtualShadowFrame (CPU: clipmaps,
 *   local lights, ids, projection data) → instance page invalidation → physical page address
 *   update → page marking → page allocation build → non-cluster shadow map render → post render →
 *   projection (traced rays, ≤ 4 lights a pass, one layer of the mask array each) → lighting →
 *   feedback copy, mark rendered, frame data extraction.
 *
 * A shadowed light's `params.y` is `firstVsmId · 64 + k` (`store.assignSlice`): mask channel k
 * = layer k / 4, component k % 4, and the map a non-mask read samples; −1 for a light with no
 * virtual shadow map this frame. The maps the lights take are `vsmLightMaps.ts`'s, the mask
 * `vsmMask.ts`'s.
 */
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { createVsmResources, type VsmResources } from '../../../../vsm/resources.ts'
import { constructGpuResources } from '../../../../gpu/core/errorScope.ts'
import { releaseVsmInvalidation } from '../../../../vsm/castStale.ts'
import type { VsmCastBoxes } from '../../../../vsm/castBoxes.ts'
import { releaseVsmPageManagement } from '../../../../vsm/pageManagementPass.ts'
import { createVsmFrameState, type VsmFrameState } from '../../../../vsm/frameState.ts'
import type { VsmFramePlan } from '../../../../vsm/frameSetup.ts'
import { createVsmProjectionHold } from './vsmProjectionHold.ts'
import { VsmFeedbackReadback, vsmFeedbackReadbackBytes } from '../../../../vsm/cacheManager.ts'
import { createVsmMarking, vsmMarkingBytes, type VsmMarking } from '../../../../vsm/markingPass.ts'
import { releaseVsmRender } from '../../../../vsm/renderPass.ts'
import { releaseVsmProjection } from '../../../../vsm/projectionPass.ts'
import { releaseRowBins } from '../../../../vsm/rowBinsGpu.ts'
import { releaseVsmTransmission } from '../../../../vsm/transmissionContext.ts'
import type { VsmTransmission } from '../../../../vsm/transmissionMade.ts'
import { createReadbackRing, type ReadbackRing } from '../../../../gpu/core/readbackRing.ts'
import { createVsmSettle, landVsmStats, type VsmSettle } from '../../state/vsmSettle.ts'
import {
  VSM_COUNT_CLEARED,
  VSM_COUNTERS,
  VSM_COUNT_DYNAMIC_KEPT,
  VSM_COUNT_GRANTED,
  VSM_COUNT_WANTED,
  VSM_COUNT_STATIC_KEPT,
} from '../../../../vsm/constants.ts'
import type { VsmResourceOptions } from '../../../../vsm/layout.ts'
import type { VsmFrameScratch } from './vsmEncode.ts'
import { destroyMask, type VsmMask } from './vsmMask.ts'
import { sunsOf } from './vsmLightMaps.ts'
import { createVsmEngineStats, type VsmEngineStats } from './vsmStats.ts'

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
  /** What the mask was last projected from (`vsmProjectionHold.ts`). */
  projectionHold: ReturnType<typeof createVsmProjectionHold>
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
  /** The box invalidation read before the plan, the maps the rows' shadow changes stale
   *  (`vsmCastMaps`), and the previous frame's slot count. */
  pendingBoxes: VsmCastBoxes | null
  pendingCastMaps: Uint32Array | null
  prevSlots: number
  /** Page counters of the stats permutation, read back a few frames late. */
  statsReadback: ReadbackRing
  /** Whether the page management compiles the counters (needs 9 storage buffers a stage). */
  countersOn: boolean
  /** Whether the maps have settled, and their contents' version (`../../state/vsmSettle.ts`). */
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
    const stats = createVsmEngineStats()
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
      projectionHold: createVsmProjectionHold(),
      plan: undefined,
      renderedPlan: undefined,
      transmissionDenied: false,
      transmissionRetry: 0,
      said: new Set(),
      regrowFrame: 0,
      pendingBoxes: null,
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
  releaseRowBins(vsm.res.render?.rowBound)
  releaseRowBins(vsm.transmission?.context?.rowBound)
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
