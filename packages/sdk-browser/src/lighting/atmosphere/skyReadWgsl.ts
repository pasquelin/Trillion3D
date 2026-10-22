import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SKY_RAYS } from './layout.ts'
import { SKY_RAYS_COORDINATES_WGSL } from './skyRaysCoordinatesWgsl.ts'

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
 *   the filtered cube along `d` at the mip the roughness asks (`skyLightReflection`); an atmosphere
 *   without a sky light shows its sky by direction above the horizon (`skyRaysWgsl.ts`) and none
 *   below it; else nothing. `skyRadiance(d)` is the sharp one, a ray's;
 * - `skyShown()`: the scene shows a sky a reflection reads;
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
  [SKY_DIFFUSE_READ_WGSL, SKY_RAYS_COORDINATES_WGSL],
  `fn skyRaysTexel(column:i32,row:i32)->vec3f{
 let at=u32(clamp(row,0,${SKY_RAYS.elevation - 1}))*SKY_RAYS_AZIMUTH+u32(((column%${SKY_RAYS.azimuth})+${SKY_RAYS.azimuth})%${SKY_RAYS.azimuth});
 let word=directLights.skyRays[at];
 return vec3f(unpack2x16float(word.x),unpack2x16float(word.y).x);
}
fn skyRaysRead(d:vec3f)->vec3f{
 let at=skyRaysCoordinates(d);
 let base=floor(at);
 let f=at-base;
 let column=i32(base.x);let row=i32(base.y);
 let low=mix(skyRaysTexel(column,row),skyRaysTexel(column+1,row),f.x);
 let high=mix(skyRaysTexel(column,row+1),skyRaysTexel(column+1,row+1),f.x);
 return mix(low,high,f.y);
}
fn skyAirShown()->bool{return directLights.atmosphere[${ATMOSPHERE_SLOT.planet}].x!=0.0;}
fn skyShown()->bool{return skyLit()||skyAirShown();}
fn skyRadianceAt(d:vec3f,roughness:f32)->vec3f{
 if(skyLit()){return skyLightReflection(d,roughness);}
 if(d.y<0.0||!skyAirShown()){return vec3f(0.0);}
 return skyRaysRead(d);
}
fn skyRadiance(d:vec3f)->vec3f{return skyRadianceAt(d,0.0);}
fn skyProbeRadiance(d:vec3f)->vec3f{
 if(!skyLit()){return vec3f(0.0);}
 return skyLightRay(d);
}`,
)
