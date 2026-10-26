// The shadow maps' counters, stage times and memory, as the stats panel lists them, and the
// diagnostics a set keeps of its last frame.
import type { GpuPassTimings } from '../../../../../../sdk-core/src/contracts/metrics.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { VSM_STAGES } from '../../../../diagnostic/metricKeys.ts'
import { VSM_PASS_PREFIX } from '../../../../diagnostic/stage/passLabels.ts'
import { gpuTotalsBy } from '../../../../diagnostic/stage/mapping.ts'
import type { EngineVsm } from './engineVsm.ts'
import { readShadowSetting } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { heldMaskBytes } from './vsmMask.ts'
import { vsmProjectionHeldBytes } from '../projection/projectionStore.ts'
import { vsmRenderContextBytes, type VsmRenderStats } from '../render/renderPass.ts'

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
}

/** A set's diagnostics before its first frame. */
export const createVsmEngineStats = (): VsmEngineStats => ({
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
})

/** Bytes freeing `vsm` gives back (`destroyEngineVsm`): its set, mask, projection views and blue
 *  noise and raster lists, each as the device ledger counted it. */
export const engineVsmBytes = (vsm: EngineVsm) =>
  vsm.res.bytes +
  vsmProjectionHeldBytes(vsm.res) +
  heldMaskBytes(vsm) +
  vsmRenderContextBytes(vsm.res)

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
    // raised every map's resolution bias by (`VsmCacheManager.readPoolFeedback`, back to exactly 0
    // once the fill falls). 0 when the full pool draws every page at the level asked.
    shadowResolutionBias: s ? rt.lights.memory.bias + s.pressureBiasStat : null,
    shadowVsmLights: s?.lights ?? null,
    shadowVsmMaps: s ? s.maps : null,
    shadowVsmPagesRequested: counted?.requestedPages ?? null,
    shadowVsmPagesAllocated: counted?.allocatedPages ?? null,
    shadowVsmPagesCached: counted?.cachedPages ?? null,
    shadowVsmPagesRendered: counted?.renderedPages ?? null,
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
