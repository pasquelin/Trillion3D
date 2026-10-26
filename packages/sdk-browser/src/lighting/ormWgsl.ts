import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { LOBE_AXIS_WGSL } from './lobeAxisWgsl.ts'

/**
 * The law of the metallic-roughness and occlusion maps, the one every surface writer reads (the
 * opaque resolve, `../visibility/shader/shadeWgsl.ts`, and the blended surfaces,
 * `../blend/shaderSurface.ts`): a material's factor times the texel's channel (one where it
 * has no map), the metalness held to [0, 1] and the roughness to the lobe's floor (`lobeRoughness`),
 * the occlusion mixed from one by its strength.
 *
 * And the roughness a material that asks for it takes from the screen-space change of its vertex normal
 * (`normalCurvatureRoughness`, the material's `normalCurvatureToRoughness`, off by default): the larger of
 * the squared changes across one pixel, `dN/dx` and `dN/dy` (of the interpolated vertex normal, before any map bends it),
 * raised to the curve's exponent, scaled, biased and held to [0, 1] (`curve`: scale, bias, exponent, the shading
 * settings `normalCurvatureScale`, `normalCurvatureBias`, `normalCurvatureExponent`); the surface's roughness is
 * then the larger of the two (`normalCurvatureApply`, which also returns the curvature the clear coat takes).
 */
export const ORM_LAW_WGSL = wgslBlock(
  'ORM_LAW_WGSL',
  [LOBE_AXIS_WGSL],
  `fn ormMetalness(factor:f32,texel:f32)->f32{return clamp(factor*texel,0.0,1.0);}
fn ormRoughness(factor:f32,texel:f32)->f32{return lobeRoughness(factor*texel);}
fn ormOcclusion(strength:f32,texel:f32)->f32{return 1.0+strength*(texel-1.0);}
fn normalCurvatureRoughness(dNdx:vec3f,dNdy:vec3f,curve:vec3f)->f32{return saturate(pow(max(dot(dNdx,dNdx),dot(dNdy,dNdy)),curve.z)*curve.x+curve.y);}
/** The curvature of a flat pixel: no change of the normal across it, the curve's bias.*/
fn normalCurvatureFlat(curve:vec3f)->f32{return saturate(curve.y);}
/** (roughness raised to the curvature's, the curvature). */
fn normalCurvatureApply(rough:f32,dNdx:vec3f,dNdy:vec3f,curve:vec3f)->vec2f{let c=normalCurvatureRoughness(dNdx,dNdy,curve);return vec2f(max(rough,c),c);}`,
)
