import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { safeRcp } from '../../../../math/src/wgsl/reals.ts'
import { saturate } from '../../../../math/src/scalar/reals.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { FULL_PRECISION, HALF_PRECISION, type Precision } from './colorSpaceWgsl.ts'
import {
  TEMPORAL_DEFAULTS,
  type TemporalValues,
} from '../../../../sdk-core/src/contracts/temporalOptions.ts'

/** The settings the history's laws take (`../../../../sdk-core/src/contracts/temporalOptions.ts`): the
 *  most samples a display pixel's history holds, 8 to 32 by the weight law's bounds — sixteen images
 *  average the jitter's noise away while a change still shows within a fraction of a second —; the
 *  most it keeps after a full shading rejection, in samples of a display pixel — two, enough to damp
 *  the new shading's first noisy image without dragging the old one along —; the most it keeps once
 *  its pixel moves at the speed setting, in samples of a history pixel — four: each
 *  resample of a moving history softens it, a finer history being the less softened. */
export type HistoryLawSettings = Pick<
  TemporalValues,
  | 'temporalHistorySampleCount'
  | 'temporalShadingRejectionSampleCount'
  | 'temporalVelocityWeightClampingSampleCount'
  | 'temporalVelocityWeightClampingPixelSpeed'
>

/** The samples a history pixel holds at most, of a history of `historyToDisplay` of the display's
 *  resolution per axis: the display pixel's `maxSamples` over the square of it. */
export const historySamples = (historyToDisplay: number, maxSamples: number) =>
  maxSamples / (historyToDisplay * historyToDisplay)

/**
 * The history update's sample laws for a history of `historyToDisplay` of the display's resolution
 * per axis (1 to 2), each in samples of a history pixel: a history pixel covers
 * `historyToDisplay⁻²` of a display pixel, so it holds the setting's most samples over that square
 * (`samples`); an image of full alignment weighs one sample of it (`hysteresis`); a full shading
 * rejection keeps the rejected samples of a display pixel (`rejectedDrop`, the validity's drop to
 * it), each a display pixel's samples over that square; a pixel moving at the speed setting
 * keeps the moving samples of history (`movingDrop`), the speed read in half display pixels an
 * image (`speedInverse`, over the history's pixel). The settings' defaults where none are told.
 */
export function historySampleLaws(
  historyToDisplay: number,
  settings: HistoryLawSettings = TEMPORAL_DEFAULTS,
) {
  const square = historyToDisplay * historyToDisplay
  const samples = historySamples(historyToDisplay, settings.temporalHistorySampleCount)
  const hysteresis = 1 / samples
  return {
    samples,
    hysteresis,
    rejectedDrop: 1 - (settings.temporalShadingRejectionSampleCount / square) * hysteresis,
    movingDrop: saturate(1 - settings.temporalVelocityWeightClampingSampleCount * hysteresis),
    speedInverse: 1 / (settings.temporalVelocityWeightClampingPixelSpeed * historyToDisplay),
  }
}

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
 * The history read at the reprojected point `uv` (`resolveWgsl.ts`), of the last image's frame or,
 * where `resurrected`, of the frame the pixel is resurrected from: the colour and the validity (in
 * red) both through the five-tap Catmull-Rom, each tap clamped half a texel inside the history. A
 * highlight's negative lobes may sum below zero: a colour with a negative channel takes the centre
 * tap's alone, floored at zero; the validity is floored at zero. The light of the frame held as this
 * image holds its own: its pre-exposure's ratio (`view.preExposure.x`, that of the frame
 * resurrected `view.resurrection.y`).
 */
const historyReadText = ({ F, V4, S }: Precision) => `${
  S
    ? `
