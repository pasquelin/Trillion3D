import type { TranslucentObjectShadowField } from '../contracts/translucentObjectShadowOptions.ts'

/** What the view's translucent object shadow setting means (`../contracts/translucentObjectShadowOptions.ts`); the light's, the object's and
 *  the material's are `castTranslucentShadows`, `castVolumetricTranslucentShadow` and `translucentShadowDensityScale`. */
export const TRANSLUCENT_OBJECT_SHADOW_MEANINGS: Readonly<
  Record<TranslucentObjectShadowField, string>
> = {
  translucentObjectShadows:
    "Whether translucent objects cast shadows of their own opacity (false, the default): for each light with classic shadow maps (shadowVirtualEnable off) that sets castTranslucentShadows, each object that sets castVolumetricTranslucentShadow and casts a dynamic shadow is drawn from the light into two float atlases that hold a Fourier series of its opacity along the light, which the light's shadow reads to darken what lies behind the object by the opacity it crosses (times the material's translucentShadowDensityScale). Off, no pass is made and no memory is held; lights with virtual shadow maps never use it.",
}
