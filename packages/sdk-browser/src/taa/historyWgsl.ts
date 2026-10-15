import * as layer from './layers.ts'
import { REACTIVE_MAX } from './reactive.ts'
import { HISTORY_SAMPLES_MAX, LUMA_TO_CHANNEL } from './shadingHistoryWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { GOLDEN_U32 } from '../../../math/src/wgsl/constants.ts'
import { clampToExtent, hashUnit } from '../../../math/src/wgsl/sampling.ts'

/** The samples a history read a display pixel or more away keeps beside the current one. */
const MOVING_SAMPLES = 4

/** `text` in a resolve that carries the as-is share, `none` in the flagless one. */
export const shareText =
  (asIs: boolean) =>
  (text: string, none = '') =>
    asIs ? text : none

/**
 * The history read, moving or still: Catmull-Rom on the 4×4 texels around the point, in five
 * bilinear taps — the four corners, which weigh least, dropped and the rest renormalised.
 * Bilinear softens the history a little every image the pixel moves by a fraction;
 * Catmull-Rom keeps its sharpness. Its negative lobes may overshoot: the neighbour box clamps them.
 * At rest the point is a texel centre, where its weights are (0, 1, 0, 0) on each axis: the one
 * centre tap, the texel itself, exactly.
 */
export const CATMULL_ROM_WGSL = wgslBlock(
  'CATMULL_ROM_WGSL',
  [],
  `
fn historyCatmullRom(uv:vec2f)->vec4f{
 let p=uv*view.viewport.xy;
 let c=floor(p-0.5)+0.5;
 let f=p-c;
 let w0=f*(-0.5+f*(1.0-0.5*f));
 let w1=1.0+f*f*(-2.5+1.5*f);
 let w2=f*(0.5+f*(2.0-1.5*f));
 let w3=f*f*(-0.5+0.5*f);
 let w12=w1+w2;
 let t0=(c-1.0)*view.viewport.zw;
 let t3=(c+2.0)*view.viewport.zw;
 let t12=(c+w2/w12)*view.viewport.zw;
 var sum=textureSampleLevel(history,historySampler,vec2f(t12.x,t0.y),0.0)*(w12.x*w0.y);
 sum+=textureSampleLevel(history,historySampler,vec2f(t0.x,t12.y),0.0)*(w0.x*w12.y);
 sum+=textureSampleLevel(history,historySampler,t12,0.0)*(w12.x*w12.y);
 sum+=textureSampleLevel(history,historySampler,vec2f(t3.x,t12.y),0.0)*(w3.x*w12.y);
 sum+=textureSampleLevel(history,historySampler,vec2f(t12.x,t3.y),0.0)*(w12.x*w3.y);
 let total=w12.x*w0.y+w0.x*w12.y+w12.x*w12.y+w3.x*w12.y+w12.x*w3.y;
 return max(sum/total,vec4f(0.0));
}`,
)

/**
 * The history texel a pixel's shading measures are read from: the nearest to its reprojected point,
 * after an offset of up to half a texel drawn per pixel and image: a point read, dithered. A still
 * pixel reads its own texel; a moving one does not drift by always rounding one way.
 */
export const HISTORY_TEXEL_WGSL = wgslBlock(
  'HISTORY_TEXEL_WGSL',
  [hashUnit, clampToExtent, GOLDEN_U32],
  `
fn historyTexel(uv:vec2f,coord:vec2i)->vec2i{
 let seed=(u32(coord.y)*65536u+u32(coord.x))*8u+u32(view.jitter.w);
 // The golden salt flips the seed for the second coordinate, so it is decorrelated from the first (historyTexel.test.ts).
 let offset=vec2f(hashUnit(seed),hashUnit(seed^GOLDEN_U32))*0.999-0.4995;
 return clampToExtent(vec2i(floor(uv*view.viewport.xy+offset)),vec2i(view.viewport.xy));
}`,
)

/**
 * The most samples a moving pixel's history keeps, the current one included (a history at the
 * display's size): four beside the current one once the history is read a display pixel or more
 * away, linearly more below, up to `HISTORY_SAMPLES_MAX` still — the history resampled each image
 * softens, a short one less —, unless the current luma differs from the kept history's by more: a
 * high-contrast edge keeps that share of the full history, so it stays stable.
 * `speed`: how far the history moved under the pixel, display pixels; `now` and `kept`: the YCoCg
 * luma of the current image and of the boxed history. (A history kept at twice the display's size
 * would need no such cap, at four times this one's cost.)
 */
export const HISTORY_CAP_WGSL = wgslBlock(
  'HISTORY_CAP_WGSL',
  [],
  `
fn historyCap(speed:f32,now:f32,kept:f32)->f32{
 let contrast=abs(now-kept)/max(max(now,kept),1e-6);
 return 1.0+${HISTORY_SAMPLES_MAX}.0*max(1.0-${1 - MOVING_SAMPLES / HISTORY_SAMPLES_MAX}*saturate(speed),contrast);
}`,
)

/**
 * The current image's share (the blend's sixth point): the accumulation's `share`, raised to the
 * pixel's reactive value `rho`, never above `REACTIVE_MAX`; a pixel with no history (`fresh`) takes
 * the current sample whole.
 */
