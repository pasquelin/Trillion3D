import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'

/** The most samples a pixel of the image holds at the display's resolution: sixteen images
 *  average the jitter's noise away while a change still shows within a fraction of a second — the
 *  factor the shading history takes the image at follows it (`view.rates.y`). */
export const IMAGE_SAMPLES = 16
/** The display history's density: what a history of twice the display's resolution holds per
 *  display pixel, four of its pixels. */
const HISTORY_DENSITY = 4
/**
 * The most samples a display pixel's history holds: the image's, times the density — each image
 * weighs a 64th of a whole history, so a still pixel's history moves by a 64th of its jitter's
 * swing an image, and a thin, contrasted pattern the jitter samples differently every image stays
 * still. Motion and a shading rejection still cap it in images (`MOVING_SAMPLES`,
 * `REJECTED_SAMPLES`), so its sharpness in motion and its reaction to a change are those of the
 * sixteen.
 */
export const HISTORY_SAMPLES = IMAGE_SAMPLES * HISTORY_DENSITY
/** The most it keeps after a full shading rejection: two, enough to damp the new shading's first
 *  noisy image without dragging the old one along. */
const REJECTED_SAMPLES = 2
/** The most it keeps once its pixel slides `MOVING_PIXEL_SPEED` a frame: four — each resample of a
 *  moving history softens it. */
const MOVING_SAMPLES = 4
/** The speed, in the history update's measure of a pixel's motion, at which `MOVING_SAMPLES` holds. */
const MOVING_PIXEL_SPEED = 1
/** The share of a whole history one image of full alignment weighs. */
export const HISTORY_HYSTERESIS = 1 / HISTORY_SAMPLES

/**
 * The bicubic Catmull-Rom read of a texture at `uv` in five bilinear taps, the four corners'
 * weights folded into the cross (an approximation of the 4×4's separable weights): the
 * centre tap at the bilinear point that carries the inner 2×2, and one tap beyond each side. The
 * weights sum to one; a tap's coordinates are the caller's to clamp. At a texel centre the weights
 * are those of the texel itself, its neighbours' lobes cancelling.
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
 var color=vec4f(0.0);var tag=vec4f(0.0);var middle=vec4f(0.0);
 for(var k=0;k<5;k++){
  let at=clamp(taps.uv[k],lo,hi);
  let c=textureSampleLevel(history,historySampler,at,0.0);
  if(k==2){middle=c;}
  color+=c*taps.weight[k];
  tag+=textureSampleLevel(shareHistory,historySampler,at,0.0)*taps.weight[k];
 }
 if(any(color.rgb<vec3f(0.0))){color=max(middle,vec4f(0.0));}
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
 * The weight laws of the history update, in whole histories (`HISTORY_HYSTERESIS` an image of
 * full alignment): `prevMultiplier`, the history's weight per unit of the image's at blend factor
 * `b`, `(1 − b) / b`; and `safeRcp`.
 */
export const HISTORY_WEIGHTS_WGSL = wgslBlock(
  'HISTORY_WEIGHTS_WGSL',
  [SAFE_RCP_WGSL],
  `
const HISTORY_HYSTERESIS:f32=${wgslF32(HISTORY_HYSTERESIS)};
const HISTORY_SAMPLES:f32=${HISTORY_SAMPLES}.0;
const REJECTED_VALIDITY_DROP:f32=${wgslF32(1 - REJECTED_SAMPLES * HISTORY_HYSTERESIS)};
const MOVING_VALIDITY_DROP:f32=${wgslF32(1 - MOVING_SAMPLES * HISTORY_HYSTERESIS)};
const MOVING_SPEED_INVERSE:f32=${wgslF32(1 / MOVING_PIXEL_SPEED)};
fn prevMultiplier(b:f32)->f32{return (1.0-b)/max(b,1e-30);}`,
)
