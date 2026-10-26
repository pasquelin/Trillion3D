import { RAD2DEG } from '../../../math/src/constants.ts'
import { wgslOperand as f } from '../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { fieldLayout, putVec4 } from '../gpu/core/fieldLayout.ts'
import { FILM, LOG10_OF_2, type FilmCurve } from './filmCurveConstants.ts'

const { wgsl: M } = FILM

/**
 * The film curve's settings as the shader reads them (`Film`), three `vec4f`: the slope, the
 * clips and the amount of the curve; the toe's and the shoulder's scales and where the toe and
 * the straight run begin; where the shoulder begins, the blue correction and the expansion of the
 * gamut. The derived numbers (`filmCurveOf`) are computed once, on the processor.
 */
export const FILM_LAYOUT = fieldLayout('Film', [
  ['curve', 'vec4f'],
  ['scales', 'vec4f'],
  ['blend', 'vec4f'],
] as const)

/** The declaration of the structure `Film`: what the views that carry the film curve's words and
 *  the curve's functions both name. */
export const FILM_STRUCT_WGSL = wgslBlock('FILM_STRUCT_WGSL', [], FILM_LAYOUT.wgsl)

/** The curve's three vectors, in the order of `FILM_LAYOUT`: the one place that says which number
 *  goes where, for the words (`writeFilmCurve`) and for the shader's constant. */
const vectorsOf = (c: FilmCurve) =>
  [
    [c.slope, c.blackClip, c.whiteClip, c.curveAmount],
    [c.toeScale, c.shoulderScale, c.toeMatch, c.straightMatch],
    [c.shoulderMatch, c.blueCorrection, c.expandGamut, 0],
  ] as const

/** Writes the film curve `c` into `words` from the word `at` (`FILM_LAYOUT`). */
export function writeFilmCurve(words: Float32Array, at: number, c: FilmCurve) {
  vectorsOf(c).forEach(([x, y, z, w], i) => putVec4(words, at + 4 * i, x, y, z, w))
}

/** The curve `c` as a WGSL constant of the structure `Film`. */
const filmConstant = (c: FilmCurve) =>
  `Film(${vectorsOf(c)
    .map((vector) => `vec4f(${vector.map(f).join(',')})`)
    .join(',')})`

/**
 * The measures of a colour the glow and the red modifier of the film curve read, and the standard
 * output transform's first version (`aces/aces13Wgsl.ts`) reads the same way, in the grading
 * gamut: `rrtSaturation` the distance from grey, `rrtGlow` the factor the glow multiplies the
 * colour by (one plus its gain, which fades out where the colour is bright), `rrtHue` the hue
 * angle in degrees from the red, in (−180, 180]. The one guard the reference does not have is
 * here: `rrtGlow` takes the square root of the sum of products of the channels, cut at 0. That sum is
 * half the sum of the squares of the channel differences, never negative in exact arithmetic, a few
 * units in the last place under 0 for a grey in single precision, where a square root has no value.
 */
export const RRT_MEASURES_WGSL = wgslBlock(
  'RRT_MEASURES_WGSL',
  [],
  `
fn rrtSaturation(c:vec3f)->f32{
 let low=min(min(c.r,c.g),c.b);
 let high=max(max(c.r,c.g),c.b);
 return (max(high,1e-10)-max(low,1e-10))/max(high,1e-2);
}
fn rrtGlow(c:vec3f,saturation:f32)->f32{
 let spread=sqrt(max(c.b*(c.b-c.g)+c.g*(c.g-c.r)+c.r*(c.r-c.b),0.0));
 let lightness=(c.b+c.g+c.r+1.75*spread)/3.0;
 let x=(saturation-0.4)/0.2;
 let t0=max(1.0-abs(0.5*x),0.0);
 let gain=${f(FILM.glow.gain)}*0.5*(1.0+sign(x)*(1.0-t0*t0));
 let middle=${f(FILM.glow.middle)};
 var glow=gain;
 if(lightness>=2.0*middle){glow=0.0;}
 else if(lightness>2.0/3.0*middle){glow=gain*(middle/lightness-0.5);}
 return 1.0+glow;
}
fn rrtHue(c:vec3f)->f32{
 var hue=0.0;
 if(!(c.r==c.g&&c.g==c.b)){hue=${f(RAD2DEG)}*atan2(${f(Math.sqrt(3))}*(c.g-c.b),2.0*c.r-c.g-c.b);}
 if(hue<0.0){hue=hue+360.0;}
 var centred=clamp(hue,0.0,360.0);
 if(centred>180.0){centred=centred-360.0;}
 return centred;
}`,
)

