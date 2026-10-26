import { EngineError } from '../../contracts/cache.ts'
import { LIGHT_SHAFT_LIGHT_RULES, resolveLightShaftLight } from '../../modules/sky/lightShafts.ts'
import type { SceneLight } from './contracts.ts'
import { ruledLightFields } from './ruledFields.ts'

/**
 * THE LIGHT SHAFT FIELDS OF A LIGHT RECORD (`SceneLight.shaft*`, one for each rule of
 * `LIGHT_SHAFT_LIGHT_RULES`, the one source of their names and defaults): validated by those rules,
 * kept apart from the other fields, and read through `lightShaftOf`, which answers each field's
 * default where the record holds none. The occlusion and the override direction are a directional
 * light's alone; the bloom belongs to every kind of light, and the shafts are drawn for a
 * directional one.
 */
const group = /* @__PURE__ */ ruledLightFields(LIGHT_SHAFT_LIGHT_RULES, resolveLightShaftLight, [
  'shaftOcclusion',
  'shaftOcclusionDarkness',
  'shaftOcclusionDepthRange',
  'shaftOverrideDirection',
])

/** The light shaft fields of `light` into `validated`, each as its rule takes it (the bloom tint's
 *  channels of at least 0), the directional ones refused on another kind. */
export function validateLightShafts(light: SceneLight, validated: SceneLight) {
  group.validate(light, validated)
  const tint = validated.shaftBloomTint
  if (tint?.some((channel) => channel < 0))
    throw new EngineError(
      'INVALID_SCENE_LIGHT',
      `${light.id}: shaftBloomTint expects channels of at least 0`,
      { shaftBloomTint: tint },
    )
}

// Arrow functions, not `group.of`: a property read is not dropped from a bundle that never reads these.
export const lightShaftOf = (light: SceneLight) => group.of(light)
export const sameLightShafts = (a: SceneLight, b: SceneLight) => group.same(a, b)
