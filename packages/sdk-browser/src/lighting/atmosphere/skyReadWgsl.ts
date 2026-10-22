import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { SKY_SLOT } from '../../../../sdk-core/src/scene/core/environmentSky.ts'
import { irradianceShader } from '../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SKY_RAYS } from './layout.ts'
import { SKY_RAYS_COORDINATES_WGSL } from './skyRaysCoordinatesWgsl.ts'

/**
 * WHAT A PROGRAM READS OF THE SKY, through the light buffer it already binds (`directLights`): the
 * radiance of a ray that leaves the scene along a direction, and the sky light's irradiance on a
 * surface. All zero where the scene shows no sky (`environmentSky.ts`).
 *
 * `skyRadiance` is the sky a ray of direction `d` reaches: above the horizon the atmosphere's
 * sky by direction (`skyRaysWgsl.ts`) times the sky block's factor, or with no air that factor
 * alone, the sky's colour; below it the ground colour of the sky light, black by default.
 * `skyProbeRadiance` is what a bounce probe's ray reaches: the sky where a sky light gives it, none
 * else. `skyShown` says that the scene shows a sky a reflection reads; `skyLit` that a sky light
 * lights with it. `skyIrradiance` is the sky light's irradiance at the normal `N`, the sky nothing
 * hides, which stands in where the probes do not answer.
 */
export const SKY_READ_WGSL = wgslBlock(
  'SKY_READ_WGSL',
  [SKY_RAYS_COORDINATES_WGSL],
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
fn skyShown()->bool{return directLights.sky[${SKY_SLOT.lower}].w!=0.0;}
fn skyLit()->bool{return directLights.sky[${SKY_SLOT.upper}].w!=0.0;}
fn skyRadiance(d:vec3f)->vec3f{
 if(d.y<0.0){return directLights.sky[${SKY_SLOT.lower}].rgb;}
 let factor=directLights.sky[${SKY_SLOT.upper}].rgb;
 if(directLights.atmosphere[${ATMOSPHERE_SLOT.planet}].x==0.0){return factor;}
 return factor*skyRaysRead(d);
}
fn skyProbeRadiance(d:vec3f)->vec3f{
 if(!skyLit()){return vec3f(0.0);}
 return skyRadiance(d);
}
fn skyIrradiance(N:vec3f)->vec3f{
 return max(${irradianceShader((k) => `directLights.sky[${SKY_SLOT.irradiance + k}].rgb`, 'N')},vec3f(0.0));
}`,
)
