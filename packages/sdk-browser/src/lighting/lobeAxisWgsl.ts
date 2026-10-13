import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { vectorRejection } from '../../../math/src/wgsl/geometry.ts'
import { LOBE_PACK_WGSL } from '../scene/physicalLobes.ts'
import { ROUGHNESS_FLOOR_WGSL } from './shaderConstantsWgsl.ts'

/**
 * The width of a lobe of roughness `rough`, the one rule of every program that reads it: the
 * roughness held to `ROUGHNESS_FLOOR` (`lobeRoughness`; the weight of the lobe reads it too) and
 * α = its square (`lobeAlpha`). Every surface writer holds its roughness there already, so the
 * clamp changes none of their lobes.
 *
 * The anisotropic lobe's axis at a surface of normal `N` and α = `alpha`, the one construction of
 * every program that reads it (`../scene/physicalLobes.ts`): the stored direction `d` kept
 * orthogonal to the normal, its unit vector as `xyz` and αt = mix(α, 1, strength²) along it as `w`
 * (`lobeAxis`); a direction that is none after the rejection, or a strength of zero, is the round
 * lobe, `xyz` zero and `w` α. `packedLobeAxis` reads them of a texel `w` of the lobes target
 * (direction in `x`, strength in `z`).
 */
export const LOBE_AXIS_WGSL = wgslBlock(
  'LOBE_AXIS_WGSL',
  [LOBE_PACK_WGSL, vectorRejection, ROUGHNESS_FLOOR_WGSL],
  `fn lobeRoughness(rough:f32)->f32{return clamp(rough,ROUGHNESS_FLOOR,1.0);}
fn lobeAlpha(rough:f32)->f32{let r=lobeRoughness(rough);return r*r;}
fn lobeAxis(d:vec3f,strength:f32,N:vec3f,alpha:f32)->vec4f{
 let t=vectorRejection(d,N);let l=dot(t,t);
 if(!(l>1e-12)||!(strength>0.0)){return vec4f(0.0,0.0,0.0,alpha);}
 return vec4f(t*inverseSqrt(l),mix(alpha,1.0,strength*strength));
}
fn packedLobeAxis(w:vec4u,N:vec3f,alpha:f32)->vec4f{
 return lobeAxis(lobeOctDecode(w.x),unpack2x16unorm(w.z).x,N,alpha);
}`,
)
