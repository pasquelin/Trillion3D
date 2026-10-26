import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { COLOR_SPACES_WGSL } from './colorSpaceWgsl.ts'

/**
 * What the temporal passes read of the translucency the image was composed with
 * (`../../blend/translucency.ts`), from the texture `translucency` the program binds: the light
 * the layers add in red, green and blue and, in its alpha, the share of the scene they let through,
 * a texel no layer covers holding no light and 1.
 * - `layersAt`: the texel of a render texel, held to the target.
 * - `beforeLayers`: the colour the image held before the layers, from the composed `composed` — the
 *   scene times the transmittance, plus the light —, none where nothing is let through.
 * - `translucencyRatio`: the share of the composed image's luma — in the perceptual space, the root
 *   of the measurement luma — that comes from the layers, `light / (light + before · transmittance
 *   + 0.0005)`.
 */
export const TRANSLUCENCY_WGSL = wgslBlock(
  'TRANSLUCENCY_WGSL',
  [COLOR_SPACES_WGSL],
  `
fn layersAt(c:vec2i)->vec4f{return textureLoad(translucency,min(c,vec2i(textureDimensions(translucency))-vec2i(1)),0);}
fn beforeLayers(composed:vec3f,layers:vec4f)->vec3f{
 return select(vec3f(0.0),max(composed-layers.rgb,vec3f(0.0))/layers.a,layers.a>0.0);
}
fn translucencyRatio(composed:vec3f,layers:vec4f)->f32{
 let light=sqrt(measureLuma(layers.rgb));
 return light/(light+sqrt(measureLuma(beforeLayers(composed,layers)))*layers.a+0.0005);
}`,
)
