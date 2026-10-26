import { CLOUD_SHADOW_LIGHT_RULES, resolveCloudShadowLight } from '../../modules/sky/cloudShadow.ts'
import type { SceneLight } from './contracts.ts'
import { ruledLightFields } from './ruledFields.ts'

/**
 * THE CLOUD SHADOW FIELDS OF A LIGHT RECORD (`SceneLight.castCloudShadows` and the fields beside it,
 * one for each rule of `CLOUD_SHADOW_LIGHT_RULES`, the one source of their names and defaults):
 * validated by those rules, kept apart from the other fields, and read through
 * `cloudShadowOfLight`, which answers each field's default where the record holds none. They are a
 * directional light's alone: the air has the clouds' shade for each of its two lights, and only a
 * directional light can be one.
 */
const group = /* @__PURE__ */ ruledLightFields(CLOUD_SHADOW_LIGHT_RULES, resolveCloudShadowLight)

// Arrow functions, not `group.validate`: a property read is not dropped from a bundle that never
// reads these.
export const validateLightCloudShadow = (light: SceneLight, validated: SceneLight) =>
  group.validate(light, validated)
export const cloudShadowOfLight = (light: SceneLight) => group.of(light)
export const sameLightCloudShadow = (a: SceneLight, b: SceneLight) => group.same(a, b)
