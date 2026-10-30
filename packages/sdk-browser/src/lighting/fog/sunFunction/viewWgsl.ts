import { wgslStruct } from '../../../../../math/src/wgsl/decl.ts'
import { MAP_SAMPLER_BINDING } from '../../lightFunction/mapBindings.ts'

/** The binding of the view block in the group of the pass that draws the sun's light function for the fog, after the maps' and their sampler. */
export const SUN_FOG_VIEW_BINDING = MAP_SAMPLER_BINDING + 1

/**
 * THE VIEW BLOCK of the sun's light function for the volumetric fog (`plan.ts` writes it): in `centre.xyz` and `centre.w` the sphere
 * the texture covers, in `right.xyz` and `up.xyz` the unit axes the texture is laid across, `right.w` its side in texels, `up.w` 1 once
 * the texture is drawn this image, `eye.xyz` the eye the function's fade is measured from, and `fade.x` the fade distance, `fade.y` the
 * disabled brightness the share falls to past it: the texture holds the share unfaded, the fade is applied at the point that reads it.
 */
export const SUN_FOG_VIEW_WGSL = wgslStruct(
  'SunFogView',
  [],
  'struct SunFogView{centre:vec4f,right:vec4f,up:vec4f,eye:vec4f,fade:vec4f,}',
)
