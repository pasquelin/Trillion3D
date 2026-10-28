import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SHADING_ENERGY_SIZE } from '../../../../sdk-core/src/lighting/shadingEnergy.ts'

/**
 * WHAT A SURFACE KEEPS OF THE LIGHT OF EVERY DIRECTION in the environment lights, read from the GGX energy table the light buffer
 * holds (`shadingEnergy.ts`): the table read at (N·V, roughness) as a texture is, bilinear between the texel centres and held to the
 * edge (`shadingEnergyPair`: `x` the lobe's albedo under a Fresnel of one, `y` the share of it weighted by the Fresnel's fifth
 * power). `energyTerms` weighs it on the reflectance `f0` and its grazing value `f90`, which the caller gives: `W · (f0 · x + (f90 − f0) · y)`,
 * `W = 1 + f0 · (1 − x) / x` restoring the energy the lobe's single scattering misses, so that a rough metal sends back all it receives. The weight of every
 * reflected radiance the environment gives a surface — the probes', the screen's, the trace's, the ambient cubemap's — and of the
 * clear coat's own share. The water's reflection is weighed by the environment BRDF (`environmentBrdfWgsl.ts`).
 */
export const ENERGY_TERMS_WGSL = wgslBlock(
  'ENERGY_TERMS_WGSL',
  [],
  `
fn shadingEnergyTexel(x:i32,y:i32)->vec2f{
 let at=u32(clamp(y,0,${SHADING_ENERGY_SIZE - 1}))*${SHADING_ENERGY_SIZE}u+u32(clamp(x,0,${SHADING_ENERGY_SIZE - 1}));
 return unpack2x16unorm(directLights.energy[at]);
}
fn shadingEnergyPair(rough:f32,NdotV:f32)->vec2f{
 let p=vec2f(NdotV,rough)*${SHADING_ENERGY_SIZE}.0-0.5;
 let f=floor(p);
 let t=p-f;
 let x=i32(f.x);let y=i32(f.y);
 return mix(mix(shadingEnergyTexel(x,y),shadingEnergyTexel(x+1,y),t.x),mix(shadingEnergyTexel(x,y+1),shadingEnergyTexel(x+1,y+1),t.x),t.y);
}
fn energyTerms(f0:vec3f,f90:f32,rough:f32,NdotV:f32)->vec3f{
 let e=shadingEnergyPair(rough,NdotV);
 let restored=vec3f(1.0)+f0*((1.0-e.x)/e.x);
 return restored*(f0*e.x+(vec3f(f90)-f0)*e.y);
}`,
)
