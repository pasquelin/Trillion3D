import {
  RAY_TRACED_AMBIENT_OCCLUSION_FIELD_RULES,
  resolveRayTracedAmbientOcclusion,
  type RayTracedAmbientOcclusionSettings,
  type RayTracedAmbientOcclusionValues,
} from '../../../../../sdk-core/src/contracts/rayTracedAmbientOcclusionOptions.ts'
import { resolveSettingsInto } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { wantsContractLighting } from '../../../frame/prepare/lit.ts'
import { drawsLit } from '../../../visibility/shader/shadeMode.ts'

const values = {} as RayTracedAmbientOcclusionValues
const settings = {} as RayTracedAmbientOcclusionSettings

/** The ray-traced occlusion's settings in the runtime's context, read now into one object (the next call overwrites it). */
function rayTracedAoSettings(rt: Pick<WebgpuPagesRuntime, 'context'>) {
  resolveSettingsInto(RAY_TRACED_AMBIENT_OCCLUSION_FIELD_RULES, rt.context, values)
  return resolveRayTracedAmbientOcclusion(values, settings)
}

/**
 * Whether the image will cast the ray-traced occlusion's rays: the settings want it, the lit view is drawn, and no diffuse global illumination is on (the probes carry their own
 * occlusion then). The lighting keeps the scene trace for this image when it holds (`surfaceCache/lighting/frame.ts`), as it does for the other passes that cast rays.
 */
export const rayTracedAoTraced = (rt: WebgpuPagesRuntime) =>
  !rt.bounce.wanted &&
  rayTracedAoSettings(rt).wanted &&
  wantsContractLighting(rt) &&
  drawsLit(rt.run.diagnostic)
