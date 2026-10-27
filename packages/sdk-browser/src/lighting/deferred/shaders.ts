import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { DISPLAY_VALUE_WGSL } from '../toneMappingWgsl.ts'
import { toneReadWgsl } from '../toneLutRead.ts'
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/scene/core/environment.ts'
import { AS_IS_FLAG, SURFACE_MODEL_MASK } from '../../materials/surface/surfaceModelWord.ts'
import { FINISH_WGSL } from '../../post/finish/finishWgsl.ts'
import { CATMULL_ROM_TAPS_WGSL } from '../../post/taa/historyWgsl.ts'
import {
  FINISH_HOOKS_WGSL,
  PLAIN_HOOKS_WGSL,
  SHARPEN_WGSL,
  UNSHARPENED_WGSL,
} from './composeFragments.ts'
import { linearToSrgb, luminance } from '../../../../math/src/wgsl/color.ts'
import { bilinear4, clampToExtent } from '../../../../math/src/wgsl/sampling.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { VIEW_WGSL } from './worldAtWgsl.ts'

// THE COMPOSITION OF THE LIT IMAGE onto the display, as WGSL: the plain and the finishing programs of
// the lit chain, and the unlit view's. The passes that light the image are `litProgram.ts`'s.

/** Whether the composition reads the as-is pixels of a debug view (`asIs`), or none in a frame that
 *  holds none (`flagless`, OMB-11). */
export type ComposeInput = 'asIs' | 'flagless'

/**
 * A debug view's as-is pixel (a normal or depth surface, `AS_IS_FLAG` in the shading model's bits,
 * the page marks above them ignored), composed after the temporal
 * pass and the chain as a buffer is visualised: the surface's flag and its base colour — what the
 * opaque resolve wrote for it (`colourPassWgsl.ts`) — read at the render texel under the display
 * pixel (`view.surface`, the surfaces' render pixels per display pixel), unfiltered, and shown with
 * the sRGB transfer alone, exactly, no dither. The image's light, the transparents over it and
 * the temporal pass's history are none of it. A raw view's output (`view.viewport.z`) is the
 * chain's. Two loads a pixel, the second on an as-is pixel alone.
 */
const AS_IS_PIXEL = ` if(view.viewport.z==0.0){
  let texel=min(vec2i(pixel.xy*view.surface.xy),vec2i(view.surface.zw));
  if((textureLoad(asIsFlags,texel,0).r&${SURFACE_MODEL_MASK}u)==${AS_IS_FLAG}u){return vec4f(linearToSrgb(textureLoad(asIsBase,texel,0).rgb),1.0);}
 }
`

/** What linear radiance goes through before the display value: `exposed`, the radiance with its
 *  exposure applied, the expression of the curve's rank, and `lit`, the chain of programs lit by
 *  declared lights: the display value is read from the tone table (`toneShown`,
 *  `../toneLutRead.ts`) and the source is sharpened before the curve (`composeFragments.ts`); the
 *  unlit chain is `displayValue` of the curve `none`, the sRGB transfer alone. */
type Chain = { exposed: string; curve: string; lit: boolean }

/**
 * Composition, one source for two separate programs — never a branch in the shader. What differs
 * between the plain and the finishing program is four functions (`composeFragments.ts`).
 * `chain` is what linear radiance goes through before the display value: the tone table's read
 * (`toneShown`), `displayValue` for the unlit chain. The image's alpha (opaque unless the view carries one, `propagateAlpha`) and the raw output of diagnostic views are shared,
 * and so are debug views: an as-is pixel is drawn over the chain's output (`AS_IS_PIXEL`), since a
 * normal or depth material is never exposed nor tone mapped; every other pixel gets the chain, bit
 * for bit as a frame with none (`flagless`).
 * With `finish`, `hdr` is the image the effect chain's last bloom read, and the composition
 * finishes it (`finished`, `../../post/finish/finishWgsl.ts`): its colour fringe, local exposure,
 * the bloom's glow added, the vignette and the grain, before the exposure and the curve, and the
 * dither (`ditherOf`) added to the colour shown.
 * The source is read where the display pixel falls in it (`view.source`): at its size, its pixel
 * as it is; drawn below it with no temporal resolve to rebuild it (`../../webgpu/pages/state/
 * renderScale.ts`), its neighbourhood blended by the Catmull-Rom cubic in five bilinear reads —
 * the one upscale of such an image, held to the colours a pixel can show —, the glow and the local
 * exposure's layers read at the same place.
 */
