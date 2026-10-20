import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { LOBE_AXIS_WGSL } from './lobeAxisWgsl.ts'

/**
 * The law of the metallic-roughness and occlusion maps, the one every surface writer reads (the
 * opaque resolve, `../visibility/shader/shadeWgsl.ts`, and the blended surfaces,
 * `../blend/shaderSurface.ts`): a material's factor times the texel's channel (one where it
 * has no map), the metalness held to [0, 1] and the roughness to the lobe's floor (`lobeRoughness`),
 * the occlusion mixed from one by its strength.
 *
 * And the one law that widens a surface's roughness by the spread of its normals under a pixel, so
 * a highlight narrower than the pixel's normals is spread over them instead of flickering from one
 * image to the next (specular antialiasing): the spread is a variance of the normals' slopes, added
 * to the lobe's `α²` (`roughnessWidened`, `α` the square of the perceptual roughness), which every
 * reader of the roughness — the direct lights and the reflections alike — then reads. Two sources
 * give it:
 * - `normalFootprintVariance`: the normal's change across one pixel, `dN/dx` and `dN/dy`, through a
 *   pixel filter of variance ¼, doubled, bounded by 0.18 (Kaplanyan & Hoffman 2016, Tokuyoshi &
 *   Kaplanyan 2019): a curved or ribbed surface far away — corrugated sheet, a normal map's ribs —
 *   turns its normal by a pixel's worth and reads rougher, a flat one is unchanged; the bound keeps a
 *   normal that jumps across a pixel (a crease, a sub-pixel facet) from turning a mirror diffuse;
 * - `toksvigVariance`: the spread of normals prefiltered into one, of mean length `r` (a voxel's),
 *   as a von Mises-Fisher lobe of `κ = r(3 − r²)/(1 − r²)`, of Beckmann width `2/κ` (Toksvig;
 *   Neubelt & Pettineo 2013).
 */
export const ORM_LAW_WGSL = wgslBlock(
  'ORM_LAW_WGSL',
  [LOBE_AXIS_WGSL],
  `fn ormMetalness(factor:f32,texel:f32)->f32{return clamp(factor*texel,0.0,1.0);}
fn ormRoughness(factor:f32,texel:f32)->f32{return lobeRoughness(factor*texel);}
fn ormOcclusion(strength:f32,texel:f32)->f32{return 1.0+strength*(texel-1.0);}
fn roughnessWidened(rough:f32,variance:f32)->f32{let a=rough*rough;return min(sqrt(sqrt(a*a+variance)),1.0);}
fn normalFootprintVariance(dNdx:vec3f,dNdy:vec3f)->f32{return min(2.0*0.25*(dot(dNdx,dNdx)+dot(dNdy,dNdy)),0.18);}
fn toksvigVariance(spread:f32)->f32{let r=clamp(spread,1e-4,1.0);return 2.0*(1.0-r*r)/(r*(3.0-r*r));}`,
)
