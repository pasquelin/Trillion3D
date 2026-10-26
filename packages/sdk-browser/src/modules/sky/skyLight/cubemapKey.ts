import {
  lowerHemisphereOf,
  skyLightCubemapRotation,
} from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { SkyLightInputs } from './captureInputs.ts'
import type { SkyLightTargets } from './targets.ts'

/** The key a cube's capture is made again by: the cube, the angle, the side, the lower hemisphere
 *  (the flag, the colour, the coverage) and the scale the light is given. */
export const cubemapKey = (
  cubemap: GPUTexture,
  t: SkyLightTargets,
  input: SkyLightInputs,
  scale: number,
) => [
  cubemap,
  skyLightCubemapRotation(input.part),
  t.width,
  input.part.light.lowerHemisphereIsSolidColor,
  ...lowerHemisphereOf(input.part.light),
  scale,
]
