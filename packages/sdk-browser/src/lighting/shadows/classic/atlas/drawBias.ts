import { clamp } from '../../../../../../math/src/scalar/reals.ts'
import { VSM_LEVEL0_TEXELS, VSM_UNIT_PER_CM } from '../../vsm/constants.ts'
import { BIAS_FACTOR_MAX, DEFAULT_SHADOW_BIAS } from '../classicView.ts'
import type { DrawBias } from './atlasPlan.ts'

/**
 * THE DEPTH BIAS A CLASSIC MAP'S CASTERS ARE DRAWN WITH (`atlasRasterWgsl.ts` applies it per vertex): a sun's cascade and a spot light's map take a constant bias grown by the slope of
 * the surface; a point light's cube takes none at the draw (its receivers carry the bias, `classicTraceWgsl.ts`). Distances are in the engine's units. The slope factor of a cascade is
 * left out while the cascades are cached (`shadowCsmCaching`): a cached depth must not depend on the normals it was drawn with.
 */

/** The settings the biases are made from. */
export interface DrawBiasSettings {
  readonly shadowCsmDepthBias: number
  readonly shadowCsmSlopeScaleDepthBias: number
  readonly shadowMaxCsmResolution: number
  readonly shadowCsmCaching: boolean
  readonly shadowSpotLightDepthBias: number
  readonly shadowSpotLightSlopeScaleDepthBias: number
  readonly shadowMaxSlopeScaleDepthBias: number
}

/** A light's own factors on the constant bias and on the slope bias (`SceneLight.shadowBias`, `shadowSlopeBias`), held to the range the shader's word holds. */
export interface UserBias {
  readonly bias?: number
  readonly slope?: number
}
const factor = (x = DEFAULT_SHADOW_BIAS) => clamp(x, 0, BIAS_FACTOR_MAX)

/** The bias of a cascade bounded by a sphere of `radius` (units): the constant is the setting's times a texel of the sphere at the cascade's `resolution` (the setting's unless the atlas holds it down, `cascadeResolutionIn`). */
export function cascadeDrawBias(
  radius: number,
  s: DrawBiasSettings,
  user: UserBias = {},
  resolution = s.shadowMaxCsmResolution,
): DrawBias {
  return {
    constant: s.shadowCsmDepthBias * (radius / resolution) * factor(user.bias),
    slope: s.shadowCsmCaching ? 0 : s.shadowCsmSlopeScaleDepthBias * factor(user.slope),
    maxSlope: s.shadowMaxSlopeScaleDepthBias,
  }
}

/** The bias of a spot light's map drawn at `mip` of its map (`VSM_LEVEL0_TEXELS >> mip` texels a side). */
export function spotDrawBias(mip: number, s: DrawBiasSettings, user: UserBias = {}): DrawBias {
  return {
    constant:
      ((s.shadowSpotLightDepthBias * 512) / (VSM_LEVEL0_TEXELS >> mip)) *
      VSM_UNIT_PER_CM *
      2 *
      factor(user.bias),
    slope: s.shadowSpotLightSlopeScaleDepthBias * factor(user.slope),
    maxSlope: s.shadowMaxSlopeScaleDepthBias,
  }
}
