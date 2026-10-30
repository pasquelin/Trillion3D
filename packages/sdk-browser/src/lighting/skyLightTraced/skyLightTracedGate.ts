import {
  skyLightRayCount,
  skyLightTracedOn,
  skyLightUpscale,
  RAY_TRACED_SKY_LIGHT_RULES,
  type RayTracedSkyLightSettings,
  type SkyLightRayAsk,
} from '../../../../sdk-core/src/contracts/rayTracedSkyLightOptions.ts'
import {
  resolveSettingsInto,
  rulesOf,
  type SettingValues,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { viewKey } from '../../frame/backend/state/viewKey.ts'
import { grantsStageStorage } from '../../gpu/core/stageStorage.ts'
import { skyLightReady, skyLightStateOf } from '../../frame/render/skyLightState.ts'
import { wantsContractLighting } from '../../frame/prepare/lit.ts'
import { SKY_TRACE_STORAGE_WITH_HAIR } from './skyLightTracedWgsl.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'

const FIELD_RULES = /* @__PURE__ */ rulesOf(RAY_TRACED_SKY_LIGHT_RULES)

/** A view's settings as the last image resolved them, with the image they were resolved for. */
interface ResolvedSettings {
  frame: number
  values: SettingValues<typeof FIELD_RULES>
}
const resolved = new WeakMap<object, ResolvedSettings>()

/** The ray-traced sky light's settings in the runtime's context, resolved once an image for each view (the lighting, the plan and the encode all read them) into the view's own object. */
export function skyLightTracedSettings(rt: Pick<WebgpuPagesRuntime, 'context' | 'gpu' | 'run'>) {
  const key = viewKey(rt.gpu)
  let held = resolved.get(key)
  if (!held) {
    held = { frame: NaN, values: {} as SettingValues<typeof FIELD_RULES> }
    resolved.set(key, held)
  }
  if (held.frame !== rt.run.frame) {
    resolveSettingsInto(FIELD_RULES, rt.context, held.values)
    held.frame = rt.run.frame
  }
  return held.values as RayTracedSkyLightSettings
}

/** What the scene's sky light asks of the rays: its choice, its rays a pixel and its transmission; none while the scene has no sky light. */
export function skyLightTracedAsk(rt: WebgpuPagesRuntime): SkyLightRayAsk | undefined {
  return skyLightStateOf(rt).source?.part.light
}

/** The most rays a pixel casts, held to what the directions' buffer of 256 by 256 pixels fits in one storage binding of the device: 16 bytes a ray. */
export const skyLightRaysMost = (device: GPUDevice, side: number) =>
  Math.max(
    1,
    Math.floor(
      Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize) /
        (side * side * 16),
    ),
  )

/**
 * Whether the image will light the sky by rays: the settings and the sky light want it, no diffuse global illumination is on (the probes carry the sky then), the view lets the sky light
 * light it (its `skyLighting` override, the engine's switch for the sky light's share of the indirect light: the reference's global illumination show flag), the lit view is drawn with its
 * lighting on, and the sky light holds a cube to draw directions from. The lighting keeps the scene trace for this image when it holds (`surfaceCache/lighting/frame.ts`), as it does for the other
 * passes that cast rays.
 */
export function skyLightTracedWanted(
  rt: WebgpuPagesRuntime,
  settings: RayTracedSkyLightSettings = skyLightTracedSettings(rt),
) {
  if (!settings.rayTracedSkyLightAllowed) return false
  const ask = skyLightTracedAsk(rt)
  return (
    !!ask &&
    skyLightTracedOn(settings, ask) &&
    !rt.bounce.wanted &&
    rt.views.active.overrides.skyLighting &&
    wantsContractLighting(rt) &&
    drawsLit(rt.run.diagnostic) &&
    !!skyLightReady(skyLightStateOf(rt))
  )
}

/**
 * The numbers an image lights the sky by rays with: the rays a pixel casts and the whole division of the image they are cast at. Only the decoupled generation (its directions' table of
 * `side` by `side` pixels, `samples` records each) is held to the room of a storage binding; a pixel that draws its own directions casts the count the settings and the sky light ask for.
 */
export function skyLightTracedCounts(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  side: number,
  settings: RayTracedSkyLightSettings,
) {
  const asked = skyLightRayCount(settings, skyLightTracedAsk(rt)!)
  return {
    samples: settings.rayTracedSkyLightDecoupleSampleGeneration
      ? Math.min(asked, skyLightRaysMost(device, side))
      : asked,
    upscale: skyLightUpscale(settings),
  }
}

/** What the sky rays read of the strands' voxels. */
export interface SkyLightHairVoxels {
  set: NonNullable<WebgpuPagesRuntime['gpu']['hair']>['voxel']['set'] & object
  jitter: number
  density: number
  stepping: number
  occlusion: number
}

/** The strands' voxels of each view, held and refilled in place by each call of `skyLightHairVoxels` (the plan keeps a reference: a view's own object, so that another view's call leaves it as it is). */
const hairVoxelsOf = new WeakMap<object, SkyLightHairVoxels>()

/**
 * The strands' voxels the sky rays are also marched through, none where the view holds no strands or no volume of them, the setting is off (`rayTracedSkyLightHairVoxel`) or the device grants a
 * stage too few storage buffers for the trace to bind them. The reference chooses its hair permutation of the trace the same way (`HasViewHairStrandsData`, `HasViewHairStrandsVoxelData` and its cvar),
 * and marches with the voxel volume's jitter, its density scale and its stepping scale for rays (`DensityScale_Raytracing`, `SteppingScale_Raytracing`: `hairVoxelDensityScaleRaytracing` and
 * `hairVoxelSteppingScaleRaytracing`, which follow the global scales while below 0) and the hair count it takes to block a ray (`Raytracing_SkyOcclusionThreshold`: `rayTracedSkyLightHairOcclusionThreshold`).
 */
export function skyLightHairVoxels(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  settings: RayTracedSkyLightSettings,
) {
  const hair = rt.gpu.hair
  const set = hair?.voxel.set
  if (
    !settings.rayTracedSkyLightHairVoxel ||
    !hair?.visible ||
    !set ||
    !hair.inputs.voxel ||
    !grantsStageStorage(device, 'compute', SKY_TRACE_STORAGE_WITH_HAIR)
  )
    return undefined
  const key = viewKey(rt.gpu)
  let held = hairVoxelsOf.get(key)
  if (!held) {
    held = { set, jitter: 0, density: 0, stepping: 1, occlusion: 1 }
    hairVoxelsOf.set(key, held)
  }
  held.set = set
  held.jitter = hair.inputs.voxel.jitterMode
  held.density = hair.inputs.voxel.densityScaleRaytracing
  held.stepping = hair.inputs.voxel.steppingScaleRaytracing
  held.occlusion = settings.rayTracedSkyLightHairOcclusionThreshold
  return held
}
