import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE SHADOW TERMS OF ONE LIGHT AT ONE PIXEL (`shadowTermsOf`), computed once, after the shadow read and the
 * contact shadow, and handed to every term of the light:
 * - `surface`, what weighs the lobes (the diffuse and specular of every model): the pixel's occlusion `ao` where the
 *   light has no shadow bits, else its shadow;
 * - `transmission`, what weighs the transmitted terms (a thin back, a skin, a profile, a hair, an eye's
 *   diffuse): the shadow, 1 where the light has none;
 * - `thickness`, the shadow alone, which the optical depth of a profile and the transmitted colour of a
 *   subsurface read.
 * The contact shadow multiplies the first two. `shadowed` is whether the light has shadow bits (`shadowBitsOf`), whether or
 * not it holds a slot and whether or not the program holds the shadow code.
 */
export const SHADOW_TERMS_WGSL = wgslBlock(
  'SHADOW_TERMS_WGSL',
  [],
  `
struct ShadowTerms{surface:f32,transmission:f32,thickness:f32,}
fn shadowTermsOf(shade:f32,ao:f32,shadowed:bool,contact:f32)->ShadowTerms{
 return ShadowTerms(select(ao,shade,shadowed)*contact,shade*contact,shade);
}`,
)
