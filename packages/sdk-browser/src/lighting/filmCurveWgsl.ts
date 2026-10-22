import { RAD2DEG } from '../../../math/src/constants.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { FILM, LOG10_OF_2 } from './filmCurveConstants.ts'

/** `value` as a WGSL literal; a negative one in parentheses, never `--` after a minus. */
const f = (value: number) => (value < 0 ? `(${wgslF32(value)})` : wgslF32(value))
const { wgsl: M } = FILM

/**
 * The film curve (`filmCurveConstants.ts`): exposed linear sRGB radiance in, display-linear sRGB
 * out, each channel in [0, 1], the sRGB transfer left to the caller. The chain, in order:
 * - to the film's wide working gamut, where a bright saturated colour is widened toward a still
 *   wider gamut by how far its chroma lies from grey and how bright it is;
 * - the blue correction, then the film's work in the grading gamut: a glow on dark saturated
 *   colours and a pull of the reds toward a pivot, by hue — both measured on the colour as it was
 *   —, back to the working gamut, a first desaturation, the curve on each channel — a toe and a
 *   shoulder, in logarithms of luminance, blended where they overlap —, a second desaturation;
 * - the blue correction undone, back to sRGB, the negative channels cut.
 * Grey goes through the channel curve alone: middle grey in is middle grey out.
 */
export const FILMIC_WGSL = wgslBlock(
  'FILMIC_WGSL',
  [],
  `
fn filmChannels(w:vec3f)->vec3f{
 let logc=log2(max(w,vec3f(1e-20)))*${f(LOG10_OF_2)};
 let straight=${f(FILM.slope)}*(logc+${f(FILM.straightMatch)});
 let toe=${f(0 - FILM.blackClip)}+${f(2 * FILM.toeScale)}/(1.0+exp(${f((-2 * FILM.slope) / FILM.toeScale)}*(logc-${f(FILM.toeMatch)})));
 let shoulder=${f(1 + FILM.whiteClip)}-${f(2 * FILM.shoulderScale)}/(1.0+exp(${f((2 * FILM.slope) / FILM.shoulderScale)}*(logc-${f(FILM.shoulderMatch)})));
 let low=select(straight,toe,logc<vec3f(${f(FILM.toeMatch)}));
 let high=select(straight,shoulder,logc>vec3f(${f(FILM.shoulderMatch)}));
 var t=saturate((logc-${f(FILM.toeMatch)})/(${f(FILM.shoulderMatch - FILM.toeMatch)}));
 ${FILM.turned ? 't=1.0-t;' : ''}
 t=(3.0-2.0*t)*t*t;
 return mix(low,high,t);
}
fn filmGrading(colour:vec3f)->vec3f{
 var c=colour;
 let low=min(min(c.r,c.g),c.b);
 let high=max(max(c.r,c.g),c.b);
 let saturation=(max(high,1e-10)-max(low,1e-10))/max(high,1e-2);
 let spread=sqrt(max(c.b*(c.b-c.g)+c.g*(c.g-c.r)+c.r*(c.r-c.b),0.0));
 let lightness=(c.b+c.g+c.r+1.75*spread)/3.0;
 let x=(saturation-0.4)/0.2;
 let t0=max(1.0-abs(0.5*x),0.0);
 let gain=${f(FILM.glow.gain)}*0.5*(1.0+sign(x)*(1.0-t0*t0));
 let middle=${f(FILM.glow.middle)};
 var glow=gain;
 if(lightness>=2.0*middle){glow=0.0;}
 else if(lightness>2.0/3.0*middle){glow=gain*(middle/lightness-0.5);}
 c=c*(1.0+glow);
 var hue=0.0;
 if(!(c.r==c.g&&c.g==c.b)){hue=${f(RAD2DEG)}*atan2(${f(Math.sqrt(3))}*(c.g-c.b),2.0*c.r-c.g-c.b);}
 if(hue<0.0){hue=hue+360.0;}
 var centred=clamp(hue,0.0,360.0);
 if(centred>180.0){centred=centred-360.0;}
 let near=smoothstep(0.0,1.0,1.0-abs(2.0*centred/${f(FILM.red.width)}));
 c.r=c.r+near*near*saturation*(${f(FILM.red.pivot)}-c.r)*${f(1 - FILM.red.scale)};
 return c;
}
fn filmicCurve(color:vec3f)->vec3f{
 var c=${M.srgbToWorking}*max(color,vec3f(0.0));
 let luma=dot(c,${M.luma});
 let away=c/max(luma,1e-10)-vec3f(1.0);
 let widen=(1.0-exp2(-4.0*dot(away,away)))*(1.0-exp2(-4.0*${f(FILM.expandGamut)}*luma*luma));
 c=mix(c,${M.expand}*c,widen);
 c=max(c,vec3f(0.0));
 c=mix(c,${M.blue}*c,${f(FILM.blueCorrection)});
 var w=max(${M.gradingToWorking}*filmGrading(${M.workingToGrading}*c),vec3f(0.0));
 w=mix(vec3f(dot(w,${M.luma})),w,${f(FILM.preDesaturate)});
 var toned=filmChannels(w);
 toned=mix(vec3f(dot(toned,${M.luma})),toned,${f(FILM.postDesaturate)});
 c=mix(c,max(toned,vec3f(0.0)),${f(FILM.curveAmount)});
 c=mix(c,${M.blueBack}*c,${f(FILM.blueCorrection)});
 return clamp(${M.workingToSrgb}*c,vec3f(0.0),vec3f(1.0));
}`,
)
