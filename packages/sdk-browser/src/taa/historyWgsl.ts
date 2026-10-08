import * as layer from './layers.ts'
import { FLAG_DYNAMIC } from '../visibility/types.ts'
import { REACTIVE_MAX } from './reactive.ts'
import { HISTORY_SAMPLES_MAX, LUMA_TO_CHANNEL } from './shadingHistoryWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clampToExtent, hashUnit } from '../../../math/src/wgsl/sampling.ts'

/** The samples a history read a display pixel or more away keeps beside the current one. */
const MOVING_SAMPLES = 4

/** `text` in a resolve that carries the as-is share, `none` in the flagless one. */
export const shareText =
  (asIs: boolean) =>
  (text: string, none = '') =>
    asIs ? text : none

/**
 * History read while the image moves: Catmull-Rom on the 4×4 texels around the point, in five
 * bilinear taps — the four corners, which weigh least, dropped and the rest renormalised.
 * Bilinear softens the history a little every image the pixel moves by a fraction;
 * Catmull-Rom keeps its sharpness. Its negative lobes may overshoot: the neighbour box clamps them.
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
 * What a pixel takes of the page record its identifier names, which it reads once: the identity
 * the geometry history keeps it by — its placement plus one, none for the background — and whether
 * its geometry is dynamic: changing vertices with no tracked deformation cannot reuse placement
 * motion. The background (`id` 0) names no row: nothing is read, and it is neither.
 */
export const PAGE_OF_WGSL = wgslBlock(
  'PAGE_OF_WGSL',
  [],
  `
struct TaaPage{identity:u32,animated:f32}
fn pageOf(id:u32)->TaaPage{
 if(id==0u){return TaaPage(0u,0.0);}
 let page=pages[(id>>8u)-1u];
 return TaaPage(page.placement+1u,select(0.0,1.0,(page.flags&${FLAG_DYNAMIC}u)!=0u&&page.deformOutput==0u));
}`,
)

/**
 * The history texel a pixel's shading measures are read from: the nearest to its reprojected point,
 * after an offset of up to half a texel drawn per pixel and image: a point read, dithered. A still
 * pixel reads its own texel; a moving one does not drift by always rounding one way.
 */
export const HISTORY_TEXEL_WGSL = wgslBlock(
  'HISTORY_TEXEL_WGSL',
  [hashUnit, clampToExtent],
  `
fn historyTexel(uv:vec2f,coord:vec2i)->vec2i{
 let seed=(u32(coord.y)*65536u+u32(coord.x))*8u+u32(view.jitter.w);
 // 0x5bd1e995u: odd 32-bit constant with well-spread bits that flips the seed for the second coordinate, so it is decorrelated from the first; any odd value with well-spread bits would serve, this one is declared, not tuned.
 let offset=vec2f(hashUnit(seed),hashUnit(seed^0x5bd1e995u))*0.999-0.4995;
 return clampToExtent(vec2i(floor(uv*view.viewport.xy+offset)),vec2i(view.viewport.xy));
}`,
)

/**
 * The most samples a moving pixel's history keeps, the current one included (a history at the
 * display's size): four beside the current one once the history is read a display pixel or more
 * away, linearly more below, up to `HISTORY_SAMPLES_MAX` still — the history resampled each image
 * softens, a short one less —, unless the current luma differs from the kept history's by more: a
 * high-contrast edge keeps that share of the full history, so it stays stable.
 * `now` and `kept`: the YCoCg luma of the current image and of the boxed history. (A history kept
 * at twice the display's size would need no such cap, at four times this one's cost.)
 */
export const HISTORY_CAP_WGSL = wgslBlock(
  'HISTORY_CAP_WGSL',
  [],
  `
fn historyCap(uv:vec2f,coord:vec2i,now:f32,kept:f32)->f32{
 let speed=length(uv*view.viewport.xy-vec2f(coord)-0.5);
 let contrast=abs(now-kept)/max(max(now,kept),1e-6);
 return 1.0+${HISTORY_SAMPLES_MAX}.0*max(1.0-${1 - MOVING_SAMPLES / HISTORY_SAMPLES_MAX}*saturate(speed),contrast);
}`,
)

