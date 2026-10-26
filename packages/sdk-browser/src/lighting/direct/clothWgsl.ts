import { PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { fresnelSchlick, specularF90 } from '../../../../math/src/wgsl/lighting.ts'

/**
 * THE CLOTH LOBE, the fuzz of a woven surface (`../../materials/surface/physicalLobes.ts`): an
 * asperity-scattering layer over the standard specular lobe, weighed against it by the cloth
 * amount — the specular is `mix(standard, fuzz, cloth)` and the diffuse is Lambert's, untouched.
 *
 * The fuzz lobe of one light is the inverse GGX distribution at α² = roughness⁴,
 * (1 + 4 α⁴ / d²) / (π (1 + 4 α²)) for d = N·H (1 − α²) N·H + α², the visibility
 * 1 / (4 (N·L + N·V − N·L N·V)) and Schlick's Fresnel on the fuzz colour, at the light's N·L:
 * `clothSpecular` for the `direct` light (its energy times N·L) of a surface seen at `NoV`.
 * The standard lobe a cloth mixes with is the one the pixel's light already computed (`clothMix`).
 */
export const CLOTH_LOBE_WGSL = wgslBlock(
  'CLOTH_LOBE_WGSL',
  [PI, fresnelSchlick, specularF90],
  `fn clothDistribution(a2:f32,NoH:f32)->f32{
 let d=(NoH-a2*NoH)*NoH+a2;
 return (1.0+4.0*a2*a2/(d*d))/(PI*(1.0+4.0*a2));
}
fn clothVisibility(NoV:f32,NoL:f32)->f32{return 1.0/(4.0*(NoL+NoV-NoL*NoV));}
fn clothSpecular(fuzz:vec3f,a2:f32,NoV:f32,NoL:f32,NoH:f32,VoH:f32,direct:f32)->vec3f{
 return direct*clothDistribution(a2,NoH)*clothVisibility(NoV,NoL)*fresnelSchlick(fuzz,specularF90(fuzz),VoH);
}`,
)
