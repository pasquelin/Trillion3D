// The shadow maps' counters, stage times and memory, as the stats panel lists them, and the
// diagnostics a set keeps of its last frame.
import type { GpuPassTimings } from '../../../../../../sdk-core/src/contracts/metrics.ts'
import type { GpuTimingSample } from '../../../../gpu/timing/types.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { VSM_STAGES } from '../../../../diagnostic/metricKeys.ts'
import { VSM_PASS_PREFIX } from '../../../../diagnostic/stage/passLabels.ts'
import { gpuTotalsBy } from '../../../../diagnostic/stage/mapping.ts'
import { passWindowMs } from '../../../../gpu/timing/spans.ts'
import { RENDER_LABEL } from '../render/renderPipes.ts'
import { BUILD_PASS } from '../occlusion/occlusionPass.ts'
import type { EngineVsm } from './engineVsm.ts'
import { readShadowSetting } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { heldMaskBytes } from './vsmMask.ts'
import { vsmProjectionHeldBytes } from '../projection/projectionStore.ts'
import { vsmRenderContextBytes, type VsmRenderStats } from '../render/renderPass.ts'
import { vsmThrottleBytes } from '../throttle.ts'

/** The diagnostics of a set's last frame (`EngineVsm.stats`). */
export interface VsmEngineStats {
  lights: number
  /** The frame's maps and the page-table blocks their tables take (`tableBlocks.ts`). */
  maps: number
  tableBlocks: number
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
  /** Pool pages left with no word, and cached pages kept for the cull of the offsets allowed on them. */
  emptyPages: number
  wpoConsideredPages: number
}

/** The diagnostics of a set that counted nothing: before its first frame, or after a frame that
 *  shadowed no light. */
const NO_STATS: Readonly<VsmEngineStats> = Object.freeze({
  lights: 0,
  maps: 0,
  tableBlocks: 0,
  projectionPasses: 0,
  render: undefined,
  invalidationThreads: 0,
  pressureBiasStat: 0,
  freePages: 0,
  requestedPages: 0,
  allocatedPages: 0,
  cachedPages: 0,
  renderedPages: 0,
  emptyPages: 0,
  wpoConsideredPages: 0,
})

/** A set's diagnostics before its first frame. */
export const createVsmEngineStats = (): VsmEngineStats => ({ ...NO_STATS })

/** `stats` zeroed in place: the object the panel and the inspection hold stays the same. */
export const resetVsmEngineStats = (stats: VsmEngineStats) => void Object.assign(stats, NO_STATS)

/** Bytes freeing `vsm` gives back (`destroyEngineVsm`): its set, mask, projection views and blue
 *  noise and raster lists, each as the device ledger counted it. */
export const engineVsmBytes = (vsm: EngineVsm) =>
  vsm.res.bytes +
  vsmProjectionHeldBytes(vsm.res) +
  heldMaskBytes(vsm) +
  vsmRenderContextBytes(vsm.res) +
  vsmThrottleBytes(vsm.res)

/** GPU bytes the shadows hold: the virtual shadow maps — their set, mask and raster lists
 *  (`engineVsmBytes`, what freeing them gives back). The shadows' term of the
 *  budget's admission (`fundFrameTargets`) and the stats' shadow memory: one count, disjoint from
 *  the screen images (`gpuFrameTargetBytes`). */
export const shadowHeldBytes = ({ lights }: WebgpuPagesRuntime) =>
  lights.vsm ? engineVsmBytes(lights.vsm) : 0

type VsmStage = (typeof VSM_STAGES)[number]

/** VSM stage of a timed pass, by its label; none for a pass of another stage. */
function vsmStage(name: string): VsmStage | undefined {
  if (!name.startsWith(VSM_PASS_PREFIX)) return undefined
  const kernel = name.slice(VSM_PASS_PREFIX.length)
  if (kernel.startsWith('invalidate')) return 'shadowVsmInvalidationMs'
  // The marking is one pass (`vsmEncode.ts`), the page address update and the clears in it.
  if (kernel.startsWith('mark')) return 'shadowVsmMarkingMs'
  if (kernel.startsWith('render')) return 'shadowVsmRenderMs'
  if (kernel.startsWith('projection')) return 'shadowVsmProjectionMs'
  return 'shadowVsmPageManagementMs'
}

