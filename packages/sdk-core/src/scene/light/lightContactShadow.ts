import {
  LIGHT_CONTACT_SHADOW_RULES,
  resolveLightContactShadow,
} from '../../contracts/lightContactShadowOptions.ts'
import type { SceneLight } from './contracts.ts'
import { ruledLightFields } from './ruledFields.ts'

/**
 * THE CONTACT SHADOW FIELDS OF A LIGHT RECORD (`SceneLight.contactShadowLength` and the fields beside
 * it, one for each rule of `LIGHT_CONTACT_SHADOW_RULES`, the one source of their names and
 * defaults): validated by those rules, kept apart from the other fields, and read through
 * `contactShadowOfLight`, which answers each field's default where the record holds none. Every
 * kind of light has them.
 */
const group = /* @__PURE__ */ ruledLightFields(
  LIGHT_CONTACT_SHADOW_RULES,
  resolveLightContactShadow,
  [],
)

// Arrow functions, not `group.validate`: a property read is not dropped from a bundle that never
// reads these.
export const validateLightContactShadow = (light: SceneLight, validated: SceneLight) =>
  group.validate(light, validated)
export const contactShadowOfLight = (light: SceneLight) => group.of(light)
export const sameLightContactShadow = (a: SceneLight, b: SceneLight) => group.same(a, b)
