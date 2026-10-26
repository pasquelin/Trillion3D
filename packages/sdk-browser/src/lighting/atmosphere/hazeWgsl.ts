import { HALF_MAX } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { AIR_RAY_WGSL } from './airRayWgsl.ts'
import { EYE_FLOOR, VIEW_SLOT } from './layout.ts'
import { airProgram } from './programs.ts'
import type { AirShape } from './shape.ts'

/**
 * THE HAZE: the light the air scatters into the way to a surface, and what it takes out of the
 * surface's own light — for every surface at once, from one small volume built each image.
 *
 * The volume is a grid over the screen and the distance (`AirShape.aerial`): a cell holds, for the
 * ray through its pixel and the distance of its slice, the light the air scatters toward the eye
 * and the transmittance. The slices are spread by their square, so the near air, where a surface's
 * haze changes with its distance fastest, has the most. A cell is a short march of the same air
 * (`integrateAir`); a cell the ray reaches below the horizon or under the ground is read at the
 * ground where the ray meets it, as the sky below the horizon is. A surface reads its cell by its
 * pixel and its distance — trilinearly —, faded in from the haze's start distance.
 *
 * Where the clouds ask for the haze's light and the air's apart, the same march keeps them apart
 * too, into two volumes of their own (`separate`, `separatedWgsl.ts`).
 */

/** The cells of the volume as a program writes them. A cell is four numbers, the light and the
 *  transmittance: four half floats in a pair of words (the light kept under what a half float
 *  holds), or four 32-bit floats in two pairs. The cells of the light buffer's region follow one
 *  another; those of the clouds' volumes (`volumes`) lie in three regions of the volume's cells,
 *  one after the other. */
export const HAZE_CELL_WGSL = wgslBlock(
  'HAZE_CELL_WGSL',
  [HALF_MAX],
  `
fn cellIndex(c:vec3u)->u32{return (c.z*AERIAL_WIDTH+c.y)*AERIAL_WIDTH+c.x;}
fn cellStride()->u32{return select(1u,2u,AERIAL_FULL);}
fn cellWords(v:vec4f)->array<vec2u,2>{
 if(AERIAL_FULL){return array<vec2u,2>(vec2u(bitcast<u32>(v.x),bitcast<u32>(v.y)),vec2u(bitcast<u32>(v.z),bitcast<u32>(v.w)));}
 let kept=min(v.xyz,vec3f(HALF_MAX));
 return array<vec2u,2>(vec2u(pack2x16float(kept.xy),pack2x16float(vec2f(kept.z,v.w))),vec2u(0u));
}
/** Writes the cell \`index\` of the light buffer's volume. */
fn storeCell(index:u32,v:vec4f){
 let words=cellWords(v);
 directLights.aerial[index*cellStride()]=words[0];
 if(AERIAL_FULL){directLights.aerial[index*cellStride()+1u]=words[1];}
}`,
)

/** What the volumes of the clouds are written with (`volumes`): the haze's light alone (region 0),
 *  the air's alone (1) and the volume around a capture (2), each of the volume's cells. */
export const VOLUME_STORE_WGSL = wgslBlock(
  'VOLUME_STORE_WGSL',
  [HAZE_CELL_WGSL],
  `
fn storeVolume(region:u32,index:u32,v:vec4f){
 let words=cellWords(v);
 let at=(region*AERIAL_CELLS+index)*cellStride();
 volumes[at]=words[0];
 if(AERIAL_FULL){volumes[at+1u]=words[1];}
}`,
)

/** The scene's metres of a point of the planet's frame (up its y): the planet's ground is the
 *  scene's plane, its top at the block's place on it. */
export const PLANET_TO_SCENE = `
fn planetToScene(p:vec3f)->vec3f{
 let place=atmo(${ATMOSPHERE_SLOT.planetPlace}u);
 return vec3f(p.x*1000.0+place.x,(p.y-bottomRadius())*1000.0+atmo(${ATMOSPHERE_SLOT.planet}u).w,p.z*1000.0+place.y);
}`

