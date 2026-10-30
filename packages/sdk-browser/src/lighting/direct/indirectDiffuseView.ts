import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** The diffuse colour of the view of the indirect diffuse light alone: a grey every surface is given, whatever its material. */
export const INDIRECT_DIFFUSE_VIEW_GREY = '0.18'

/**
 * THE VIEW OF THE INDIRECT DIFFUSE LIGHT ALONE, held by the variant of the indirect pass that draws it (`indirectPassWgsl`'s `diffuseView`) and
 * by no other program: the diffuse colour of a pixel's indirect light (`indirectDiffuseColour`) is a grey of 0.18 on any surface, a metal's
 * included, its fuzz and its models' parts added to it as to any diffuse colour (`clothDiffuse`); the surface's own colours stay for the
 * multi-bounce occlusion. The program that lists it lists `clothDiffuse` too.
 */
export const INDIRECT_DIFFUSE_VIEW_WGSL = wgslBlock(
  'INDIRECT_DIFFUSE_VIEW_WGSL',
  [],
  `
fn indirectDiffuseColour(rgb:vec3f,metal:f32)->vec4f{
 return clothDiffuse(vec3f(${INDIRECT_DIFFUSE_VIEW_GREY}),0.0);
}`,
)
