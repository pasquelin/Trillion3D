import { wgslConst, wgslFn } from './decl.ts'
import { INVERSE_PI, PI } from './constants.ts'

/**
 * The standard material's terms, as the lights, the mirror and the area lights compute them: one
 * declaration a term, one operation order — the diffuse albedo times 1/π (`lambertAlbedoMul`), N·V
 * clamped (`ndotvClamped`). The paired α² `(r·r)·(r·r)` stays in its shaders
 * (`standardLighting.ts`, `reflections/field.ts`, `reflections/footprint.ts`): each one sums its last product
 * there (`1 − α²`, `α² − 1`, `1 + α²`), a sum the compiler may fuse with it, and a call returning
 * α² would round it apart.
 */

/** Henyey and Greenstein's phase function of the cosine `cosTheta` between the direction toward the
 *  light and the one toward the eye, `g` the medium's distribution: 0 equally every way, toward 1
 *  forward, toward −1 back. It sums to 1 over the sphere, so a light of illuminance `E` scatters a
 *  radiance `E · phase`: the air's haze and the fog's volume read it. */
export const hgPhase = wgslFn(
  'hgPhase',
  [PI],
  `fn hgPhase(g:f32,cosTheta:f32)->f32{
 let numer=1.0-g*g;
 let denom=1.0+g*g+2.0*g*cosTheta;
 return numer/(4.0*PI*denom*sqrt(denom));
}`,
)

export const DIELECTRIC_F0 = wgslConst('DIELECTRIC_F0', [], 'const DIELECTRIC_F0=vec3f(0.04);')

export const fresnelScalar = wgslFn(
  'fresnelScalar',
  [],
  'fn fresnelScalar(f0:f32,cosine:f32)->f32{let x=clamp(1.0-cosine,0.0,1.0);let x2=x*x;return f0+(1.0-f0)*(x2*x2*x);}',
)

export const fresnelSchlick = wgslFn(
  'fresnelSchlick',
  [fresnelScalar],
  'fn fresnelSchlick(f0:vec3f,cosine:f32)->vec3f{return vec3f(fresnelScalar(f0.x,cosine),fresnelScalar(f0.y,cosine),fresnelScalar(f0.z,cosine));}',
)

/** Schlick's Fresnel (Schlick 1994) on a specular colour `f0`, its grazing value
 *  `f90 = clamp(50·f0.g)`: no real material reflects under 2%, so a lower specular is taken as
 *  specular occlusion baked into the material and dims the grazing reflection with it. */
export const fresnelSchlickOccludedF90 = wgslFn(
  'fresnelSchlickOccludedF90',
  [],
  'fn fresnelSchlickOccludedF90(f0:vec3f,cosine:f32)->vec3f{let x=clamp(1.0-cosine,0.0,1.0);let x2=x*x;let Fc=x2*x2*x;return clamp(50.0*f0.g,0.0,1.0)*Fc+(1.0-Fc)*f0;}',
)

export const f0Of = wgslFn(
  'f0Of',
  [DIELECTRIC_F0],
  'fn f0Of(rgb:vec3f,metal:f32)->vec3f{return mix(DIELECTRIC_F0,rgb,metal);}',
)

/** The Lambert diffuse albedo: times 1/π. */
export const lambertAlbedoMul = wgslFn(
  'lambertAlbedoMul',
  [INVERSE_PI],
  'fn lambertAlbedoMul(rgb:vec3f,metal:f32)->vec3f{return rgb*(1.0-metal)*INVERSE_PI;}',
)

/** The radiance a Lambert surface returns of an `irradiance`, occluded by `ao`: the one diffuse of
 *  every irradiance — a light's, the environment's, the bounce's, a thin surface's back, a proxy
 *  hit's. */
export const lambertDiffuse = wgslFn(
  'lambertDiffuse',
  [lambertAlbedoMul],
  'fn lambertDiffuse(rgb:vec3f,metal:f32,irradiance:vec3f,ao:f32)->vec3f{return lambertAlbedoMul(rgb,metal)*irradiance*ao;}',
)

export const splitSumTerm = wgslFn(
  'splitSumTerm',
  [],
  'fn splitSumTerm(f0:vec3f,t:vec4f)->vec3f{return f0*t.x+(vec3f(1.0)-f0)*t.y;}',
)

export const ndotvClamped = wgslFn(
  'ndotvClamped',
  [],
  'fn ndotvClamped(N:vec3f,V:vec3f)->f32{return clamp(dot(N,V),1e-4,1.0);}',
)
