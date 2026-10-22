import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { createScreenProbeStore } from './store.ts'

/** The screen probes' settings of the view, as the session holds them, resolved once while no value moved (`store.read`): what the
 *  radiance cache of the world's probes follows (`../cache/radianceCache.ts`). */
export function screenProbeSettingsOf(rt: WebgpuPagesRuntime): ScreenProbeSettings {
  const store = (rt.bounce.screen ??= createScreenProbeStore())
  return store.read(rt.context)
}

/** The probes an image traces, in the cost of a whole map each (`probePlan.ts`): the host's count (`bounceProbesPerFrame`), else the
 *  level's row of the radiance cache scaled by the update speed. */
export const probesPerFrameOf = (rt: WebgpuPagesRuntime) =>
  rt.bounce.probesPerFrame ?? screenProbeSettingsOf(rt).cache.budget