/**
 * The film curve (`filmCurveConstants.ts`): exposed linear sRGB radiance in, display-linear sRGB
 * out. The chain, in order:
 * - to the film's wide working gamut, where a bright saturated colour is widened toward a still
 *   wider gamut by how far its chroma lies from grey and how bright it is (`expandedGamut`) —
 *   the colour grade (`GRADE_WGSL`, `./toneBakeWgsl.ts`) follows it where the table is baked;
 * - the blue correction, then the film's work in the grading gamut: a glow on dark saturated
 *   colours and a pull of the reds toward a pivot, by hue — both measured on the colour as it was
 *   —, back to the working gamut, a first desaturation, the curve on each channel — a toe and a
 *   shoulder, in logarithms of luminance, blended where they overlap —, a second desaturation,
 *   the curve's amount mixed in;
 * - the blue correction undone, back to sRGB, the negative channels cut (`filmicFromAp1`).
 * Grey goes through the channel curve alone: middle grey in is middle grey out. `filmicCurve` is
 * the chain at the settings' defaults, its output cut to [0, 1], the sRGB transfer left to the
 * caller: the display curve of the rank `filmic` (`toneMap`) at no setting of the colour grading.
 *
 * The guard of the measures above (`RRT_MEASURES_WGSL`) is the only one the reference does not
 * have. A black light, whose logarithm and whose chroma divide by nothing, comes out as a value
 * that is not a number, which the table stores as 0 and the display value of the curves read
 * without it writes as 0 (`storableWgsl.ts`), as the reference's unsigned targets do.
 */
export const FILMIC_WGSL = wgslBlock(
  'FILMIC_WGSL',
  [FILM_STRUCT_WGSL, RRT_MEASURES_WGSL],
  `
const FILM_DEFAULT=${filmConstant(FILM)};
fn filmChannels(w:vec3f,film:Film)->vec3f{
 let slope=film.curve.x;
 let toeScale=film.scales.x;
 let shoulderScale=film.scales.y;
 let toeMatch=film.scales.z;
 let shoulderMatch=film.blend.x;
 let logc=log2(w)*${f(LOG10_OF_2)};
 let straight=slope*(logc+film.scales.w);
 let toe=-film.curve.y+2.0*toeScale/(1.0+exp(-2.0*slope/toeScale*(logc-toeMatch)));
 let shoulder=1.0+film.curve.z-2.0*shoulderScale/(1.0+exp(2.0*slope/shoulderScale*(logc-shoulderMatch)));
 let low=select(straight,toe,logc<vec3f(toeMatch));
 let high=select(straight,shoulder,logc>vec3f(shoulderMatch));
 var t=saturate((logc-toeMatch)/(shoulderMatch-toeMatch));
 if(shoulderMatch<toeMatch){t=1.0-t;}
 t=(3.0-2.0*t)*t*t;
 return mix(low,high,t);
}
fn filmGlowAndRed(colour:vec3f)->vec3f{
 let saturation=rrtSaturation(colour);
 var c=colour*rrtGlow(colour,saturation);
 let near=smoothstep(0.0,1.0,1.0-abs(2.0*rrtHue(c)/${f(FILM.red.width)}));
 c.r=c.r+near*near*saturation*(${f(FILM.red.pivot)}-c.r)*${f(1 - FILM.red.scale)};
 return c;
}
fn expandedGamut(ap1:vec3f,film:Film)->vec3f{
 let luma=dot(ap1,${M.luma});
 let away=ap1/luma-vec3f(1.0);
 let widen=(1.0-exp2(-4.0*dot(away,away)))*(1.0-exp2(-4.0*film.blend.z*luma*luma));
 return mix(ap1,${M.expand}*ap1,widen);
}
fn filmicFromAp1(ap1:vec3f,film:Film)->vec3f{
 var c=mix(ap1,${M.blue}*ap1,film.blend.y);
 var w=max(${M.gradingToWorking}*filmGlowAndRed(${M.workingToGrading}*c),vec3f(0.0));
 w=mix(vec3f(dot(w,${M.luma})),w,${f(FILM.preDesaturate)});
 var toned=filmChannels(w,film);
 toned=mix(vec3f(dot(toned,${M.luma})),toned,${f(FILM.postDesaturate)});
 c=mix(c,max(toned,vec3f(0.0)),film.curve.w);
 c=mix(c,${M.blueBack}*c,film.blend.y);
 return max(${M.workingToSrgb}*c,vec3f(0.0));
}
fn filmicCurve(color:vec3f)->vec3f{
 let ap1=max(expandedGamut(${M.srgbToWorking}*max(color,vec3f(0.0)),FILM_DEFAULT),vec3f(0.0));
 return clamp(filmicFromAp1(ap1,FILM_DEFAULT),vec3f(0.0),vec3f(1.0));
}`,
)
