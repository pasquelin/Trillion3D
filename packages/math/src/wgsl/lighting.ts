import { wgslConst, wgslFn } from './decl.ts'
import { INVERSE_PI, PI } from './constants.ts'

/**
 * The standard material's terms, as the lights, the mirror and the area lights compute them: one
 * declaration a term, one operation order — the diffuse albedo times 1/π (`lambertAlbedoMul`), N·V
 * clamped (`ndotvClamped`). The paired α² `(r·r)·(r·r)` stays in its shaders
 * (`standardLighting.ts`, `reflections/field.ts`): each one sums its last product
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

/** The grazing reflectance of a specular colour `f0`, `clamp(50·f0.g)`: no real material reflects
 *  under 2%, so a lower specular is taken as specular occlusion baked into the material and dims
 *  the grazing reflection with it. */
export const specularF90 = wgslFn(
  'specularF90',
  [],
  'fn specularF90(f0:vec3f)->f32{return clamp(50.0*f0.g,0.0,1.0);}',
)

/** `x` to the fifth power, two products of the square: the Fresnel's falloff and the Burley diffuse's retro-reflection. */
export const pow5 = wgslFn('pow5', [], 'fn pow5(x:f32)->f32{let x2=x*x;return x2*x2*x;}')

/** Schlick's Fresnel (Schlick 1994) on a specular colour `f0` whose grazing value is `f90` (a
 *  specular's `specularF90`): the engine's one Fresnel term, of the standard, anisotropic and coat
 *  lobes and of a thin surface's two interfaces. Its fifth power is two products of the square. */
export const fresnelSchlick = wgslFn(
  'fresnelSchlick',
  [pow5],
  'fn fresnelSchlick(f0:vec3f,f90:f32,cosine:f32)->vec3f{let Fc=pow5(clamp(1.0-cosine,0.0,1.0));return f90*Fc+(1.0-Fc)*f0;}',
)

/** A cosine wrapped about the horizon of a sphere of sin² α `sinSq`: the Hermite curve from 0 at
 *  −sin α to sin α at sin α, whose slope there is 1, joining the plain cosine. The wrap of a lamp
 *  of size and of a rectangle light's diffuse. */
export const horizonWrap = wgslFn(
  'horizonWrap',
  [],
  `fn horizonWrap(cosine:f32,sinSq:f32)->f32{
 let s=sqrt(sinSq);
 if(cosine<s&&s>0.0){
  let c=max(cosine,-s);
  return (s+c)*(s+c)/(4.0*s);
 }
 return cosine;
}`,
)

/** The Lambert diffuse albedo: times 1/π. */
export const lambertAlbedoMul = wgslFn(
  'lambertAlbedoMul',
  [INVERSE_PI],
  'fn lambertAlbedoMul(rgb:vec3f,metal:f32)->vec3f{return rgb*(1.0-metal)*INVERSE_PI;}',
)

/** The radiance a Lambert surface returns of an `irradiance`, occluded by `ao`: the one diffuse of
 *  every irradiance — a light's, the environment's, the bounce's, a thin surface's back. */
export const lambertDiffuse = wgslFn(
  'lambertDiffuse',
  [lambertAlbedoMul],
  'fn lambertDiffuse(rgb:vec3f,metal:f32,irradiance:vec3f,ao:f32)->vec3f{return lambertAlbedoMul(rgb,metal)*irradiance*ao;}',
)

/** The lobe's reflectance on `f0` from its table entry `t`: the magnitude `t.x` under a Fresnel of 1
 *  and the share `t.y` of it under the Fresnel's fifth power, whose grazing value is `specularF90`
 *  as in the light's own term: `f0·t.x + (f90 − f0)·t.y`. */
export const splitSumTerm = wgslFn(
  'splitSumTerm',
  [specularF90],
  'fn splitSumTerm(f0:vec3f,t:vec4f)->vec3f{return f0*t.x+(vec3f(specularF90(f0))-f0)*t.y;}',
)

export const ndotvClamped = wgslFn(
  'ndotvClamped',
  [],
  'fn ndotvClamped(N:vec3f,V:vec3f)->f32{return clamp(dot(N,V),1e-4,1.0);}',
)

/**
 * The share of the light that comes from the direction `dir` which the open sky of a surface lets through:
 * the sky as a spherical gaussian (Wang et al. 2009, "All-Frequency Rendering of Dynamic, Spatially-Varying
 * Reflectance"), a cone of the bent normal `bent` — a unit vector — and the amount `ao` of open sky (cosine
 * weighted, in (0, 1]: its sharpness `(0.75 + 1.25·√(1 − ao)) / ao`), over the hemisphere of the normal `N` as
 * the same kind of gaussian (sharpness 0.81, the amplitude that makes `ao = 1` integrate to 2π), held to
 * [0, 1]. A gaussian is `amplitude · exp(sharpness · (axis·dir − 1))`.
 */
export const directionVisibility = wgslFn(
  'directionVisibility',
  [],
  `fn directionVisibility(N:vec3f,bent:vec3f,ao:f32,dir:vec3f)->f32{
 let amplitude=0.81/(1.0-exp(-1.62));
 let hemisphere=amplitude*exp(0.81*(dot(N,dir)-1.0));
 let sharpness=(0.75+1.25*sqrt(1.0-saturate(ao)))/max(ao,1e-4);
 let visible=amplitude*exp(sharpness*(dot(bent,dir)-1.0));
 return saturate(visible/hemisphere);
}`,
)
