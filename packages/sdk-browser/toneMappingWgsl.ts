import { TONE_MAPPING_RANK } from '../sdk-core/src/scene/core/environment.ts';
import { shaderFloat } from './shaderConstants.ts';
import { ACES, AGX, CINEON, NEUTRAL } from './toneCurveConstants.ts';

/** The filmic curve of the reference (ACES, its 0.6 exposure scale folded in), the default one. */
export const ACES_WGSL = `
fn aces(color:vec3f)->vec3f{
 var c=color/${ACES.exposure};
 c=${ACES.input.wgsl}*c;
 let a=${ACES.numerator};let b=${ACES.denominator};c=a/b;
 c=${ACES.output.wgsl}*c;
 return clamp(c,vec3f(0.0),vec3f(1.0));
}`;

const R = TONE_MAPPING_RANK;

/**
 * Every display curve a scene may choose (`SceneEnvironment.toneMapping`), picked by its rank:
 * a uniform branch, the same for every pixel of the pass. Each is the published operator:
 * - `linear` clips, `reinhard` is `c / (1 + c)` (Reinhard et al., 2002);
 * - `cineon` is the Hejl and Burgess-Dawson filmic fit, which carries a display gamma of its own
 *   that the power 2.2 takes back to linear before the sRGB transfer;
 * - `agx` is Sobotka's AgX: to the BT.2020 primaries (ITU-R BT.2087), the inset, a log2 encoding
 *   over [-12.47, 4.03] EV, the sixth-degree contrast fit, the outset, back to linear sRGB;
 * - `neutral` is the Khronos PBR Neutral operator, which keeps base colours below 0.76 as they are.
 */
export const TONE_MAPPING_WGSL = `${ACES_WGSL}
fn cineonCurve(color:vec3f)->vec3f{
 let x=max(vec3f(0.0),color-${CINEON.offset});
 return pow(${CINEON.curve},vec3f(2.2));
}
fn agxCurve(color:vec3f)->vec3f{
 let toWide=${AGX.toWide.wgsl};
 let toNarrow=${AGX.toNarrow.wgsl};
 let inset=${AGX.inset.wgsl};
 let outset=${AGX.outset.wgsl};
 let low=${shaderFloat(AGX.low)};let high=${shaderFloat(AGX.high)};
 var c=inset*(toWide*color);
 c=clamp((log2(max(c,vec3f(1e-10)))-low)/(high-low),vec3f(0.0),vec3f(1.0));
 let c2=c*c;let c4=c2*c2;
 c=${AGX.contrast};
 c=pow(max(vec3f(0.0),outset*c),vec3f(2.2));
 return clamp(toNarrow*c,vec3f(0.0),vec3f(1.0));
}
fn neutralCurve(color:vec3f)->vec3f{
 let low=min(color.r,min(color.g,color.b));
 var c=color-select(${NEUTRAL.offset},${NEUTRAL.toeOffset},${NEUTRAL.toe});
 let peak=max(c.r,max(c.g,c.b));
 if(peak<${NEUTRAL.knee}){return c;}
 let top=${NEUTRAL.top};
 c*=top/peak;
 return mix(c,vec3f(top),${NEUTRAL.blend});
}
fn toneMap(color:vec3f,curve:u32)->vec3f{
 switch curve{
  case ${R.none}u:{return color;}
  case ${R.linear}u:{return clamp(color,vec3f(0.0),vec3f(1.0));}
  case ${R.reinhard}u:{return clamp(color/(vec3f(1.0)+color),vec3f(0.0),vec3f(1.0));}
  case ${R.cineon}u:{return cineonCurve(color);}
  case ${R.agx}u:{return agxCurve(color);}
  case ${R.neutral}u:{return neutralCurve(color);}
  default:{return aces(color);}
 }
}`;