export const CURRENT_SHARE_WGSL = wgslBlock(
  'CURRENT_SHARE_WGSL',
  [],
  `
fn currentShare(share:f32,rho:f32,fresh:bool)->f32{
 if(fresh){return 1.0;}
 return max(share,min(rho,${REACTIVE_MAX}));
}`,
)

/**
 * What the resolve closes with, once `previous` (and the points it came from, `here` and
 * `before`), `speed`, `motion`, `refused`, `filtered`, its luma `lumaNow` and measurement lumas
 * (`now`, `blurred`, `blurRange`), the YCoCg box `lo`–`hi`, `centre` (the render texel of the display
 * pixel), `sampleWeight`, `nearPage` and, with `asIs`, `share` and its box are known: one blend and
 * one law, the image's motion entering only as the continuous weight `motion`. The history is read
 * at the reprojected point with Catmull-Rom (exact at a texel centre) and takes the current image by
 * the engine's one accumulation law (`ACCUMULATION_WGSL`): the sample's weight over the weight the
 * history holds (`held`, kept in the share target's alpha, `historyWeightIn`, less what is refused),
 * up to the history's length. With `motion`:
 * - the length goes from the weight maximum (`view.params.x`), the exact weighted mean of a still
 *   image's phases, to what the history's confidence (`shadingConfidence`) and its speed
 *   (`historyCap`) let it keep;
 * - the box the history is clamped to closes from open — the box of one image's 3×3 would bias the
 *   average of stochastic shading toward its dark samples, a penumbra lit half the time of radiance
 *   1 settling at 0.30 for 0.48 over 64 images (`historySequence.test.ts`), and clip the detail finer
 *   than the render grid only the phases carry — to the 3×3's, widened by the flicker measure's
 *   error (the luma to at least three times it, in the measurement curve, the chroma by the luma's
 *   mean widening);
 * - the weight by the inverse of each one's luminance, so a spark does not settle, and the reactive
 *   value the blends, particles and water wrote (the zero texel bound in its place where none did,
 *   `inputs.ts`), whole on a dynamic geometry's pixel (`pageOf`), whose vertices moved within their
 *   placement, which no motion matrix follows: its history is another shape, dropped rather than
 *   smeared.
 * A history wholly refused never comes here: the resolve writes the current image, a fresh flicker
 * measure and its own weight. The as-is share is read bilinear at the point only where its box spans
 * two values: a box of one value clamps any history to it.
 */
export const taaHistoryBlend = (asIs: boolean, filtered = false) => {
  const share = shareText(asIs)
  return ` let pastAt=historyTexel(previous.xy,coord);
 let tag=textureLoad(shareHistory,pastAt,0);let past=shadingRead(pastAt,tag.g);
 let read=historyCatmullRom(previous.xy);let readY=toYcocg(read.rgb);
${share(` var sharePast=vec4f(0.0);if(shareLo!=shareHi){sharePast=${PAST_SHARE};}\n`)} let cover=textureLoad(reactive,min(centre,vec2i(textureDimensions(reactive))-vec2i(1)),0).g;
 let animated=nearPage.animated;
 let range=vec2f(shadingLuma(lo.x),shadingLuma(hi.x));
 let measure=shadingMoire(now,blurred,shadingLuma(readY.x),range,blurRange,past,shadingStill(here,before,animated>0.0),cover);
 gradient=measure.gradient;moire=shadingPack(measure);
 let error=measure.error*motion;
 if(error>0.0){
  let wide=${LUMA_TO_CHANNEL}.0*error;
  let lumaLo=min(lo.x,shadingLinear(min(range.x,range.y-wide)));
  let lumaHi=max(hi.x,shadingLinear(max(range.y,range.x+wide)));
  let chroma=0.5*(lo.x-lumaLo+lumaHi-hi.x);
  lo=vec4f(lumaLo,lo.yz-chroma,lo.w);hi=vec4f(lumaHi,hi.yz+chroma,hi.w);
 }
 let held=${layer.historyWeightIn('tag.a')}*(1.0-refused);
 let allowed=min(shadingConfidence(abs(blurred-past.x),range.y-range.x,error,held),historyCap(speed,lumaNow,clamp(readY.x,lo.x,hi.x)));
 let longest=mix(view.params.x,allowed,motion);
 let alpha=currentShare(accumulationShare(held,sampleWeight,longest),max(cover,animated)*motion,held<=0.0);
 count=accumulationCount(held,sampleWeight,longest);
 if(sampleWeight>0.0){count=min(count,sampleWeight/alpha);}
 lo=mix(vec4f(-RANGE_BOUND),lo,motion);hi=mix(vec4f(RANGE_BOUND),hi,motion);
 let clamped=clamp(vec4f(readY,read.a),lo,hi);
 let kept=vec4f(fromYcocg(clamped.xyz),clamped.w);
${share(' let keptShare=clamp(sharePast.r,shareLo,shareHi);\n')} let tone=view.tsr.x*motion;let wc=alpha/(1.0+lumaNow*tone);
 let wh=(1.0-alpha)/(1.0+clamped.x*tone);
 let blendScale=1.0/(wc+wh);
${layer.layerText(filtered, 'kept')} return ${layer.taaOut(asIs, filtered, true)};`
}

/** The share target's as-is share, read bilinear at the reprojected point. */
const PAST_SHARE = 'textureSampleLevel(shareHistory,historySampler,previous.xy,0.0)'
