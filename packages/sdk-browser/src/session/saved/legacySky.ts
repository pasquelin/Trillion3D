import type { ModuleOption } from '../../../../sdk-core/src/modules/descriptor.ts'
import { namesOtherFogLaw } from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import { HEIGHT_FOG_DEFAULTS } from '../../../../sdk-core/src/scene/core/fogHeight.ts'
import type { SavedNode, SavedScene } from './format.ts'

/** The sky light a version-2 scene held as a light node. */
export type LegacySkyLight = NonNullable<SavedNode['light']>

/**
 * The sky module's word for a scene saved before the module (version 2): its air, its fog and its
 * sky light become the module's atmosphere, height fog and sky light parts, each as it was; a height
 * fog keeps the numbers it had by default, not the level's. The sun and the clouds, which that scene
 * never had, are off. The sky light was captured once, and again when the scene changed, never every
 * image: it is not a real-time capture (`realTimeCapture` off), whatever the part's default is.
 * `undefined` where the scene had none of the three, so that it stays without the module.
 */
export function legacySky(
  { fog, atmosphere }: Pick<SavedScene, 'fog' | 'atmosphere'>,
  light: LegacySkyLight | undefined,
): ModuleOption {
  if (!fog && !atmosphere && !light) return undefined
  const { baseDensity, baseHeight } = HEIGHT_FOG_DEFAULTS
  return {
    atmosphere: atmosphere ?? false,
    sun: false,
    clouds: false,
    heightFog: fog
      ? { ...(namesOtherFogLaw(fog) ? {} : { baseDensity, baseHeight }), ...fog }
      : false,
    skyLight: light
      ? {
          realTimeCapture: false,
          intensity: light.values.intensity,
          color: light.color,
          lowerHemisphereIsSolidColor: true,
          lowerHemisphereColor: light.groundColor,
          volumetricScatteringIntensity: light.values.fogScattering,
        }
      : false,
  }
}
