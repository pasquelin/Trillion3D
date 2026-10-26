import type { VolumetricFogValues } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { skyLightColor } from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { ResolvedHeightFog } from '../../../../sdk-core/src/scene/core/fogHeight.ts'
import type { SkyLightFogUse } from '../../lighting/fog/viewBlock.ts'
import { cachedLightingPreExposureOf } from '../../post/exposure/frame.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { skyLightReady, skyLightStateOf } from './skyLightState.ts'

/** The number the real-time capture is written multiplied by: the cached lighting's pre-exposure, one for
 *  every image and every view (`cachedLightingPreExposureOf`). */
export const capturePreExposure = cachedLightingPreExposureOf

/** The sky light as the fog reads it this image: what the view block carries (`SkyLightFogUse`)
 *  and the cube of the ready layer, which the programs that lay the fog read through the place of
 *  the fog's own cubemap (`FogRead.cubemap`). */
export interface SkyLightFog extends SkyLightFogUse {
  readonly cube: GPUTextureView
}

/**
 * The sky light as it lights the height fog `fog` in the view drawn now, none where it does not: the
 * project switch `fogReadsSkyLight` is off, the fog's `skyLightScattering` has no strength, the view
 * has no sky lighting (`ViewOverrides.skyLighting`: the views drawn for a capture have none, which
 * keeps a capture from reading itself), or the capture has no cube ready. Nothing is made, and no
 * state read, for a fog that asks nothing.
 */
export function skyLightFogOf(
  rt: WebgpuPagesRuntime,
  fog: ResolvedHeightFog,
  settings: Pick<VolumetricFogValues, 'fogReadsSkyLight'>,
): SkyLightFog | undefined {
  const { strength, roughness } = fog.skyLightScattering
  if (!settings.fogReadsSkyLight || !(strength > 0) || !rt.views.active.overrides.skyLighting)
    return undefined
  const state = skyLightStateOf(rt)
  const ready = skyLightReady(state)
  if (!ready) return undefined
  return {
    strength,
    roughness,
    mips: ready.mips,
    colour: skyLightColor(state.source!.part, true, ready.colorScale, capturePreExposure(rt)),
    cube: ready.cubes[ready.layer],
  }
}
