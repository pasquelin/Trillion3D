import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { loadHeld } from '../../../../math/src/wgsl/sampling.ts'
import { COLOR_SPACES_WGSL } from './colorSpaceWgsl.ts'

/**
 * What the temporal passes read of the translucency the image was composed with
 * (`../../blend/translucency.ts`), from the texture `translucency` the program binds: the light
 * the layers add in red, green and blue and, in its alpha, the share of the scene they let through,
 * a texel no layer covers holding no light and 1.
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
fn beforeLayers(composed:vec3f,layers:vec4f)->vec3f{
 return select(vec3f(0.0),max(composed-layers.rgb,vec3f(0.0))/layers.a,layers.a>0.0);
}
fn translucencyRatio(composed:vec3f,layers:vec4f)->f32{
 let light=sqrt(measureLuma(layers.rgb));
 return light/(light+sqrt(measureLuma(beforeLayers(composed,layers)))*layers.a+0.0005);
}`,
)

/**
 * The read of layers drawn smaller than the image (`translucencyScale.ts`), compiled only by the programs that run while they are:
 * `reducedLayersAt` gives the layers at the image's texel `p` as the four texels around its place read bilinearly, the place the
 * texel's centre has in the `drawn` texels the layers cover of the `render` ones, held to the last texel centre drawn
 * (`shownTranslucencyDrawn`). A program of layers the image's size reads the texel itself (`layersRead`).
 */
const REDUCED_LAYERS_WGSL = wgslBlock(
  'REDUCED_LAYERS_WGSL',
  [],
  `
fn reducedLayersAt(layers:texture_2d<f32>,p:vec2i,render:vec2f,drawn:vec2f)->vec4f{
 let t=clamp((vec2f(p)+0.5)*drawn/render,vec2f(0.5),drawn-vec2f(0.5))-vec2f(0.5);
 let a=vec2i(floor(t));
 let w=t-floor(t);
 let b=min(a+vec2i(1),vec2i(drawn)-vec2i(1));
 let top=mix(textureLoad(layers,a,0),textureLoad(layers,vec2i(b.x,a.y),0),w.x);
 let bottom=mix(textureLoad(layers,vec2i(a.x,b.y),0),textureLoad(layers,b,0),w.x);
 return mix(top,bottom,w.y);
}`,
)

/** How a program reads the texture `translucency` at the texel `p` (a WGSL expression): the texel itself, or — `reduced`, the
 *  layers drawn smaller than the image — bilinear through the size they were drawn at, which the uniform `view` holds
 *  (`resurrection.zw`) beside the render grid; `uses` is the block the read needs, to put where `loadHeld` stood. */
export const layersRead = (reduced: boolean, p: string) => ({
  text: reduced
    ? `reducedLayersAt(translucency,${p},view.render.xy,view.resurrection.zw)`
    : `loadHeld(translucency,${p})`,
  uses: reduced ? REDUCED_LAYERS_WGSL : loadHeld,
})