/**
 * The current image's share of a moving pixel (the blend's sixth point): today's `alpha` times
 * `reach`, the weight of the sample nearest the display pixel — one that fell far from it does not
 * overwrite its history —, raised to the pixel's reactive value, never above `REACTIVE_MAX`; a pixel
 * with no history (`fresh`) takes the current sample whole.
 */
export const CURRENT_SHARE_WGSL = wgslBlock(
  'CURRENT_SHARE_WGSL',
  [],
  `
fn currentShare(alpha:f32,reach:f32,rho:f32,fresh:bool)->f32{
 if(fresh){return 1.0;}
 return max(alpha*reach,min(rho,${REACTIVE_MAX}));
}`,
)

/**
 * What both resolves close with, once `previous` (and the points it came from, `here` and
 * `before`), `filtered`, its luma `lumaNow` and measurement lumas (`now`, `blurred`, `blurRange`),
 * the YCoCg box `lo`–`hi`, `centre` (the render texel of the display pixel), `reach` and, with
 * `asIs`, `share` and its box are known: history read at the reprojected point, clamped to the box,
 * mixed with the current image by the inverse of each one's luminance, so a spark does not settle.
 * At rest (`view.jitter.z` 0) the history is the plain average of the still images — the k-th
 * weighing `view.params.x`, 1/k, or in the upscaling resolve its share of the weights held — and
 * neither boxed nor weighed by luminance: the scene is the same (a quiet image), and the box of one
 * image's 3×3, or a weight of 1/(1 + luma), would bias the average of stochastic shading toward its
 * dark samples — a penumbra lit half the time of radiance 1 settled at 0.30 for 0.48 over 64 images
 * (`historySequence.test.ts`). The reactive value acts only while the image moves.
 *
 * The flicker measure is updated in both (`shadingMoire`), so a moving image finds it ready;
 * its error acts only while moving:
 * it widens the box — the luma to at least three times the error, in the measurement curve, the
 * chroma by the luma's mean widening, as a box widened in each colour channel —, and the rejection
 * the history's confidence is measured by (`shadingConfidence`). A pixel uncovered
 * (`geometryUncovered`) starts its measure afresh, its history gone: it takes the current image
 * whole (`currentShare`), its history's weight `wh` zero, its count one, so it keeps none of it:
 * its colour, share target, flicker measure and reactive value are read beside the geometry that
 * rejects them, all in flight at once, and dropped; its layers are not read. Every word it writes
 * is the one it wrote reading them (a zero colour channel's sign aside).
 *
 * While moving the history is read with Catmull-Rom; it keeps at most what its speed lets it
 * (`historyCap`), and the current share is `currentShare`'s, from the reactive value the blends,
 * particles and water wrote — whole on a dynamic geometry's pixel (`pageOf`), whose
 * vertices moved within their placement, which no motion matrix follows: its history is another
 * shape, dropped rather than smeared. `still`, the upscaling
 * resolve's: a still pixel's share is set from the weights its average holds
 * (`stillAverage`). The share target is read twice: its point texel (`tag`: the flicker gradient
 * and history count) and, bilinear at the point, its as-is share and still weight together — only
 * where the as-is share's box spans two values or a still average needs the weight: a box of one
 * value clamps any history to it.
 * `reactive` false, the resolve of a frame whose blends, particles and water wrote no reactive
 * value: its pixels' value is 0, what the zero texel bound in its place reads (`inputs.ts`), not read.
 */
