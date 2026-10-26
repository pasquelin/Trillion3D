import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * WHAT A PROGRAM READS OF THE SKY: the sky light's diffuse light on a surface, and the radiance of a
 * ray that leaves the scene. The sky light's own reads (`skyLightDiffuse`, `skyLightReflection`,
 * `modules/sky/skyLight/read.ts`) are declared by the program that lists these blocks, beside the
 * light buffer it already binds (`directLights`).
 *
 * - `skyLit()`: a sky light shines in this view, its cube captured and its sky lighting on;
 * - `skyIrradiance(N)`: the sky light's irradiance at the normal `N`, the sky nothing hides, which
 *   stands in where the probes do not answer; zero without a lit sky light;
 * - `skyRadianceAt(d, roughness)`: the sky a ray `d` that leaves the scene reaches. With a sky light,
 *   the filtered cube along `d` at the mip the roughness asks (`skyLightReflection`); else nothing.
 *   `skyRadiance(d)` is the sharp one, a ray's;
 * - `skyShown()`: the scene shows a sky, a sky light's or an atmosphere's, that a reflection reads
 *   in place of the background colour;
 * - `skyProbeRadiance(d)`: what a bounce probe's ray reaches: the sky light's cube where one shines,
 *   none else.
 */
export const SKY_DIFFUSE_READ_WGSL = wgslBlock(
  'SKY_DIFFUSE_READ_WGSL',
  [],
  `fn skyLit()->bool{return skyLightApplied();}
fn skyIrradiance(N:vec3f)->vec3f{
 if(!skyLightApplied()){return vec3f(0.0);}
 return skyLightIrradiance(N);
}`,
)

export const SKY_READ_WGSL = wgslBlock(
  'SKY_READ_WGSL',
  [SKY_DIFFUSE_READ_WGSL],
  `fn skyAirShown()->bool{return directLights.atmosphere[${ATMOSPHERE_SLOT.planet}].x!=0.0;}
fn skyShown()->bool{return skyLit()||skyAirShown();}
fn skyRadianceAt(d:vec3f,roughness:f32)->vec3f{
 if(!skyLit()){return vec3f(0.0);}
 return skyLightReflection(d,roughness);
}
fn skyRadiance(d:vec3f)->vec3f{return skyRadianceAt(d,0.0);}
fn skyProbeRadiance(d:vec3f)->vec3f{
 if(!skyLit()){return vec3f(0.0);}
 return skyLightRay(d);
}`,
)
