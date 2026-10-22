import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { AERIAL_VOLUME, VIEW_SLOT } from './layout.ts'
import { airProgram } from './programs.ts'

/**
 * THE HAZE: the light the air scatters into the way to a surface, and what it takes out of the
 * surface's own light — for every surface at once, from one small volume built each image.
 *
 * The volume is a grid over the screen and the distance (`AERIAL_VOLUME`): a cell holds, for the
 * ray through its pixel and the distance of its slice, the light the air scatters toward the eye
 * and the transmittance. The slices are spread by their square, so the near air, where a surface's
 * haze changes with its distance fastest, has the most. A cell is a short march of the same air
 * (`integrateAir`); a cell the ray reaches below the horizon or under the ground is read at the
 * ground where the ray meets it, as the sky below the horizon is. A surface reads its cell by its
 * pixel and its distance — trilinearly —, faded in from the haze's start distance.
 */

/** The slice length along the ray, kilometres, where the slices are spread evenly. */
const SLICE_KM = AERIAL_VOLUME.depthKm / AERIAL_VOLUME.slices

/** The builder: one thread a cell, a group of four across. The first thread also writes the
 *  view's block — the view-projection, and whether the volume is valid for the image: an
 *  orthographic view has no haze. */
export const HAZE_PROGRAM = airProgram(
  { air: 'read_write', transmittance: true, multiScatter: true, frame: true },
  `
/** A cell's light and transmittance in the two words it takes: four half floats, the light kept
 *  under what a half float holds. */
fn packCell(radiance:vec3f,transmittance:f32)->vec2u{
 let kept=min(radiance,vec3f(65000.0));
 return vec2u(pack2x16float(kept.xy),pack2x16float(vec2f(kept.z,transmittance)));
}
@compute @workgroup_size(4,4,4)
fn hazeMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x==0u&&id.y==0u&&id.z==0u){
  directLights.atmosphereView[${VIEW_SLOT.projection}]=frame.viewProj[0];
  directLights.atmosphereView[${VIEW_SLOT.projection + 1}]=frame.viewProj[1];
  directLights.atmosphereView[${VIEW_SLOT.projection + 2}]=frame.viewProj[2];
  directLights.atmosphereView[${VIEW_SLOT.projection + 3}]=frame.viewProj[3];
  directLights.atmosphereView[${VIEW_SLOT.haze}].w=frame.eye.w;
 }
 if(frame.eye.w==0.0||id.x>=${AERIAL_VOLUME.width}u||id.y>=${AERIAL_VOLUME.height}u||id.z>=${AERIAL_VOLUME.slices}u){return;}
 let uv=(vec2f(id.xy)+0.5)/vec2f(${AERIAL_VOLUME.width}.0,${AERIAL_VOLUME.height}.0);
 let through=frame.inverseViewProj*vec4f(uv.x*2.0-1.0,1.0-uv.y*2.0,0.5,1.0);
 var dir=normalize(through.xyz/through.w-frame.eye.xyz);
 var eye=frame.camera.xyz;
 let bottom=bottomRadius();
 // The cell's slice, in slices: spread by their square.
 var slice=(f32(id.z)+0.5)/${AERIAL_VOLUME.slices}.0;
 slice=slice*slice*${AERIAL_VOLUME.slices}.0;
 let startKm=atmo(${ATMOSPHERE_SLOT.scatteredFactor}u).w;
 var start=eye+startKm*dir;
 var reach=slice*${SLICE_KM}.0;
 var cell=start+reach*dir;
 let toCell=cell-eye;
 let toCellLength=length(toCell);
 let planetHit=raySphereNearest(eye,toCell/toCellLength,vec3f(0.0),bottom);
 let behind=planetHit>0.0&&toCellLength>planetHit;
 let underGround=length(cell)<bottom;
 if(behind||underGround){
  // Past the horizon or under the ground the cell is the ground's, seen from the eye.
  eye+=normalize(eye)*0.02;
  let cellUp=normalize(cell);
  let eyeOnGround=normalize(eye)*bottom;
  let cellOnGround=cellUp*bottom;
  if(behind&&dot(normalize(eye-cellOnGround),cellUp)<0.0001){
   // Behind the planet and facing away from it: the point on the other side of the horizon.
   cell=eye+2.0*(normalize(0.5*(eyeOnGround+cellOnGround))*bottom-eye);
  }else if(underGround){
   cell=cellUp*bottom;
  }
  dir=normalize(cell-eye);
  start=eye+startKm*dir;
  reach=length(cell-start);
 }
 var marched=reach;
 if(length(start)>=topRadius()){
  let before=start;
  let top=moveToTopAtmosphere(start,dir);
  if(top.w==0.0){directLights.aerial[(id.z*${AERIAL_VOLUME.height}u+id.y)*${AERIAL_VOLUME.width}u+id.x]=packCell(vec3f(0.0),1.0);return;}
  start=top.xyz;
  let entered=length(before-start);
  if(reach<entered){directLights.aerial[(id.z*${AERIAL_VOLUME.height}u+id.y)*${AERIAL_VOLUME.width}u+id.x]=packCell(vec3f(0.0),1.0);return;}
  marched=max(0.0,reach-entered);
 }
 var march:Marching;
 march.samples=max(1.0,(f32(id.z)+1.0)*max(1.0,min(2.0*atmo(${ATMOSPHERE_SLOT.sunIlluminance}u).w,${AERIAL_VOLUME.samplesPerSlice}.0)));
 let illuminance=atmo(${ATMOSPHERE_SLOT.sunIlluminance}u).xyz*atmo(${ATMOSPHERE_SLOT.scatteredFactor}u).xyz;
 let r=integrateAir(start,dir,false,march,true,sunDirection(),illuminance,atmo(${ATMOSPHERE_SLOT.skyFactor}u).w,marched);
 directLights.aerial[(id.z*${AERIAL_VOLUME.height}u+id.y)*${AERIAL_VOLUME.width}u+id.x]=packCell(r.radiance,dot(r.transmittance,vec3f(1.0/3.0)));
}`,
)