export const taaHistoryBlend = (
  asIs: boolean,
  filtered = false,
  still = false,
  centrePage = 'pageOf(textureLoad(ids,centre,0).r)',
  reactive = true,
) => {
  const share = shareText(asIs)
  return ` if(previous.w==0.0){return ${layer.taaOut(asIs, filtered, false, still)};}
 let moving=view.jitter.z!=0.0;
 let pastAt=historyTexel(previous.xy,coord);
 var tag=textureLoad(shareHistory,pastAt,0);var past=shadingRead(pastAt,tag.g);var read=vec4f(0.0);
 if(moving){read=historyCatmullRom(previous.xy);}else{read=textureSampleLevel(history,historySampler,previous.xy,0.0);}
${share(` var sharePast=vec4f(0.0);if(shareLo!=shareHi${still ? '||!moving' : ''}){sharePast=${PAST_SHARE};}\n`)} var cover=${reactive ? 'textureLoad(reactive,min(centre,vec2i(textureDimensions(reactive))-vec2i(1)),0).g' : '0.0'};
 let uncovered=moving&&geometryUncovered(previous.xy,previous.z,geometry.x,depthSlack);
 if(uncovered){tag=vec4f(0.0);past=vec4f(0.0);read=vec4f(0.0);cover=0.0;}
${share(' if(uncovered){sharePast=vec4f(0.0);}\n')} let animated=${centrePage}.animated;
 let range=vec2f(shadingLuma(lo.x),shadingLuma(hi.x));
 var measure=shadingFresh(blurred);
 if(!uncovered){measure=shadingMoire(now,blurred,shadingLuma(toYcocg(read.rgb).x),range,blurRange,past,shadingStill(here,before,animated>0.0),cover);}
 gradient=measure.gradient;moire=shadingPack(measure);
 let error=select(0.0,measure.error,moving);
 historyCount=shadingConfidence(abs(blurred-past.x),range.y-range.x,error,tag.a*16.0);
 var alpha=view.params.x;
 if(moving){
  if(error>0.0){
   let wide=${LUMA_TO_CHANNEL}.0*error;
   let lumaLo=min(lo.x,shadingLinear(min(range.x,range.y-wide)));
   let lumaHi=max(hi.x,shadingLinear(max(range.y,range.x+wide)));
   let chroma=0.5*(lo.x-lumaLo+lumaHi-hi.x);
   lo=vec4f(lumaLo,lo.yz-chroma,lo.w);hi=vec4f(lumaHi,hi.yz+chroma,hi.w);
  }
  historyCount=min(historyCount,historyCap(previous.xy,coord,lumaNow,clamp(toYcocg(read.rgb).x,lo.x,hi.x)));
  alpha=currentShare(1.0/historyCount,reach,max(cover,animated),uncovered);
 }else{${still ? stillAverage(share('sharePast', PAST_SHARE)) : ''}lo=vec4f(-RANGE_BOUND);hi=vec4f(RANGE_BOUND);}
 historyCount=min(historyCount,1.0/max(alpha,1e-6));
 let clamped=clamp(vec4f(toYcocg(read.rgb),read.a),lo,hi);
 let kept=vec4f(fromYcocg(clamped.xyz),clamped.w);
${share(' let keptShare=clamp(sharePast.r,shareLo,shareHi);\n')} let tone=select(0.0,view.tsr.x,moving);let wc=alpha/(1.0+lumaNow*tone);
 let wh=(1.0-alpha)/(1.0+clamped.x*tone);
${layer.layerText(filtered, 'kept')} return ${layer.taaOut(asIs, filtered, true, still)};`
}

/** The share target, its as-is share and still weight, read at the reprojected point. */
const PAST_SHARE = 'textureSampleLevel(shareHistory,historySampler,previous.xy,0.0)'

/**
 * A still pixel of an image drawn below the display: its average is weighed by how near
 * each image's samples fell to the display pixel (`stillTotal`, the Blackman-Harris window of one
 * display pixel, `upscaleWgsl.ts`), not one image as much as another. The weight the history holds
 * is read beside its tag, this image's added to it into `count`, which is written; the current
 * share is this image's part of it, none when no sample fell near. Over the phases the average
 * then gathers, per display pixel, the samples of that pixel: the detail the display size shows.
 * Its history is not boxed, as at native size: the box of one image's render texels would also clip
 * the detail finer than the render grid that only the phases together carry. `sharePast`: the share
 * target read at the point.
 */
const stillAverage = (sharePast: string) =>
  `let held=${sharePast}.b;count=${layer.stillWeightIn('held')}+stillTotal;alpha=select(0.0,stillTotal/count,count>0.0);`
