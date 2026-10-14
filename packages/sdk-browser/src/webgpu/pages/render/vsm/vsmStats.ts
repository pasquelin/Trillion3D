// The shadow maps' counters, stage times and memory, as the stats panel lists them, and the
// diagnostics a set keeps of its last frame.
import type { GpuPassTimings } from '../../../../../../sdk-core/src/contracts/metrics.ts'
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { VSM_PASS_PREFIX } from '../../../../stage/passLabels.ts'
import { gpuTotalsBy } from '../../../../stage/mapping.ts'
import type { EngineVsm } from './engineVsm.ts'
import { heldMaskBytes } from './vsmMask.ts'
import { vsmProjectionHeldBytes } from '../../../../vsm/projectionPass.ts'
import { vsmRenderContextBytes, type VsmRenderStats } from '../../../../vsm/renderPass.ts'
import { vsmTransmissionContextBytes } from '../../../../vsm/transmissionContext.ts'

/** The diagnostics of a set's last frame (`EngineVsm.stats`). */
export interface VsmEngineStats {
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

/** A set's diagnostics before its first frame. */
export const createVsmEngineStats = (): VsmEngineStats => ({
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
})

/** Bytes freeing `vsm` gives back (`destroyEngineVsm`): its set, mask, projection views and blue
 *  noise, raster lists and coloured transmission, each as the device ledger counted it. */
export const engineVsmBytes = (vsm: EngineVsm) =>
  vsm.res.bytes +
  vsmProjectionHeldBytes(vsm.res) +
  heldMaskBytes(vsm) +
  vsmRenderContextBytes(vsm.res) +
  (vsm.transmission ? vsm.transmission.bytes + vsmTransmissionContextBytes(vsm.transmission) : 0)

/** GPU bytes the shadows hold: the virtual shadow maps — their set, mask, raster lists and
 *  coloured atlas (`engineVsmBytes`, what freeing them gives back). The shadows' term of the
 *  budget's admission (`fundFrameTargets`) and the stats' shadow memory: one count, disjoint from
 *  the screen images (`gpuFrameTargetBytes`). */
export const shadowHeldBytes = ({ lights }: WebgpuPagesRuntime) =>
  lights.vsm ? engineVsmBytes(lights.vsm) : 0

/** The shadow maps' stage times, as the stats panel lists them. */
const VSM_STAGES = [
  'shadowVsmInvalidationMs',
  'shadowVsmMarkingMs',
  'shadowVsmPageManagementMs',
  'shadowVsmRenderMs',
  'shadowVsmProjectionMs',
  'shadowVsmTransmissionMs',
] as const
type VsmStage = (typeof VSM_STAGES)[number]

/** VSM stage of a timed pass, by its label; none for a pass of another stage. */
function vsmStage(name: string): VsmStage | undefined {
  if (!name.startsWith(VSM_PASS_PREFIX)) return undefined
  const kernel = name.slice(VSM_PASS_PREFIX.length)
  if (kernel.startsWith('invalidate')) return 'shadowVsmInvalidationMs'
  // The marking is one pass (`vsmEncode.ts`), the page address update and the clears in it.
  if (kernel.startsWith('mark')) return 'shadowVsmMarkingMs'
  if (kernel.startsWith('render')) return 'shadowVsmRenderMs'
  if (kernel.startsWith('transmission')) return 'shadowVsmTransmissionMs'
  if (kernel.startsWith('projection')) return 'shadowVsmProjectionMs'
  return 'shadowVsmPageManagementMs'
}

/** The frame's VSM counters and stage times, as the stats panel lists them (`shadow…`): each
 *  stage the own shares of its passes (`gpuTotalsBy`), as every stage of the profile, so no stage
 *  passes the image however the device overlaps them. */
export function vsmFrameMetrics(rt: WebgpuPagesRuntime, sample: GpuPassTimings | null | undefined) {
  const vsm = rt.lights.vsm,
    totals = gpuTotalsBy(sample, vsmStage),
    times = {} as Record<VsmStage, number | null>
  for (const stage of VSM_STAGES) times[stage] = totals.get(stage) ?? null
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
    shadowVsmMaps: s ? s.fullMaps + s.singlePageMaps : null,
    shadowVsmPagesRequested: counted?.requestedPages ?? null,
    shadowVsmPagesAllocated: counted?.allocatedPages ?? null,
    shadowVsmPagesCached: counted?.cachedPages ?? null,
    shadowVsmPagesRendered: counted?.renderedPages ?? null,
    shadowVsmFreePages: s?.freePages ?? null,
    shadowVsmLodBias: s?.pressureBiasStat ?? null,
    shadowVsmProjectionPasses: s?.projectionPasses ?? null,
    ...times,
  }
}