/** The stage times of the last sample: made once an image, read by the metrics each time. */
let timedSample: GpuPassTimings | null | undefined,
  timedStages: Record<VsmStage, number | null> | undefined

function stageTimes(sample: GpuPassTimings | null | undefined) {
  if (timedStages && sample === timedSample) return timedStages
  const totals = gpuTotalsBy(sample, vsmStage),
    times = {} as Record<VsmStage, number | null>
  for (const stage of VSM_STAGES) times[stage] = totals.get(stage) ?? null
  timedSample = sample
  return (timedStages = times)
}

/** Whether a timed pass is of the shadow raster's budget: the raster's passes (`vsm.render…`: the
 *  descent runs in their culls) and the occlusion pyramid's build. */
const budgetedPass = (name: string) => name.startsWith(RENDER_LABEL) || name === BUILD_PASS.label

/** The GPU time of the shadow raster in `sample`: the window of its passes, their gaps included
 *  (`passWindowMs`: 0 where none ran, null where no usable time). What the shadow raster's time
 *  budget is fitted to (`shadowDynamicResolutionTimeBudgetMs`). */
export const vsmRenderMs = (sample: GpuTimingSample | null | undefined) =>
  passWindowMs(sample, budgetedPass)

/** The page counters of the last frame (`counted`, the set's stats where its counters are on), null
 *  where they are off. */
const pageCounters = (counted: VsmEngineStats | undefined) => ({
  shadowVsmPagesRequested: counted?.requestedPages ?? null,
  shadowVsmPagesAllocated: counted?.allocatedPages ?? null,
  shadowVsmPagesCached: counted?.cachedPages ?? null,
  shadowVsmPagesRendered: counted?.renderedPages ?? null,
  shadowVsmPagesEmpty: counted?.emptyPages ?? null,
  shadowVsmPagesWpoConsidered: counted?.wpoConsideredPages ?? null,
})

/** The frame's VSM counters and stage times, as the stats panel lists them (`shadow…`): each
 *  stage the own shares of its passes (`gpuTotalsBy`), as every stage of the profile, so no stage
 *  passes the image however the device overlaps them. */
export function vsmFrameMetrics(rt: WebgpuPagesRuntime, sample: GpuPassTimings | null | undefined) {
  const vsm = rt.lights.vsm,
    times = stageTimes(sample)
  const s = vsm?.stats,
    counted = vsm?.countersOn ? s : undefined
  return {
    shadowPoolBytes: vsm ? shadowHeldBytes(rt) : null,
    // How far the shadows draw coarser than they ask because of their page pool, what the
    // reference mode's `assertFullShadowPool` refuses above 0: the halvings the GPU budget took
    // off the full pool (`ShadowMemory.bias`, `vsmGrant.ts`), plus the levels the pool's fill
    // raised every map's resolution bias by (`VsmCacheManager.readPoolFeedback`; published as 0
    // once under `VSM_PRESSURE_BIAS_NONE`, where its fall stalls). 0 when the full pool draws
    // every page at the level asked.
    shadowResolutionBias: s ? rt.lights.memory.bias + s.pressureBiasStat : null,
    shadowVsmLights: s?.lights ?? null,
    shadowVsmMaps: s ? s.maps : null,
    ...pageCounters(counted),
    shadowVsmFreePages: s?.freePages ?? null,
    shadowVsmLodBias: s?.pressureBiasStat ?? null,
    shadowVsmProjectionPasses: s?.projectionPasses ?? null,
    // The placement worlds noted moved and the root boxes derived, in all: their difference per image
    // says whether a moved placement reached the diff of the instances' boxes (`castDiff.ts`).
    shadowVsmRootsNoted: vsm ? (rt.rootWorlds?.noted ?? 0) : null,
    shadowVsmRootsBoxed: vsm ? (rt.rootBoxes?.boxed ?? 0) : null,
    // Reported when the option lets the overflows show (`shadowAllowScreenOverflowMessages`).
    shadowVsmOverflowFlags: vsm
      ? readShadowSetting(rt, 'shadowAllowScreenOverflowMessages')
        ? vsm.overflow.recent(performance.now())
        : 0
      : null,
    ...times,
  }
}