/** `airToScene` of a march in the planet's frame: the scene's metres of its point. */
export const AIR_TO_SCENE = `${PLANET_TO_SCENE}
fn airToScene(p:vec3f)->vec3f{return planetToScene(p);}`

/** The place in the planet's frame of the scene's point `scene` (metres), held as the eye is: no
 *  lower than just over the ground, where it stands above (the inverse of `planetToScene` there). */
export const SCENE_TO_PLANET = `
fn sceneToPlanet(scene:vec3f)->vec3f{
 let place=atmo(${ATMOSPHERE_SLOT.planetPlace}u);
 let p=vec3f((scene.x-place.x)/1000.0,(scene.y-atmo(${ATMOSPHERE_SLOT.planet}u).w)/1000.0+bottomRadius(),(scene.z-place.y)/1000.0);
 let length_=max(length(p),1e-6);
 return p/length_*max(length_,bottomRadius()+${EYE_FLOOR});
}`

/** Where the ray of a cell of the volume starts, along which direction and how far it is marched:
 *  the ray from `eyeIn` along `dirIn` to the cell of slice `z` (the slices spread by their
 *  square), past `startKm`. A cell the ray reaches below the horizon or under the ground is
 *  the ground's, seen from the eye; a ray that begins above the air starts at its top, and a cell
 *  before the air is not `inside` it. */
export const HAZE_FROXEL_WGSL = wgslBlock(
  'HAZE_FROXEL_WGSL',
  [],
  `
struct Froxel{start:vec3f,dir:vec3f,reach:f32,inside:bool,}
fn froxelOf(eyeIn:vec3f,dirIn:vec3f,z:u32,startKm:f32)->Froxel{
 var eye=eyeIn;
 var dir=dirIn;
 let bottom=bottomRadius();
 // The cell's slice, in slices: spread by their square.
 var slice=(f32(z)+0.5)/f32(AERIAL_SLICES);
 slice=slice*slice*f32(AERIAL_SLICES);
 var start=eye+startKm*dir;
 var reach=slice*AERIAL_SLICE_KM;
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
 var f:Froxel;
 f.dir=dir;
 f.inside=true;
 f.start=start;
 f.reach=reach;
 if(length(start)>=topRadius()){
  let top=moveToTopAtmosphere(start,dir);
  let entered=length(start-top.xyz);
  if(top.w==0.0||reach<entered){f.inside=false;return f;}
  f.start=top.xyz;
  f.reach=max(0.0,reach-entered);
 }
 return f;
}`,
)

/** What the first thread of the builder writes of the view's block (`writeHazeView`): the
 *  view-projection, the volume's kind (1 for a perspective view, 2 for an orthographic one: a
 *  surface's distance is then its distance along the view's direction from the near plane, the
 *  direction and the plane's offset written beside it; 0 for a view the air is not drawn in, which
 *  no surface is hazed by), its size and its way of being read. */
const HAZE_VIEW_WGSL = wgslBlock(
  'HAZE_VIEW_WGSL',
  [AIR_RAY_WGSL],
  `
fn writeHazeView(){
 directLights.atmosphereView[${VIEW_SLOT.projection}]=frame.viewProj[0];
 directLights.atmosphereView[${VIEW_SLOT.projection + 1}]=frame.viewProj[1];
 directLights.atmosphereView[${VIEW_SLOT.projection + 2}]=frame.viewProj[2];
 directLights.atmosphereView[${VIEW_SLOT.projection + 3}]=frame.viewProj[3];
 let ortho=frame.eye.w==0.0;
 directLights.atmosphereView[${VIEW_SLOT.haze}].w=select(select(1.0,2.0,ortho),0.0,frame.hidden.x!=0.0);
 directLights.atmosphereView[${VIEW_SLOT.volume}]=vec4f(f32(AERIAL_WIDTH),f32(AERIAL_WIDTH),f32(AERIAL_SLICES),AERIAL_DEPTH_KM);
 directLights.atmosphereView[${VIEW_SLOT.flags}]=vec4f(select(0.0,1.0,AERIAL_FULL),select(0.0,1.0,AERIAL_DEPTH_TEST),0.0,select(1.0,0.0,AERIAL_FAST_OPAQUE));
 var look=vec4f(0.0);
 if(ortho){
  let near=airUnproject(vec2f(0.0),1.0);
  let dir=normalize(airUnproject(vec2f(0.0),0.5)-near);
  look=vec4f(dir,dot(near,dir));
 }
 directLights.atmosphereView[${VIEW_SLOT.ortho}]=look;
}`,
)

