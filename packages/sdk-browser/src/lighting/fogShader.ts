/**
 * The fog laws of `packages/sdk-core/src/scene/core/fog.ts` in the shader, on the fog block of the
 * contract buffer (`DirectLights.fog`, slots `FOG_SLOT`): the linear ramp, and the height fog of
 * `fogHeight.ts` — the density `baseDensity · 2^(−falloff · (y − baseHeight))`, the transmittance
 * `2^(−X)` with `X` the density at the eye times the ray's length times `(1 − 2^(−F)) / F`, `F`
 * the falloff times the rise (`ln 2` where `F` is nearly nil, by its first-order expansion), never
 * below `1 − maxOpacity`.
 *
 * Steps of the height fog, in order: beyond the cutoff distance there is no fog; the eye's height
 * is held to 655 m above the base height, the ray's rise compensated, so that no exponent leaves
 * what a 32-bit float holds; a start distance moves the ray's origin along it; the mean density of
 * what remains is shared with the sun's lobe, which crosses it from its own start distance on.
 * The mean density is written from the ray's lower end — the same value as from the eye, as the
 * product of the density there and `(1 − 2^(−|F|)) / |F|` — so that neither a high eye over a steep
 * falloff, whose density underflows, nor a deep one, whose density overflows, loses the integral
 * to a product of a huge number and a tiny one. Each exponent is held where the power of 2 stays
 * finite, the optical depth where nothing remains of the light, so no pixel reads an infinity.
 */
import { TAU } from '../../../math/src/constants.ts'
import { ATMOSPHERE_SLOT } from '../../../sdk-core/src/scene/core/atmospherePack.ts'
import { FOG_MODE, FOG_SLOT } from '../../../sdk-core/src/scene/core/fog.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { HAZE_READ_WGSL } from './atmosphere/hazeReadWgsl.ts'
import { VIEW_SLOT } from './atmosphere/layout.ts'

const fog = (slot: number) => `directLights.fog[${slot}]`
const air = (slot: number) => `directLights.atmosphere[${slot}]`
/** The sky's mean radiance at the fog's altitude, the GPU writes each image. */
const SKY_MEAN = `directLights.atmosphereView[${VIEW_SLOT.haze}].xyz`
/** What the atmosphere gives the fog of the sky: its mean radiance, the atmosphere's contribution
 *  and the fog's own factor. */
const SKY_AMBIENT = `${fog(FOG_SLOT.sky)}.rgb*${SKY_MEAN}*${air(ATMOSPHERE_SLOT.sunTransmittance)}.w`
/** What the atmosphere gives the sun's lobe: the sun's illuminance on the ground, through the
 *  air, times the atmosphere's contribution. */
const SUN_ON_GROUND = `${air(ATMOSPHERE_SLOT.sunIlluminance)}.rgb*${air(ATMOSPHERE_SLOT.sunTransmittance)}.rgb*${air(ATMOSPHERE_SLOT.sunTransmittance)}.w`

/** `fogOver`: the fog apart, for a layer that multiplies what lies behind it — its inscattering,
 *  then the transmittance from the eye to `P`; no fog adds nothing and keeps everything — and
 *  `fogged`: a lit colour at the world point `P` seen from `eye`, behind the fog; no fog leaves it
 *  as it is.
 *
 *  With an atmosphere the sky's mean radiance, times the fog's factor and the atmosphere's
 *  contribution, adds to the fog's colour, the sun's light on the ground to the lobe's, and the
 *  haze of the air (`aerialPerspective`, `../atmosphere/hazeReadWgsl.ts`) lies over the fog's: the
 *  fog's inscattering and transmittance first, then the haze's light through the fog's
 *  transmittance, the two transmittances multiplied. Without one, nothing of it is read. */
export const FOG_WGSL = wgslBlock(
  'FOG_WGSL',
  [HAZE_READ_WGSL],
  `
const FOG_LN2:f32=${Math.LN2};
const FOG_UNIFORM_PHASE:f32=${1 / (2 * TAU)};
const FOG_OBSERVER_REACH:f32=655.36;
fn linearFog(P:vec3f,eye:vec3f,withSky:bool)->vec4f{
 let law=${fog(FOG_SLOT.law)};
 let kept=clamp((law.y-length(P-eye))/max(law.y-law.x,1e-6),0.0,1.0);
 var colour=${fog(FOG_SLOT.color)}.rgb;
 if(withSky){colour+=${SKY_AMBIENT};}
 return vec4f(colour*(1.0-kept),kept);
}
fn heightFog(P:vec3f,eye:vec3f,withSky:bool)->vec4f{
 let law=${fog(FOG_SLOT.law)};
 let range=${fog(FOG_SLOT.range)};
 let sun=${fog(FOG_SLOT.sun)};
 let observer=min(eye.y,law.z+FOG_OBSERVER_REACH);
 let ray=vec3f(P.x-eye.x,P.y-observer,P.z-eye.z);
 let invLength=inverseSqrt(max(dot(ray,ray),1e-8));
 let d=dot(ray,ray)*invLength;
 if(range.y>0.0&&d>range.y){return vec4f(0.0,0.0,0.0,1.0);}
 let along=range.x*invLength;
 let rayLength=(1.0-along)*d;
 let rise=ray.y*(1.0-along);
 let low=observer+along*ray.y+min(rise,0.0);
 let f=abs(law.y*rise);
 let gathered=law.x*min(exp2(clamp(-law.y*(low-law.z),-126.0,126.0)),1e30)*select(FOG_LN2-0.5*FOG_LN2*FOG_LN2*f,(1.0-exp2(-f))/f,f>0.01);
 let kept=max(saturate(exp2(-min(gathered*rayLength,126.0))),1.0-law.w);
 var colour=${fog(FOG_SLOT.color)}.rgb;
 var lobeColour=${fog(FOG_SLOT.lobe)}.rgb*sun.w;
 if(withSky){
  colour+=${SKY_AMBIENT};
  lobeColour+=${SUN_ON_GROUND};
 }
 var lobe=vec3f(0.0);
 if(dot(lobeColour,vec3f(1.0))>0.0){
  let toward=pow(saturate(dot(ray*invLength,sun.xyz)),range.z);
  let through=saturate(exp2(-min(gathered*max(rayLength-range.w,0.0),126.0)));
  lobe=lobeColour*(toward*FOG_UNIFORM_PHASE*(1.0-through));
 }
 return vec4f(colour*(1.0-kept)+lobe,kept);
}
fn fogOver(P:vec3f,eye:vec3f)->vec4f{
 let withSky=${air(ATMOSPHERE_SLOT.planet)}.x!=0.0;
 let mode=${fog(FOG_SLOT.color)}.w;
 var over=vec4f(0.0,0.0,0.0,1.0);
 if(mode>${FOG_MODE.exponential - 0.5}){over=heightFog(P,eye,withSky);}
 else if(mode>${FOG_MODE.none}.5){over=linearFog(P,eye,withSky);}
 if(!withSky){return over;}
 let haze=aerialPerspective(P,eye);
 return vec4f(over.rgb+haze.rgb*over.a,over.a*haze.a);
}
fn fogged(rgb:vec3f,P:vec3f,eye:vec3f)->vec3f{
 if(${fog(FOG_SLOT.color)}.w==${FOG_MODE.none}.0&&${air(ATMOSPHERE_SLOT.planet)}.x==0.0){return rgb;}
 let over=fogOver(P,eye);
 return rgb*over.a+over.rgb;
}`,
)
