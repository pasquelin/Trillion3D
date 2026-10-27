import { LIGHT_SHADOWED, type SceneLight } from './contracts.ts'

/** What the lights' shadowed values depend on beside the lights (`SceneLightStore.setShadowView`): `dynamicShadows`, the
 *  shadow quality is above 0; no rule of the settings sets it, the frame reads it from the shadow settings. */
export interface LightShadowView {
  dynamicShadows: boolean
}

/** The view with the dynamic shadows on. */
export const NO_LIGHT_SHADOW_VIEW: Readonly<LightShadowView> = /* @__PURE__ */ Object.freeze({
  dynamicShadows: true,
})

/**
 * A light's shadowed value (`LIGHT_SHADOWED`), as the reference builds its shadowed bits: dynamic where the light
 * casts and the view's dynamic shadows are on, static where it casts or wears a light function that holds no
 * slot of the atlas (`slotted` is false), else none.
 */
export const shadowedBitsOf = (light: SceneLight, slotted: boolean, dynamicShadows: boolean) =>
  light.castsShadow
    ? dynamicShadows
      ? LIGHT_SHADOWED.dynamic
      : LIGHT_SHADOWED.static
    : light.lightFunction !== undefined && !slotted
      ? LIGHT_SHADOWED.static
      : LIGHT_SHADOWED.none
