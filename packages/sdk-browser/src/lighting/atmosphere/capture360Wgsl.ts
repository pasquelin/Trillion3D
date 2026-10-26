import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { greyMean } from '../../../../math/src/wgsl/color.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import {
  AIR_TO_SCENE,
  HAZE_CELL_WGSL,
  HAZE_FROXEL_WGSL,
  SCENE_TO_PLANET,
  VOLUME_STORE_WGSL,
} from './hazeWgsl.ts'
import { VIEW_SLOT } from './layout.ts'
import { airProgram } from './programs.ts'
import type { AirShape } from './shape.ts'

/**
 * THE HAZE ALL AROUND A CAPTURE: the same volume as the view's (`hazeWgsl.ts`), built for the place
 * the sky is captured from instead of the eye, and over the whole sphere of directions instead of
 * the screen — the clouds the capture draws are seen through it. A cell holds, for the direction
 * its texel stands for (a longitude and the sine of the latitude, evenly spread) and the distance of
 * its slice, the light the air scatters toward the place and the transmittance. It lies in the
 * third region of the clouds' volumes (`volumes`, `separatedWgsl.ts`).
 *
 * What the opaque scene's shadows leave of the air's lights is not sampled (the capture is a view
 * of the sky, not of the ground), but the clouds' are: the march reads the shade they cast on the
 * air's lights and the sky occlusion that dims the first light's multiple scattering, from the maps
 * of the image (`cloudShadowRead.ts`), as the haze of the view does.
 */
export const CAPTURE_360_WGSL = wgslBlock(
  'CAPTURE_360_WGSL',
  [PI],
  `
/** The direction, in the scene's axes, of the texel at the unit coordinates \`unit\` of the 360
 *  volume: the longitude evenly spread, the latitude's sine evenly spread. */
fn capture360Direction(unit:vec2f)->vec3f{
 let sinPhi=2.0*unit.y-1.0;
 let cosPhi=sqrt(max(0.0,1.0-sinPhi*sinPhi));
 let theta=2.0*PI*unit.x;
 let cosTheta=cos(theta);
 let sinTheta=sqrt(max(0.0,1.0-cosTheta*cosTheta))*select(1.0,-1.0,theta>PI);
 return normalize(vec3f(cosTheta*cosPhi,sinPhi,sinTheta*cosPhi));
}
/** The unit coordinates of the texel a direction falls in: the inverse of \`capture360Direction\`. */
fn capture360Unit(dir:vec3f)->vec2f{
 var theta=atan2(dir.z,dir.x);
 if(theta<0.0){theta+=2.0*PI;}
 return vec2f(theta/(2.0*PI),dir.y*0.5+0.5);
}`,
)

/** The capture's builder, one thread a cell, a group of four across. */
export const capture360Program = (shape: AirShape) =>
  airProgram(
    {
      air: 'read_write',
      transmittance: true,
      multiScatter: true,
      frame: true,
      cloudShadow: true,
      volumes: true,
    },
    `${AIR_TO_SCENE}${SCENE_TO_PLANET}
@compute @workgroup_size(4,4,4)
fn capture360Main(@builtin(global_invocation_id) id:vec3u){
 if(id.x==0u&&id.y==0u&&id.z==0u){directLights.atmosphereView[${VIEW_SLOT.flags}].z=1.0;}
 if(id.x>=AERIAL_WIDTH||id.y>=AERIAL_WIDTH||id.z>=AERIAL_SLICES){return;}
 let size=vec2f(f32(AERIAL_WIDTH));
 let dir=capture360Direction(subToUnit((vec2f(id.xy)+0.5)/size,size));
 let ray=froxelOf(sceneToPlanet(frame.capture.xyz),dir,id.z,atmo(${ATMOSPHERE_SLOT.scatteredFactor}u).w);
 let index=cellIndex(id);
 if(!ray.inside){storeVolume(2u,index,vec4f(0.0,0.0,0.0,1.0));return;}
 var march=newMarch();
 march.samples=max(1.0,(f32(id.z)+1.0)*max(1.0,min(2.0*atmo(${ATMOSPHERE_SLOT.sunIlluminance}u).w,AERIAL_SAMPLES_PER_SLICE)));
 let r=integrateAir(ray.start,ray.dir,false,march,true,airSuns(),atmo(${ATMOSPHERE_SLOT.skyFactor}u).w,ray.reach);
 storeVolume(2u,index,vec4f(r.radiance,greyMean(r.transmittance)));
}`,
    [HAZE_CELL_WGSL, HAZE_FROXEL_WGSL, VOLUME_STORE_WGSL, CAPTURE_360_WGSL, greyMean],
    shape,
  )
