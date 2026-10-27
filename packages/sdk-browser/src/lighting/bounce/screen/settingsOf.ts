import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { createScreenProbeStore } from './store.ts'

/** The screen probes' settings of the view, as the session holds them, resolved once while no value moved (`store.read`): what the
 *  radiance cache of the world's probes follows (`../cache/radianceCache.ts`). */
export function screenProbeSettingsOf(rt: WebgpuPagesRuntime): ScreenProbeSettings {
  const store = (rt.bounce.screen ??= createScreenProbeStore())
  return store.read(rt.context)
}
