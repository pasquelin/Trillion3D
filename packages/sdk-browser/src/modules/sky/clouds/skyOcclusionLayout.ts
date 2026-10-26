import type { CloudSkyOcclusionLight } from '../../../../../sdk-core/src/modules/sky/cloudSkyOcclusion.ts'
import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import { writeCloudShadowTrace, type CloudShadowImage } from './shadowLayout.ts'
import { CM_PER_KM } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import { SKY_OCCLUSION_FILTER_LAYOUT } from './skyOcclusionWgsl.ts'

/**
 * THE SKY OCCLUSION MAP'S BLOCKS. Its trace is the cloud shadow map's (`./shadow.ts`), the same
 * program and the same layouts: only the block it reads differs. Its map is one texture of `side`
 * texels, the filter writing a second of the same size.
 */

/** The block of the sky occlusion's trace into `out`: the shadow trace's block, with the sky
 *  light's strength and no depth bias, the frame's samples. */
export function writeSkyOcclusionTrace(
  out: Float32Array,
  image: CloudShadowImage,
  light: CloudSkyOcclusionLight,
  part: CloudPart,
) {
  return writeCloudShadowTrace(
    out,
    image,
    { cloudShadowStrength: light.cloudAmbientOcclusionStrength, cloudShadowDepthBiasKm: 0 },
    part,
  )
}

/** The block of the sky occlusion's filter into `out` (`SKY_OCCLUSION_FILTER_LAYOUT.words`
 *  floats), for a map of `side` texels: a texel is the extent over the side, in centimetres. */
export function writeSkyOcclusionFilter(
  out: Float32Array,
  side: number,
  light: CloudSkyOcclusionLight,
  part: CloudPart,
) {
  const { at } = SKY_OCCLUSION_FILTER_LAYOUT
  const texelWorld = (light.cloudAmbientOcclusionExtentKm * CM_PER_KM) / side
  const mul = light.cloudAmbientOcclusionApertureScale
  out.set([side, side, 1 / side, 1 / side], at.size)
  out.set([texelWorld, texelWorld, 1 / texelWorld, 1 / texelWorld], at.texelWorld)
  out.set([mul, 1 - mul, part.settings.baseAltitudeKm * CM_PER_KM, 0], at.aperture)
  return out
}
