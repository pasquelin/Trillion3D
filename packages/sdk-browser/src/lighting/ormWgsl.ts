import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { LOBE_AXIS_WGSL } from './lobeAxisWgsl.ts'

/**
 * The law of the metallic-roughness and occlusion maps, the one every surface writer reads (the
 * opaque resolve, `../visibility/shader/shadeWgsl.ts`, and the blended surfaces,
 * `../webgpu/blend/shaderSurface.ts`): a material's factor times the texel's channel (one where it
 * has no map), the metalness held to [0, 1] and the roughness to the lobe's floor (`lobeRoughness`),
 * the occlusion mixed from one by its strength.
 */
export const ORM_LAW_WGSL = wgslBlock(
  'ORM_LAW_WGSL',
  [LOBE_AXIS_WGSL],
  `fn ormMetalness(factor:f32,texel:f32)->f32{return clamp(factor*texel,0.0,1.0);}
fn ormRoughness(factor:f32,texel:f32)->f32{return lobeRoughness(factor*texel);}
fn ormOcclusion(strength:f32,texel:f32)->f32{return 1.0+strength*(texel-1.0);}`,
)
