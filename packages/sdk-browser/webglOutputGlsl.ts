import { TONE_MAPPING_RANK as R } from '../sdk-core/sceneEnvironment.ts';

/**
 * The display chain's last two links, in GLSL, shared by every engine program that writes a
 * displayed colour: the display curve the scene chose (`toneCurve`, a rank of
 * `TONE_MAPPING_RANK`; the operators are those of `toneMappingWgsl.ts`, ACES with its 0.6
 * exposure scale folded in by default) and the sRGB transfer. One text, so that two programs
 * never encode the same colour twice. A program sets `toneCurve` on every frame it draws.
 */
export const OUTPUT_TRANSFER_GLSL = `uniform int toneCurve;
vec3 aces(vec3 c){c/=0.6;c=mat3(0.59719,0.07600,0.02840,0.35458,0.90834,0.13383,0.04823,0.01566,0.83777)*c;
vec3 a=c*(c+0.0245786)-0.000090537,b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
return clamp(mat3(1.60475,-0.10208,-0.00327,-0.53108,1.10813,-0.07276,-0.07367,-0.00605,1.07602)*c,0.0,1.0);}
vec3 agxCurve(vec3 c){c=mat3(0.856627153315983,0.137318972929847,0.11189821299995,0.0951212405381588,0.761241990602591,0.0767994186031903,0.0482516061458583,0.101439036467562,0.811302368396859)*(mat3(0.6274,0.0691,0.0164,0.3293,0.9195,0.0880,0.0433,0.0113,0.8956)*c);
c=clamp((log2(max(c,vec3(1e-10)))+12.47393)/(4.026069+12.47393),0.0,1.0);vec3 c2=c*c,c4=c2*c2;
c=15.5*c4*c2-40.14*c4*c+31.96*c4-6.868*c2*c+0.4298*c2+0.1191*c-0.00232;
c=pow(max(vec3(0.0),mat3(1.1271005818144368,-0.1413297634984383,-0.14132976349843826,-0.11060664309660323,1.157823702216272,-0.11060664309660294,-0.016493938717834573,-0.016493938717834257,1.2519364065950405)*c),vec3(2.2));
return clamp(mat3(1.6605,-0.1246,-0.0182,-0.5876,1.1329,-0.1006,-0.0728,-0.0083,1.1187)*c,0.0,1.0);}
vec3 neutralCurve(vec3 c){float low=min(c.r,min(c.g,c.b));c-=low<0.08?low-6.25*low*low:0.04;float peak=max(c.r,max(c.g,c.b));
if(peak<0.76)return c;float top=1.0-0.0576/(peak-0.52);c*=top/peak;return mix(c,vec3(top),1.0-1.0/(0.15*(peak-top)+1.0));}
vec3 toneMap(vec3 c){if(toneCurve==${R.none})return c;if(toneCurve==${R.linear})return clamp(c,0.0,1.0);
if(toneCurve==${R.reinhard})return clamp(c/(1.0+c),0.0,1.0);
if(toneCurve==${R.cineon}){vec3 x=max(vec3(0.0),c-0.004);return pow((x*(6.2*x+0.5))/(x*(6.2*x+1.7)+0.06),vec3(2.2));}
if(toneCurve==${R.agx})return agxCurve(c);if(toneCurve==${R.neutral})return neutralCurve(c);return aces(c);}
vec3 linearToSrgb(vec3 x){bvec3 low=lessThanEqual(x,vec3(0.0031308));return mix(1.055*pow(max(x,vec3(0.0)),vec3(1.0/2.4))-0.055,12.92*x,low);}`;
