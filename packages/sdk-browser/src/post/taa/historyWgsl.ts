import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { saturate } from '../../../../math/src/scalar/reals.ts'

/** The most samples a display pixel's history holds, 8 to 32 by the weight law's bounds: sixteen
 *  images average the jitter's noise away while a change still shows within a fraction of a
 *  second. The factor the shading history takes the image at follows it at the render resolution
 *  (`view.rates.y`, `writeTaaView`). */
export const MAX_HISTORY_SAMPLES = 16
/** The display histories' resolution per axis, of the display's: they are made at its size
 *  (`createTaaHistoryTargets`, `allocate`d at the display size), so a history pixel is a display
 *  pixel (`historySampleLaws`). */
const HISTORY_TO_DISPLAY = 1
/** The most a history keeps after a full shading rejection, in samples of a display pixel: two,
 *  enough to damp the new shading's first noisy image without dragging the old one along. */
const REJECTED_SAMPLES = 2
/** The most it keeps once its pixel slides `MOVING_PIXEL_SPEED` display pixels a frame: four —
 *  each resample of a moving history softens it. */
const MOVING_SAMPLES = 4
/** The display pixel speed a frame at which `MOVING_SAMPLES` holds. */
const MOVING_PIXEL_SPEED = 1

/**
 * The history update's sample laws for a history of `historyToDisplay` of the display's resolution
 * per axis, each in samples of a history pixel: a history pixel covers `historyToDisplay⁻²` of a
 * display pixel, so it holds `MAX_HISTORY_SAMPLES` over that square (`samples`); an image of full
 * alignment weighs one sample of it (`hysteresis`); a full shading rejection keeps
 * `REJECTED_SAMPLES` of a display pixel (`rejectedDrop`, the validity's drop to it), a pixel
 * sliding `MOVING_PIXEL_SPEED` display pixels `MOVING_SAMPLES` of one (`movingDrop`) — each a
 * display pixel's samples over that square —, the speed read in display pixels (`speedInverse`).
 */
function historySampleLaws(historyToDisplay: number) {
  const square = historyToDisplay * historyToDisplay
  const samples = MAX_HISTORY_SAMPLES / square
  const hysteresis = 1 / samples
  return {
    samples,
    hysteresis,
    rejectedDrop: 1 - (REJECTED_SAMPLES / square) * hysteresis,
    movingDrop: saturate(1 - (MOVING_SAMPLES / square) * hysteresis),
    speedInverse: 1 / MOVING_PIXEL_SPEED,
  }
}

/** The display histories' laws (`HISTORY_TO_DISPLAY`): constants of the history update's program
 *  (`HISTORY_WEIGHTS_WGSL`) and of its convergence (`taaConverged`). */
export const HISTORY_LAWS = historySampleLaws(HISTORY_TO_DISPLAY)

/**
 * The bicubic Catmull-Rom read of a texture at `uv` in five bilinear taps, the four corners'
 * weights folded into the cross (an approximation of the 4×4's separable weights): the
 * centre tap at the bilinear point that carries the inner 2×2, and one tap beyond each side. The
 * weights sum to one; a tap's coordinates are the caller's to clamp. At a texel centre the weights
 * are those of the texel itself, its neighbours' lobes cancelling. `bicubicRead` sums the five taps of
 * `tex` through `samp`, each clamped to the box `lo` to `hi` of its coordinates: the one read of every
 * history that is read this way.
 */
