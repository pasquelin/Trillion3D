import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { vectorRejection } from '../../../math/src/wgsl/geometry.ts'
import { LOBE_PACK_WGSL } from '../materials/surface/physicalLobes.ts'
import { ROUGHNESS_FLOOR_WGSL } from './shaderConstantsWgsl.ts'

/**
 * The width of a lobe of roughness `rough`, the one rule of every program that reads it: the
 * roughness held to `ROUGHNESS_FLOOR` (`lobeRoughness`; the weight of the lobe reads it too) and
 * α = its square (`lobeAlpha`). Every surface writer holds its roughness there already, so the
 * clamp changes none of their lobes.
 *
 * The anisotropic lobe's axis at a surface of normal `N` and α = `alpha`, the one construction of
 * every program that reads it (`../materials/surface/physicalLobes.ts`): the stored direction `d` kept
 * orthogonal to the normal, its unit vector as `xyz` and αt = mix(α, 1, strength²) along it as `w`
 * (`lobeAxis`); a direction that is none after the rejection, or a strength of zero, is the round
 * lobe, `xyz` zero and `w` α. `packedLobeAxis` reads them of a texel `w` of the lobes target
 * (direction in `x`, strength in `z`), and `packedCoat` its clear coat: the coat's strength (`z`'s
 * high half) and roughness (`w`), the one reading of every program that decodes a coat.
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
}
fn packedCoat(w:vec4u)->vec2f{return vec2f(unpack2x16unorm(w.z).y,bitcast<f32>(w.w));}`,
)

/** The lobe a surface of roughness `rough` reflects through (`reflectionLobe`): the long axis
 *  `setLobes` left — its direction and αt where the material is anisotropic —, a round lobe elsewhere;
 *  with `lobes` its host declares them (`direct/lobesWgsl.ts`). */
export const reflectionLobeWgsl = (lobes: boolean) =>
  wgslBlock(
    `reflectionLobeWgsl(${lobes})`,
    [LOBE_AXIS_WGSL],
    lobes
      ? `fn reflectionLobe(rough:f32)->vec4f{
 if(lobes.on){return vec4f(lobes.T,lobes.at);}
 return vec4f(0.0,0.0,0.0,lobeAlpha(rough));
}`
      : `fn reflectionLobe(rough:f32)->vec4f{return vec4f(0.0,0.0,0.0,lobeAlpha(rough));}`,
  )