fn bicubicRead${S}(tex:texture_2d<f32>,samp:sampler,taps:TaaTaps,lo:vec2f,hi:vec2f)->${V4}{
 var t=taps;
 var sum=${V4}(0.0);
 for(var k=0;k<5;k++){sum+=${V4}(textureSampleLevel(tex,samp,clamp(t.uv[k],lo,hi),0.0))*${F}(t.weight[k]);}
 return sum;
}`
    : ''
}
struct TaaPast${S}{color:${V4},tag:${V4}}
fn historyRead${S}(uv:vec2f,resurrected:bool)->TaaPast${S}{
 var taps=catmullRomTaps(uv,view.viewport.xy,view.viewport.zw);
 let lo=0.5*view.viewport.zw;let hi=vec2f(1.0)-lo;
 var color:${V4};var tag:${V4};
 if(resurrected){color=bicubicRead${S}(historyResurrected,historySampler,taps,lo,hi);tag=bicubicRead${S}(validityResurrected,historySampler,taps,lo,hi);}
 else{color=bicubicRead${S}(history,historySampler,taps,lo,hi);tag=bicubicRead${S}(validityHistory,historySampler,taps,lo,hi);}
 if(any(color.rgb<${V4}(0.0).rgb)){
  let centre=clamp(taps.uv[2],lo,hi);
  if(resurrected){color=max(${V4}(textureSampleLevel(historyResurrected,historySampler,centre,0.0)),${V4}(0.0));}
  else{color=max(${V4}(textureSampleLevel(history,historySampler,centre,0.0)),${V4}(0.0));}
 }
 let light=${F}(select(view.preExposure.x,view.resurrection.y,resurrected));
 color=${V4}(color.rgb*light,color.a);
 return TaaPast${S}(color,max(tag,${V4}(0.0)));
}`

const HISTORY_READ_WGSL = wgslBlock(
  'HISTORY_READ_WGSL',
  [CATMULL_ROM_TAPS_WGSL],
  historyReadText(FULL_PRECISION),
)
const HISTORY_READ_HALF_WGSL = wgslBlock(
  'HISTORY_READ_HALF_WGSL',
  [CATMULL_ROM_TAPS_WGSL, ...HALF_PRECISION.enable],
  historyReadText(HALF_PRECISION),
)
/** The history's read in precision `p` (`historyRead`, `historyReadH`): in 16 bits each tap's
 *  colour and weight are converted before they are summed (`bicubicReadH`). */
export const historyReadWgsl = (p: Precision) =>
  p === HALF_PRECISION ? HISTORY_READ_HALF_WGSL : HISTORY_READ_WGSL

/**
 * The weight laws of the history update, in whole histories (`historyHysteresis` an image of full
 * alignment), the history's laws as the pass's uniform holds them (`view.history`, `view.fraction`,
 * `historySampleLaws` of the history's size over the display's): `prevMultiplier`, the history's
 * weight per unit of the image's at blend factor `b`, `(1 − b) / b` (`prevMultiplierH` in 16 bits);
 * and `safeRcp`.
 */
export const HISTORY_WEIGHTS_WGSL = wgslBlock(
  'HISTORY_WEIGHTS_WGSL',
  [safeRcp],
  `
fn historySamples()->f32{return view.history.x;}
fn historyHysteresis()->f32{return view.history.y;}
fn rejectedValidityDrop()->f32{return view.history.z;}
fn movingValidityDrop()->f32{return view.history.w;}
fn movingSpeedInverse()->f32{return view.fraction.x;}
fn prevMultiplier(b:f32)->f32{return (1.0-b)/max(b,1e-30);}`,
)
const HISTORY_WEIGHTS_HALF_WGSL = wgslBlock(
  'HISTORY_WEIGHTS_HALF_WGSL',
  [HISTORY_WEIGHTS_WGSL, ...HALF_PRECISION.enable],
  `
fn prevMultiplierH(b:f16)->f16{return (1.0-b)/max(b,${wgslF32(HALF_PRECISION.tiny)});}`,
)
/** The weight laws in precision `p`. */
export const historyWeightsWgsl = (p: Precision) =>
  p === HALF_PRECISION ? HISTORY_WEIGHTS_HALF_WGSL : HISTORY_WEIGHTS_WGSL