export const CATMULL_ROM_TAPS_WGSL = wgslBlock(
  'CATMULL_ROM_TAPS_WGSL',
  [],
  `
struct TaaTaps{uv:array<vec2f,5>,weight:array<f32,5>}
fn catmullRomTaps(uv:vec2f,size:vec2f,inv:vec2f)->TaaTaps{
 let pc=uv*size;
 let iuv=floor(pc-0.5)+1.0;
 let f=pc-iuv;let f2=f*f;let f_2=f+f;
 let u=((1.25-f2)*f+0.5)*inv;
 let t0=(0.25*f2-0.0625)*(1.125-0.5*f2.yx);
 let w0=t0-f_2*t0;let w3=t0+f_2*t0;
 let c=(iuv-0.5)*inv;
 return TaaTaps(
  array<vec2f,5>(c+vec2f(-inv.x,u.y),c+vec2f(2.0*inv.x,u.y),c+u,c+vec2f(u.x,-inv.y),c+vec2f(u.x,2.0*inv.y)),
  array<f32,5>(w0.x,w3.x,1.0-w0.x-w3.x-w0.y-w3.y,w0.y,w3.y));
}
fn bicubicRead(tex:texture_2d<f32>,samp:sampler,taps:TaaTaps,lo:vec2f,hi:vec2f)->vec4f{
 var t=taps;
 var sum=vec4f(0.0);
 for(var k=0;k<5;k++){sum+=textureSampleLevel(tex,samp,clamp(t.uv[k],lo,hi),0.0)*t.weight[k];}
 return sum;
}`,
)

/**
 * The display history read at the reprojected point `uv` (`resolveWgsl.ts`): the colour and the
 * share target — the as-is share in red, the history's validity in green — both through the
 * five-tap Catmull-Rom, each tap clamped half a texel inside the history. A highlight's negative
 * lobes may sum below zero: a colour with a negative channel takes the centre tap's alone, floored
 * at zero; the share target is floored at zero.
 */
export const HISTORY_READ_WGSL = wgslBlock(
  'HISTORY_READ_WGSL',
  [CATMULL_ROM_TAPS_WGSL],
  `
struct TaaPast{color:vec4f,tag:vec4f}
fn historyRead(uv:vec2f)->TaaPast{
 var taps=catmullRomTaps(uv,view.viewport.xy,view.viewport.zw);
 let lo=0.5*view.viewport.zw;let hi=vec2f(1.0)-lo;
 var color=bicubicRead(history,historySampler,taps,lo,hi);
 let tag=bicubicRead(shareHistory,historySampler,taps,lo,hi);
 if(any(color.rgb<vec3f(0.0))){
  color=max(textureSampleLevel(history,historySampler,clamp(taps.uv[2],lo,hi),0.0),vec4f(0.0));
 }
 // The light of the image before held as this image holds its own; an as-is pixel (a display value) is not.
 color=vec4f(color.rgb*mix(view.preExposure.x,1.0,saturate(tag.r)),color.a);
 return TaaPast(color,max(tag,vec4f(0.0)));
}`,
)

/** An inverse that is zero at zero (and below). */
export const SAFE_RCP_WGSL = wgslFn(
  'safeRcp',
  [],
  'fn safeRcp(x:f32)->f32{return select(0.0,1.0/x,x>0.0);}',
)

/**
 * The weight laws of the history update, in whole histories (`HISTORY_HYSTERESIS` an image of full
 * alignment), the display histories' laws as constants (`HISTORY_LAWS`): `prevMultiplier`, the
 * history's weight per unit of the image's at blend factor `b`, `(1 − b) / b`; and `safeRcp`.
 */
export const HISTORY_WEIGHTS_WGSL = wgslBlock(
  'HISTORY_WEIGHTS_WGSL',
  [SAFE_RCP_WGSL],
  `
const HISTORY_SAMPLES:f32=${wgslF32(HISTORY_LAWS.samples)};
const HISTORY_HYSTERESIS:f32=${wgslF32(HISTORY_LAWS.hysteresis)};
const REJECTED_VALIDITY_DROP:f32=${wgslF32(HISTORY_LAWS.rejectedDrop)};
const MOVING_VALIDITY_DROP:f32=${wgslF32(HISTORY_LAWS.movingDrop)};
const MOVING_SPEED_INVERSE:f32=${wgslF32(HISTORY_LAWS.speedInverse)};
fn prevMultiplier(b:f32)->f32{return (1.0-b)/max(b,1e-30);}`,
)