const composeSource = (chain: Chain, input: ComposeInput, finish: boolean) => {
  const read = input === 'asIs'
  // The lit chain reads the tone table, bound after the as-is pixels' textures
  // (`toneReadEntries`, `compositions.ts`).
  const shown = chain.lit
    ? `toneShown(${chain.exposed},${chain.curve})`
    : `displayValue(${chain.exposed},${chain.curve})`
  return wgslProgram(
    `
@group(0) @binding(0) var hdr:texture_2d<f32>;
@group(0) @binding(1) var<uniform> view:View;
${read ? '@group(0) @binding(2) var asIsFlags:texture_2d<u32>;\n@group(0) @binding(3) var asIsBase:texture_2d<f32>;' : ''}
fn sourceBilinear(at:vec2f)->vec4f{
 let t=at-0.5;let i=vec2i(floor(t));let f=t-floor(t);let size=vec2i(view.source.zw)+1;
 let a=clampToExtent(i,size);let b=clampToExtent(i+1,size);
 return bilinear4(textureLoad(hdr,a,0),textureLoad(hdr,vec2i(b.x,a.y),0),textureLoad(hdr,vec2i(a.x,b.y),0),textureLoad(hdr,b,0),f);
}
fn sourceBicubic(at:vec2f)->vec4f{
 var taps=catmullRomTaps(at,vec2f(1.0),vec2f(1.0));
 var sum=vec4f(0.0);
 for(var k=0;k<5;k++){sum+=sourceBilinear(taps.uv[k])*taps.weight[k];}
 return vec4f(max(sum.rgb,vec3f(0.0)),saturate(sum.a));
}
fn sourceValue(at:vec2f)->vec4f{
 if(all(view.source.xy==vec2f(1.0))){return textureLoad(hdr,vec2i(at),0);}
 return sourceBicubic(at);
}
${finish ? FINISH_HOOKS_WGSL : PLAIN_HOOKS_WGSL}
fn composeAt(at:vec2f,source:vec4f,gain:f32)->vec4f{
 let value=shownAt(source,at,gain);
 let alpha=select(1.0,saturate(value.a),view.preExposure.z!=0.0);
 if(view.viewport.z!=0.0){return vec4f(value.rgb,alpha);}
 let color=${shown};
 return vec4f(color+ditherAt(at),alpha);
}
${chain.lit ? SHARPEN_WGSL : UNSHARPENED_WGSL}
fn composeColor(pixel:vec4f)->vec4f{
${read ? AS_IS_PIXEL : ''} return composeChain(pixel);
}
@fragment fn compose(@builtin(position) pixel:vec4f)->@location(0) vec4f{return composeColor(pixel);}
struct DisplayOutput{@location(0) capture:vec4f,@location(1) canvas:vec4f,}
@fragment fn composePresent(@builtin(position) pixel:vec4f)->DisplayOutput{
 let color=composeColor(pixel);
 return DisplayOutput(color,color);
}`,
    [
      VIEW_WGSL,
      ...(finish ? [FINISH_WGSL] : []),
      FULLSCREEN_VERTEX,
      linearToSrgb,
      bilinear4,
      clampToExtent,
      CATMULL_ROM_TAPS_WGSL,
      ...(chain.lit ? [luminance, toneReadWgsl(read ? 4 : 2)] : [DISPLAY_VALUE_WGSL]),
    ],
  )
}
/** One composition per input: reading the as-is pixels, or none. */
const composeSources = (chain: Chain, finish = false) => ({
  asIs: composeSource(chain, 'asIs', finish),
  flagless: composeSource(chain, 'flagless', finish),
})
/** A lit program's compositions: plain, and finishing the image (#963), which read the tone table
 *  (`lut`). */
const compositionsOf = (chain: Chain) => ({
  plain: composeSources(chain),
  finish: composeSources(chain, true),
  lut: true,
})
/**
 * Contract composition: exposure multiplies linear radiance before the display curve the scene
 * chose — the film curve unless it chose another —, last link of the chain. That is the one of
 * programs lit by declared lights. The image holds light multiplied by its pre-exposure; the
 * scale is `view.preExposure.y`: the exposure over that pre-exposure, the scene's number, or, where
 * it is `'auto'`, the one the GPU measured on this very image and copied there just before
 * (`../../post/exposure/frame.ts`).
 */
export const CONTRACT_COMPOSITIONS = compositionsOf({
  exposed: 'value.rgb*view.preExposure.y',
  curve: 'u32(view.display.x)',
  lit: true,
})
/**
 * Unlit-view composition: identity, from linear to sRGB and nothing else. With no declared
 * source there is no radiance to expose, finish or bring into the display range — albedo is
 * read as-is, which is what benches that compare images pixel for pixel ask for.
 */
export const UNLIT_COMPOSITIONS = {
  plain: composeSources({
    exposed: 'value.rgb',
    curve: `${TONE_MAPPING_RANK.none}u`,
    lit: false,
  }),
}
