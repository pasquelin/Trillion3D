import { DEG2RAD } from '../../../../math/src/constants.ts'
import { Light } from '../../../../sdk-core/src/world/light/light.ts'
import type { ResolvedSky } from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import type { SunPart } from '../../../../sdk-core/src/modules/sky/sunPart.ts'

/** The sun part as a directional light: placed one unit against its direction, aimed at the origin, its light shafts and cloud shadows as the part sets them,
 *  its disk half the part's apparent diameter. It stands in no scene. */
function sunLight({ light, shafts, cloudShadow, direction }: SunPart) {
  return new Light('directional', {
    color: light.color as [number, number, number],
    intensity: light.intensity,
    castShadow: light.castShadow,
    angularRadius: (light.angle * DEG2RAD) / 2,
    shadowDistance: light.shadowDistance,
    distanceFieldShadows: light.distanceFieldShadows,
    distanceFieldShadowDistance: light.distanceFieldShadowDistance,
    fogScattering: light.fogScattering,
    shadowsFog: light.shadowsFog,
    useTemperature: light.useTemperature,
    temperatureKelvin: light.temperatureKelvin,
    shadowsAir: light.shadowsAir,
    transmittancePerPixel: light.transmittancePerPixel,
    sunDiskTint: light.sunDiskTint as [number, number, number],
    atmosphereSunIndex: light.atmosphereSunIndex as 0 | 1,
    forwardShadingPriority: light.forwardShadingPriority,
    ...shafts,
    shaftOverrideDirection: shafts.shaftOverrideDirection as [number, number, number],
    shaftBloomTint: shafts.shaftBloomTint as [number, number, number],
    ...cloudShadow,
    cloudScatteredLuminanceScale: cloudShadow.cloudScatteredLuminanceScale as [
      number,
      number,
      number,
    ],
    position: [-direction[0], -direction[1], -direction[2]],
    target: [0, 0, 0],
  })
}

/** The lights the sky module holds, in the order a sync meets them: the sun (the sky light is
 *  no node: its part drives the capture). They hang from no scene and are never saved. */
export function skyLights({ sun }: ResolvedSky): readonly Light[] {
  return sun ? [sunLight(sun)] : []
}
