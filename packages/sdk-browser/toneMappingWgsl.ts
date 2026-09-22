import { TONE_MAPPING_RANK } from '../sdk-core/sceneEnvironment.ts';

/** The filmic curve of the reference (ACES, its 0.6 exposure scale folded in), the default one. */
export const ACES_WGSL = `
fn aces(color:vec3f)->vec3f{
 var c=color/0.6;
 c=mat3x3f(vec3f(0.59719,0.07600,0.02840),vec3f(0.35458,0.90834,0.13383),vec3f(0.04823,0.01566,0.83777))*c;
 let a=c*(c+0.0245786)-0.000090537;let b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
 c=mat3x3f(vec3f(1.60475,-0.10208,-0.00327),vec3f(-0.53108,1.10813,-0.07276),vec3f(-0.07367,-0.00605,1.07602))*c;
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
 let x=max(vec3f(0.0),color-0.004);
 return pow((x*(6.2*x+0.5))/(x*(6.2*x+1.7)+0.06),vec3f(2.2));
}
fn agxCurve(color:vec3f)->vec3f{
 let toWide=mat3x3f(vec3f(0.6274,0.0691,0.0164),vec3f(0.3293,0.9195,0.0880),vec3f(0.0433,0.0113,0.8956));
 let toNarrow=mat3x3f(vec3f(1.6605,-0.1246,-0.0182),vec3f(-0.5876,1.1329,-0.1006),vec3f(-0.0728,-0.0083,1.1187));
 let inset=mat3x3f(vec3f(0.856627153315983,0.137318972929847,0.11189821299995),vec3f(0.0951212405381588,0.761241990602591,0.0767994186031903),vec3f(0.0482516061458583,0.101439036467562,0.811302368396859));
 let outset=mat3x3f(vec3f(1.1271005818144368,-0.1413297634984383,-0.14132976349843826),vec3f(-0.11060664309660323,1.157823702216272,-0.11060664309660294),vec3f(-0.016493938717834573,-0.016493938717834257,1.2519364065950405));
 let low=-12.47393;let high=4.026069;
 var c=inset*(toWide*color);
 c=clamp((log2(max(c,vec3f(1e-10)))-low)/(high-low),vec3f(0.0),vec3f(1.0));
 let c2=c*c;let c4=c2*c2;
 c=15.5*c4*c2-40.14*c4*c+31.96*c4-6.868*c2*c+0.4298*c2+0.1191*c-0.00232;
 c=pow(max(vec3f(0.0),outset*c),vec3f(2.2));
 return clamp(toNarrow*c,vec3f(0.0),vec3f(1.0));
}
fn neutralCurve(color:vec3f)->vec3f{
 let low=min(color.r,min(color.g,color.b));
 var c=color-select(0.04,low-6.25*low*low,low<0.08);
 let peak=max(c.r,max(c.g,c.b));
 if(peak<0.76){return c;}
 let top=1.0-0.0576/(peak-0.52);
 c*=top/peak;
 return mix(c,vec3f(top),1.0-1.0/(0.15*(peak-top)+1.0));
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
