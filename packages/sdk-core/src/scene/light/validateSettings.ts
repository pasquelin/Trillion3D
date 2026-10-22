import type { SceneLight } from './contracts.ts'
import { validateLightCloudShadow } from './lightCloudShadow.ts'
import { validateLightShafts } from './lightShafts.ts'

/** The settings a light holds beside its own numbers, validated into `validated`: its light shafts
 *  and its cloud shadows, each by the module that owns the rules of its fields. */
export function validateLightSettings(light: SceneLight, validated: SceneLight) {
  validateLightShafts(light, validated)
  validateLightCloudShadow(light, validated)
}
