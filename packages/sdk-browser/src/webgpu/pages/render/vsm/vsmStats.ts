// The shadow maps' counters, stage times and memory, as the stats panel lists them.
import type { GpuPassTimings } from '../../../../../../sdk-core/src/index.ts'
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { VSM_PASS_PREFIX } from '../../../../stage/passLabels.ts'
import { gpuTotalsBy } from '../../../../stage/mapping.ts'
import { engineVsmBytes } from './engineVsm.ts'
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
  if (name.startsWith('vsm.invalidate')) return 'shadowVsmInvalidationMs'
  // The marking is one pass (`vsm.marking`, `vsmEncode.ts`), the page address update and the
  // clears in it.
  if (name.startsWith('vsm.mark')) return 'shadowVsmMarkingMs'
  if (name.startsWith('vsm.render')) return 'shadowVsmRenderMs'
  if (name.startsWith('vsm.transmission')) return 'shadowVsmTransmissionMs'
  if (name.startsWith('vsm.projection')) return 'shadowVsmProjectionMs'
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
