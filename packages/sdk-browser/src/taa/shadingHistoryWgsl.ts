import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { perspectiveDivide } from '../../../math/src/wgsl/projection.ts'
import { unorm8 } from '../../../math/src/wgsl/color.ts'
/** The most images a moving pixel's history holds. */
export const HISTORY_SAMPLES_MAX = 16
/** The fewest it keeps after a full shading rejection: the current image and one. */
const HISTORY_SAMPLES_REJECTED = 2
/** The share of the image a ghosting update of the flicker history takes, and the fade of its
 *  totals every image: 5 %. */
const FLICKER_GHOSTING = 0.05
/** A gradient is kept in eight bits: what lies within this is its rounding. */
const GRADIENT_EPSILON = 1 / 127
/** The most flickers the history counts, within its eight bits. */
const FLICKER_COUNT_MAX = 20
/** Half a step of a 10-bit display: below it no change is seen. */
const DISPLAY_STEP = 0.5 / 1024
/** The centre's weight in the 3×3 blur (1, ½, ¼ for centre, sides, corners). */
const BLUR_CENTRE = 0.25
/** A luma flicker of `e` may be a channel's of `3e`: luma is the mean of three channels, so a
 *  channel's box widens by three times the error. */
export const LUMA_TO_CHANNEL = 3
/** The measurement curve's perceptual offset: `x / (x + 0.17)`, squared. */
const CURVE_OFFSET = 0.17
/** Flicker periods the count must hold before its error shows, in images. */
const FLICKER_PERIOD = 2
/** Camera parallax, in pixels of a 1920-wide image an image, past which a pixel counts
 *  no flickers: ten pixels an image at 60 Hz, five at the 120 Hz the engine draws for. */
const PARALLAX_LIMIT = 5

/**
 * The flicker measure's rates are counted in images, never timed: a resolve is then a function of
 * its images and jitter ranks alone, two runs of the same images writing the same words — where a
 * frame's measured length made them follow the wall clock. Counted at 120 Hz: at that rate the same
 * as timed; a slower frame keeps the 120 Hz limit, stricter on what counts as still than timing
 * would make it, so no more moving pixels widen their box. `1 − 0.95^P`, the flicker count's
 * fade-in rate: a period of two images.
 */
export const FLICKER_COUNT_RATE = 1 - (1 - FLICKER_GHOSTING) ** FLICKER_PERIOD

/** The inverse of the parallax limit, in display pixels an image, on a display `width` wide. */
export const flickerParallax = (width: number) => 1 / (PARALLAX_LIMIT * (width / 1920))

/**
 * The shading measures of a pixel's history: a luma measured in a perceptual space — exposed
 * (`view.tsr.x`, the exposure composition applies), then `x / (x + 0.17)` squared
 * (`shadingLuma`) —, taken from the YCoCg luma the resolve boxes and weighs its colours by, so the
 * 3×3's box of lumas is its YCoCg box's, no curve per texel.
 *
 * The flicker measure, `shadingMoire`, kept at the display size beside the colour history, in a
 * r32uint target (`shadingPack`): the blurred luma history's half-float bits in the low half, then
 * the flicker total and count in eight bits each, one word;
 * the gradient rides in the share target's green, in an eight-bit encoding (`gradientOut`). Each
 * image:
 * - the rejection: the blurred luma history against the box of the 3×3's blurred lumas widened by
 *   a sixteenth of the box (half a display step at least) and half a display step, each pixel
 *   against its own box, soft (`1 − clamped / delta`);
 * - the gradient: a rejecting update of the pixel's luma history less a 5 %-ghosting one — zero
 *   while the history lies in the box, the change a rejection makes past it —, less the coverage
 *   of the transparents over the pixel (their reactive value);
 * - a flicker: a gradient whose sign is the opposite of the accumulated one, both past the
 *   encoding error, never on a cut (the history is then fresh). It adds its smaller swing to the
 *   total and one to the count, both fading 5 % an image, the count quantised to its eight bits;
 *   the accumulated gradient restarts on a flicker and adds up otherwise;
 * - the error: the mean swing plus the count times the encoding error, faded in once the count
 *   holds `P` flicker periods — `saturate(count · (1 − 0.95^P) − 0.5)`, `P` two images
 *   (`FLICKER_COUNT_RATE`) —, kept to still pixels (`shadingStill`), less the transparents'
 *   coverage.
 *
 * One flicker gives nothing; one every second image holds a count of about ten (9.5 after the
 * count's eight-bit floor), half faded in; one every image the full count (18.5 after it). The
 * error only widens the boxes: the colour history's (`taaHistoryBlend`) and the rejection the
 * history's confidence is measured by (`shadingConfidence`), to at least three times itself, a
 * channel's part of a luma swing (`LUMA_TO_CHANNEL`).
 *
 * A pixel is still (`shadingStill`, graded): its surface point moved by less than a render pixel's
 * width at its depth — moving in full at two —, and the camera's own move shifted it, against the
 * camera only turning (`view.parallax`), by less than half the parallax limit (`flickerParallax`),
 * moving in full at one and a half; a geometry no motion follows is moving.
 *
 * The confidence (`shadingConfidence`): the blurred luma against its history, trusted within the
 * 3×3's luma range or three times the flicker error, by the square of how far past it.
 *
 * What one display-size fragment pass leaves out: a blur of the history and of its neighbours', a
 * 3×3 median of the rejection, the flicker events dilated over 5×5 — dilated without the median, a
 * penumbra's noise would count as flicker. The 3×3's blur and slopes stand for its box
 * of blurred lumas, the blurred luma history for the blurred history, the colour history's luma
 * for the pixel's flicker history; events are counted per pixel.
 */
