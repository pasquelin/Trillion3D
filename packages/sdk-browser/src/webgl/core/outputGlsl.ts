import { TONE_MAPPING_RANK as R } from '../../../../sdk-core/src/scene/core/environment.ts';
import { shaderFloat } from '../../lighting/shaderConstants.ts';
import { ACES, AGX, CINEON, NEUTRAL } from '../../lighting/toneCurveConstants.ts';

/**
 * The display chain's last two links, in GLSL, shared by every engine program that writes a
 * displayed colour: the display curve the scene chose (`toneCurve`, a rank of
 * `TONE_MAPPING_RANK`; the operators are those of `../../lighting/toneMappingWgsl.ts`, ACES with its 0.6
 * exposure scale folded in by default) and the sRGB transfer, at the exponent 0.41666 the WGSL
 * transfers write (`../../lighting/deferred/shaders.ts`) and the reference writes: an image the
 * WebGL2 path draws is the reference's to the last bit. One text, so that two programs never
 * encode the same colour twice. A program sets `toneCurve` on every frame it draws.
 */
export const OUTPUT_TRANSFER_GLSL = `uniform int toneCurve;
vec3 aces(vec3 c){c/=${ACES.exposure};c=${ACES.input.glsl}*c;
vec3 a=${ACES.numerator},b=${ACES.denominator};c=a/b;
return clamp(${ACES.output.glsl}*c,0.0,1.0);}
vec3 agxCurve(vec3 c){c=${AGX.inset.glsl}*(${AGX.toWide.glsl}*c);
c=clamp((log2(max(c,vec3(1e-10)))+${shaderFloat(-AGX.low)})/(${shaderFloat(AGX.high)}+${shaderFloat(-AGX.low)}),0.0,1.0);vec3 c2=c*c,c4=c2*c2;
c=${AGX.contrast};
c=pow(max(vec3(0.0),${AGX.outset.glsl}*c),vec3(2.2));
return clamp(${AGX.toNarrow.glsl}*c,0.0,1.0);}
vec3 neutralCurve(vec3 c){float low=min(c.r,min(c.g,c.b));c-=${NEUTRAL.toe}?${NEUTRAL.toeOffset}:${NEUTRAL.offset};float peak=max(c.r,max(c.g,c.b));
if(peak<${NEUTRAL.knee})return c;float top=${NEUTRAL.top};c*=top/peak;return mix(c,vec3(top),${NEUTRAL.blend});}
vec3 toneMap(vec3 c){if(toneCurve==${R.none})return c;if(toneCurve==${R.linear})return clamp(c,0.0,1.0);
if(toneCurve==${R.reinhard})return clamp(c/(1.0+c),0.0,1.0);
if(toneCurve==${R.cineon}){vec3 x=max(vec3(0.0),c-${CINEON.offset});return pow(${CINEON.curve},vec3(2.2));}
if(toneCurve==${R.agx})return agxCurve(c);if(toneCurve==${R.neutral})return neutralCurve(c);return aces(c);}
vec3 linearToSrgb(vec3 x){bvec3 low=lessThanEqual(x,vec3(0.0031308));return mix(1.055*pow(max(x,vec3(0.0)),vec3(0.41666))-0.055,12.92*x,low);}`;