/** The volume's builder, one thread a cell, a group of four across: the cell's ray is the pixel's
 *  (`airRay`), the eye's or, in an orthographic view, the pixel's own. The first thread also writes
 *  the view's block (`HAZE_VIEW_WGSL`); in a view the air is not drawn in, it writes that block
 *  alone. `separate`: the haze's light and the air's also go into their own volumes. */
export const hazeProgram = (shape: AirShape, separate: boolean) => {
  const clear = 'vec4f(0.0,0.0,0.0,1.0)'
  return airProgram(
    {
      air: 'read_write',
      transmittance: true,
      multiScatter: true,
      frame: true,
      shadow: shape.shadows,
      cloudShadow: true,
      volumes: separate,
      hazeVolume: true,
    },
    `${AIR_TO_SCENE}
/** Writes a cell to the light buffer's volume and to the 3D texture the fog pass samples. */
fn storeHaze(id:vec3u,index:u32,v:vec4f){
 storeCell(index,v);
 textureStore(hazeVolume,id,vec4f(min(v.xyz,vec3f(HALF_MAX)),v.w));
}
@compute @workgroup_size(4,4,4)
fn hazeMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x==0u&&id.y==0u&&id.z==0u){writeHazeView();}
 if(frame.hidden.x!=0.0||id.x>=AERIAL_WIDTH||id.y>=AERIAL_WIDTH||id.z>=AERIAL_SLICES){return;}
 let index=cellIndex(id);
 let uv=(vec2f(id.xy)+0.5)/f32(AERIAL_WIDTH);
 let seen=airRay(vec2f(uv.x*2.0-1.0,1.0-uv.y*2.0));
 let ray=froxelOf(seen.origin,seen.dir,id.z,atmo(${ATMOSPHERE_SLOT.scatteredFactor}u).w);
 if(!ray.inside){
  storeHaze(id,index,${clear});${
    separate
      ? `
  storeVolume(0u,index,${clear});
  storeVolume(1u,index,${clear});`
      : ''
  }
  return;
 }
 var march=newMarch();
 march.separate=${separate};
 march.samples=max(1.0,(f32(id.z)+1.0)*max(1.0,min(2.0*atmo(${ATMOSPHERE_SLOT.sunIlluminance}u).w,AERIAL_SAMPLES_PER_SLICE)));
 let r=integrateAir(ray.start,ray.dir,false,march,true,airSuns(),atmo(${ATMOSPHERE_SLOT.skyFactor}u).w,ray.reach);
 let grey=vec3f(1.0/3.0);
 // The atmosphere that holds its light out (\`frame.hidden.y\`) adds none to what its haze lies over.
 let held=select(1.0,0.0,frame.hidden.y!=0.0);
 storeHaze(id,index,vec4f(r.radiance*held,dot(r.transmittance,grey)));${
   separate
     ? `
 storeVolume(0u,index,vec4f(r.radianceMie*held,dot(r.transmittanceMie,grey)));
 storeVolume(1u,index,vec4f(r.radianceRay*held,dot(r.transmittanceRay,grey)));`
     : ''
 }
}`,
    [HAZE_CELL_WGSL, HAZE_FROXEL_WGSL, HAZE_VIEW_WGSL, ...(separate ? [VOLUME_STORE_WGSL] : [])],
    shape,
  )
}
