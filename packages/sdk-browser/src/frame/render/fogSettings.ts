import { resolveSettingsStamped } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  VOLUMETRIC_FOG_RULES,
  type VolumetricFogValues,
} from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The fog's run-time settings, as this image reads them (`fogSettingsOf`): one object, rewritten. */
const resolved = {} as VolumetricFogValues

/** The fog's settings (`VOLUMETRIC_FOG_RULES`) the run holds, resolved: read only where a scene's fog
 *  shows, never for a scene with none. The returned object is the same for every call, and is
 *  rewritten by the next one. */
export function fogSettingsOf(rt: WebgpuPagesRuntime): VolumetricFogValues {
  return resolveSettingsStamped(VOLUMETRIC_FOG_RULES, rt.context, resolved)
}
