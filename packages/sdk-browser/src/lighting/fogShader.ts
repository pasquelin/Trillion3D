/**
 * The fog law of `packages/sdk-core/src/scene/core/fog.ts` in the two shading languages, one text
 * for the expressions both read alike: the transmittance at a distance `d` from the eye, the
 * point `dy` above it, the eye at height `eyeY`, for the law `law` — `near, far` under the linear
 * mode, `density, heightFalloff, baseHeight` under the exponential one. The height fog's optical
 * depth is the density's mean along the ray times its length: `(ρ(eye) − ρ(P)) / (falloff · dy)`
 * in closed form, written as the density at the ray's lower end times `(1 − e^−x) / x`, `x` the
 * falloff times the rise, so that neither end's density is differenced; the two ends' mean where
 * `x` is too small for that ratio to keep its precision. The density's exponent is capped where
 * the fog is total anyway, so no pixel reads an infinity, even with the camera deep inside.
 */
import { FOG_MODE } from '../../../sdk-core/src/scene/core/fog.ts';

const LINEAR = 'clamp((law.y-d)/max(law.y-law.x,1e-6),0.0,1.0)';
const densityAt = (height: string) => `exp(min(-law.y*(${height}-law.z),80.0))`;
const EXPONENTIAL = 'exp(-law.x*d*mean)';
/** Beyond this falloff times rise, the closed form holds its precision in 32-bit floats. */
const CLOSED_FORM = 'x>1e-3';
/** The density at the ray's lower end: the eye's height, or the point's `dy` from it. */
const LOWER = densityAt('min(eyeY,eyeY+dy)');

/** `fogTransmittance`, then `fogged`: a lit colour at the world point `P` seen from `eye`, mixed
 *  into the fog of the contract buffer (`DirectLights.fog`); no fog leaves it as it is. */
export const FOG_WGSL = `
fn fogTransmittance(law:vec4f,mode:f32,d:f32,dy:f32,eyeY:f32)->f32{
 if(mode<${FOG_MODE.exponential - 0.5}){return ${LINEAR};}
 let x=abs(law.y*dy);
 let mean=${LOWER}*select((1.0+exp(-x))*0.5,(1.0-exp(-x))/x,${CLOSED_FORM});
 return ${EXPONENTIAL};
}
fn fogged(rgb:vec3f,P:vec3f,eye:vec3f)->vec3f{
 let fog=directLights.fog;
 if(fog[0].w==${FOG_MODE.none}.0){return rgb;}
 let offset=P-eye;
 return mix(fog[0].rgb,rgb,fogTransmittance(fog[1],fog[0].w,length(offset),offset.y,eye.y));
}`;

/** The same two functions for the WebGL2 program, in view space: the eye at the origin, a point's
 *  rise read through `viewRotation` (`../webgl/cluster/probe.ts`), the eye's height in `fogLaw.w`
 *  (`../webgl/cluster/fog.ts`). */
export const FOG_GLSL = `uniform vec4 fogColor,fogLaw;
float fogTransmittance(vec4 law,float mode,float d,float dy,float eyeY){
 if(mode<${FOG_MODE.exponential - 0.5})return ${LINEAR};
 float x=abs(law.y*dy);
 float mean=${LOWER}*(${CLOSED_FORM}?(1.0-exp(-x))/x:(1.0+exp(-x))*0.5);
 return ${EXPONENTIAL};
}
vec3 fogged(vec3 rgb){if(fogColor.w==${FOG_MODE.none}.0)return rgb;vec3 offset=viewPosition*viewRotation;
 return mix(fogColor.rgb,rgb,fogTransmittance(fogLaw,fogColor.w,length(viewPosition),offset.y,fogLaw.w));}`;