export const SHADING_HISTORY_WGSL = wgslBlock(
  'SHADING_HISTORY_WGSL',
  [perspectiveDivide, unorm8],
  `
fn shadingLuma(y:f32)->f32{
 let c=max(y,0.0)*view.tsr.x;let g=c/(c+${CURVE_OFFSET});
 return g*g;
}
fn shadingLinear(s:f32)->f32{
 let g=sqrt(clamp(s,0.0,0.999));
 return ${CURVE_OFFSET}*g/((1.0-g)*view.tsr.x);
}
struct ShadingMoire{luma:f32,gradient:f32,variation:f32,count:f32,error:f32,}
fn shadingFresh(blurred:f32)->ShadingMoire{return ShadingMoire(blurred,0.0,0.0,0.0,0.0);}
fn shadingMoire(now:f32,blurred:f32,past:f32,range:vec2f,blurRange:vec2f,prev:vec4f,still:f32,cover:f32)->ShadingMoire{
 let prevVariation=prev.z*${1 - FLICKER_GHOSTING}*still;
 let prevCount=prev.w*${FLICKER_COUNT_MAX * (1 - FLICKER_GHOSTING)}*still;
 let boxSize=range.y-range.x;
 let clampError=max(${DISPLAY_STEP},boxSize*${BLUR_CENTRE * 0.25})+${DISPLAY_STEP};
 let delta=max(abs(blurred-prev.x),boxSize*${BLUR_CENTRE}+${2 * BLUR_CENTRE * DISPLAY_STEP});
 let clamped=clamp(prev.x,blurRange.x-clampError,blurRange.y+clampError);
 let rejection=saturate(1.0-abs(clamped-prev.x)/delta);
 let blend=max(1.0-rejection,${FLICKER_GHOSTING});
 let rejecting=mix(mix(clamp(past,range.x,range.y),past,rejection),now,blend);
 let raw=rejecting-mix(past,now,${FLICKER_GHOSTING});
 let gradient=select(-1.0,1.0,raw>0.0)*max(abs(raw)-cover,0.0);
 let flicker=select(1.0,0.0,gradient*prev.y>0.0||abs(gradient)<${GRADIENT_EPSILON}||abs(prev.y)<${GRADIENT_EPSILON});
 let count=prevCount+flicker;
 let kept=floor(count*${255 / FLICKER_COUNT_MAX})*${FLICKER_COUNT_MAX / 255};
 let perCount=select(0.0,1.0/count,count>0.0);
 let variation=(prevVariation+min(abs(prev.y),abs(gradient))*flicker)*kept*perCount;
 let fade=saturate(count*view.moire.x-0.5);
 let error=(abs(variation*perCount)+count*${GRADIENT_EPSILON})*fade;
 let luma=mix(mix(clamp(prev.x,blurRange.x,blurRange.y),prev.x,rejection),blurred,blend);
 return ShadingMoire(luma,clamp(prev.y*${1 - FLICKER_GHOSTING}*(1.0-flicker)+gradient,-1.0,1.0),saturate(variation),kept/${FLICKER_COUNT_MAX}.0,saturate(error*still-cover));
}
fn shadingPack(moire:ShadingMoire)->u32{
 return (pack2x16float(vec2f(moire.luma,0.0))&0xffffu)|(((u32(round(moire.variation*255.0))<<8u)|u32(round(moire.count*255.0)))<<16u);
}
fn shadingRead(at:vec2i,gradient:f32)->vec4f{
 let stored=textureLoad(shadingHistory,at,0).r;
 return vec4f(unpack2x16float(stored&0xffffu).x,gradient*${255 / 127}-1.0,unorm8(stored,3u),unorm8(stored,2u));
}
fn shadingConfidence(error:f32,range:f32,flicker:f32,count:f32)->f32{
 let limit=max(range,${LUMA_TO_CHANNEL}.0*flicker)+${2 * DISPLAY_STEP};
 var trust=1.0;
 if(error>limit){trust=(limit*limit)/(error*error);}
 return max(${HISTORY_SAMPLES_REJECTED}.0,min(count+1.0,${HISTORY_SAMPLES_MAX}.0)*trust);
}
fn shadingStill(here:vec4f,before:vec4f,animated:bool)->f32{
 if(animated){return 0.0;}
 var moving=0.0;
 if(here.w>0.0&&before.w>0.0){
  let shift=length(perspectiveDivide(before)-perspectiveDivide(here));
  moving=saturate(shift*here.w/view.moire.z-1.0);
 }
 let seen=view.prevViewProj*here;
 let turned=seen+view.parallax*here.w;
 if(seen.w>0.0&&turned.w>0.0){
  let parallax=0.5*length((perspectiveDivide(turned).xy-perspectiveDivide(seen).xy)*view.viewport.xy);
  moving=max(moving,saturate(parallax*view.moire.y-0.5));
 }
 return 1.0-moving;
}`,
)

/** The gradient in the share target's eight bits: `g · 127/255 + 127/255`, so zero is
 *  kept exactly and a step is 1/127. */
export const gradientOut = (gradient: string) => `${gradient}*${127 / 255}+${127 / 255}`
