import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { ACES, AGX, CINEON, NEUTRAL } from './toneCurveConstants.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { maxChannel, minChannel } from '../../../math/src/wgsl/sampling.ts'

/** The filmic curve (ACES, its 0.6 exposure scale folded in), the default one. */
const ACES_WGSL = wgslBlock(
  'ACES_WGSL',
  [],
  `
fn aces(color:vec3f)->vec3f{
 var c=color/${ACES.exposure};
 c=${ACES.input}*c;
 let a=${ACES.numerator};let b=${ACES.denominator};c=a/b;
 c=${ACES.output}*c;
 return clamp(c,vec3f(0.0),vec3f(1.0));
}`,
)

const R = TONE_MAPPING_RANK

/**
 * Every display curve a scene may choose (`SceneEnvironment.toneMapping`), picked by its rank:
 * a uniform branch, the same for every pixel of the pass. Each is as follows:
 * - `linear` clips, `reinhard` is `c / (1 + c)`;
 * - `cineon` is a filmic rational fit, which carries a display gamma of its own
 *   that the power 2.2 takes back to linear before the sRGB transfer;
 * - `agx` is a filmic image formation: to the BT.2020 primaries, the inset, a log2 encoding
 *   over [-12.47, 4.03] EV, the sixth-degree contrast fit, the outset, back to linear sRGB;
 * - `neutral` is a neutral operator, which keeps base colours below 0.76 as they are.
 */
export const TONE_MAPPING_WGSL = wgslBlock(
  'TONE_MAPPING_WGSL',
  [ACES_WGSL, maxChannel, minChannel],
  `fn cineonCurve(color:vec3f)->vec3f{
 let x=max(vec3f(0.0),color-${CINEON.offset});
 return pow(${CINEON.curve},vec3f(2.2));
}
fn agxCurve(color:vec3f)->vec3f{
 let toWide=${AGX.toWide};
 let toNarrow=${AGX.toNarrow};
 let inset=${AGX.inset};
 let outset=${AGX.outset};
 let low=${wgslF32(AGX.low)};let high=${wgslF32(AGX.high)};
 var c=inset*(toWide*color);
 c=clamp((log2(max(c,vec3f(1e-10)))-low)/(high-low),vec3f(0.0),vec3f(1.0));
 let c2=c*c;let c4=c2*c2;
 c=${AGX.contrast};
 c=pow(max(vec3f(0.0),outset*c),vec3f(2.2));
 return clamp(toNarrow*c,vec3f(0.0),vec3f(1.0));
}
fn neutralCurve(color:vec3f)->vec3f{
 let low=minChannel(color);
 var c=color-select(${NEUTRAL.offset},${NEUTRAL.toeOffset},${NEUTRAL.toe});
 let peak=maxChannel(c);
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
}`,
)

const F = ACES.fit

/**
 * Each display curve's inverse, by the rank `toneMap` reads: the exposed radiance `toneMap` turns
 * into the display value `y`, each channel below 1. ACES and Cineon solve their rational fit's
 * quadratic, around ACES's two matrices inverted; Reinhard is `y / (1 − y)`; AgX inverts its
 * matrices and its power, its contrast polynomial by bisection over its [0, 1] domain, then its log
 * encoding; the neutral operator undoes its shoulder at the peak, then its toe at the lowest
 * channel. `linear` and `none` keep `y`. What a mirror needs to show a colour the display shows
 * (`../reflections/gpu.ts`).
 */
export const TONE_UNMAPPING_WGSL = wgslBlock(
  'TONE_UNMAPPING_WGSL',
  [maxChannel, minChannel],
  `fn acesInverse(y:vec3f)->vec3f{
 let v=clamp(${ACES.outputInverse}*y,vec3f(${wgslF32(-F.b / F.f)}),vec3f(1.0));
 let a=1.0-v*${wgslF32(F.d)};let b=${wgslF32(F.a)}-v*${wgslF32(F.e)};let c=${wgslF32(F.b)}+v*${wgslF32(F.f)};
 return max(${ACES.exposure}*(${ACES.inputInverse}*((sqrt(b*b+4.0*a*c)-b)/(2.0*a))),vec3f(0.0));
}
fn cineonInverse(y:vec3f)->vec3f{
 let v=pow(y,vec3f(1.0/2.2));
 let a=6.2*(1.0-v);let b=0.5-1.7*v;let c=0.06*v;
 return (sqrt(b*b+4.0*a*c)-b)/(2.0*a)+${CINEON.offset};
}
fn agxInverse(y:vec3f)->vec3f{
 let toNarrow=${AGX.toNarrowInverse};
 let outset=${AGX.outsetInverse};
 let w=outset*pow(max(toNarrow*y,vec3f(0.0)),vec3f(1.0/2.2));
 var low=vec3f(0.0);var high=vec3f(1.0);
 for(var k=0;k<24;k++){
  let c=0.5*(low+high);let c2=c*c;let c4=c2*c2;
  let above=${AGX.contrast}>w;
  high=select(high,c,above);low=select(c,low,above);
 }
 let e=${wgslF32(AGX.low)}+0.5*(low+high)*${wgslF32(AGX.high - AGX.low)};
 return max(${AGX.intoLogInverse}*exp2(e),vec3f(0.0));
}
fn neutralInverse(y:vec3f)->vec3f{
 let top=maxChannel(y);
 var c=y;
 if(top>=${NEUTRAL.knee}){
  let peak=0.52+0.0576/(1.0-top);
  let g=1.0-1.0/(0.15*(peak-top)+1.0);
  c=(y-g*top)/(1.0-g)*(peak/top);
 }
 let m=minChannel(c);
 let low=sqrt(max(m,0.0)/6.25);
 return c+select(${NEUTRAL.offset},low-m,m<0.04);
}
fn toneUnmap(y:vec3f,curve:u32)->vec3f{
 if(curve==${R.none}u||curve==${R.linear}u){return y;}
 if(curve==${R.reinhard}u){return y/(vec3f(1.0)-y);}
 if(curve==${R.cineon}u){return cineonInverse(y);}
 if(curve==${R.agx}u){return agxInverse(y);}
 if(curve==${R.neutral}u){return neutralInverse(y);}
 return acesInverse(y);
}`,
)
