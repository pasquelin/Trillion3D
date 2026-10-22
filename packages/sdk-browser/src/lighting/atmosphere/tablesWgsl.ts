import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { airProgram } from './programs.ts'
import { SPHERE_DIRECTIONS_WGSL } from './sphereSamples.ts'
import type { AirShape } from './shape.ts'

/** The directions the high-quality multiple scattering sums: the first of the buffer's, as many as a
 *  group of the reference's pass has threads. */
const MULTI_SCATTER_DIRECTIONS = 8

/**
 * THE THREE TABLES THE SKY IS DRAWN FROM, one program each, a thread to a texel.
 *
 * - The transmittance table: for a point at a height and a direction up from the horizon at it, what
 *   the air keeps of a ray to the top of the air, stored as its square root (which keeps its low
 *   values in eight bits; a reader squares it). The sun's light at any point, and every step of
 *   the march, read it instead of marching toward the sun. It depends on the air alone.
 * - The multiple-scattering table: for a sun elevation and a height, the light the air scatters
 *   more than once, per unit of the sun's illuminance, from the single scattering of a ray up and a
 *   ray down — or, in its high-quality form, from the first 8 of the 64 directions over the sphere — and the
 *   geometric series of the further orders it implies. It depends on the air alone.
 * - The sky table: the sky seen from the eye, in a frame whose up is the planet's at the eye, the
 *   zenith angle spread to dwell near the horizon, where the sky changes fastest. It depends on the
 *   eye's height, its turn and the sun, so it is built every image, small.
 */

/** The transmittance table's builder: one thread a texel. Built when the air changes. */
export const transmittanceProgram = (shape: AirShape) =>
  airProgram(
    { air: 'read', table: 'transmittance' },
    `
@compute @workgroup_size(8,8,1)
fn transmittanceMain(@builtin(global_invocation_id) id:vec3u){
 if(f32(id.x)>=TRANSMITTANCE_SIZE.x||f32(id.y)>=TRANSMITTANCE_SIZE.y){return;}
 let uv=(vec2f(id.xy)+0.5)/TRANSMITTANCE_SIZE;
 let here=transmittanceParams(uv);
 let start=vec3f(0.0,0.0,here.x);
 let dir=vec3f(0.0,sqrt(max(0.0,1.0-here.y*here.y)),here.y);
 // The table's rays all leave the horizon upward: the far end of the one through the air's top.
 let reach=raySphere(start,dir,topRadius()).y;
 let samples=TRANSMITTANCE_SAMPLES;
 var depth=vec3f(0.0);
 for(var i:f32=0.0;i<samples;i+=1.0){
  depth+=mediumAt(start+reach*(i+SAMPLE_OFFSET)/samples*dir).extinction*(reach/samples);
 }
 textureStore(table,id.xy,vec4f(sqrt(exp(-depth)),1.0));
}`,
    [],
    shape,
  )

/** The multiple-scattering table's builder: one thread a texel. Built when the air changes. */
export const multiScatterProgram = (shape: AirShape) =>
  airProgram(
    { air: 'read', table: true, transmittance: true },
    `
/** The light a unit white sun scatters into the rays from \`start\`, summed over the sphere, and the
 *  scattering the air would give a unit radiance filling it: from two rays, up and down, or, in
 *  the high-quality form, from the sphere's directions. */
fn sphereScatter(start:vec3f,toSun:vec3f)->array<vec3f,2>{
 var march=newMarch();
 march.samples=MULTI_SCATTER_SAMPLES;
 // A unit white sun: the table is a transfer, independent of the light.
 let sun=singleSun(toSun,vec3f(1.0));
 let sphere=4.0*PI;
 if(MULTI_SCATTER_HIGH){
  var illuminance=vec3f(0.0);
  var multiAs1=vec3f(0.0);
  for(var s=0u;s<${MULTI_SCATTER_DIRECTIONS}u;s++){
   let r=integrateAir(start,SPHERE_DIRECTION[s],true,march,false,sun,1.0,9000000.0);
   illuminance+=r.radiance;
   multiAs1+=r.multiAs1;
  }
  return array<vec3f,2>(illuminance*(sphere/${MULTI_SCATTER_DIRECTIONS}.0),multiAs1/${MULTI_SCATTER_DIRECTIONS}.0);
 }
 let up=integrateAir(start,vec3f(0.0,0.0,1.0),true,march,false,sun,1.0,9000000.0);
 let down=integrateAir(start,vec3f(0.0,0.0,-1.0),true,march,false,sun,1.0,9000000.0);
 // The two rays stand for the sphere: the illuminance they bring, half the sphere each.
 return array<vec3f,2>((sphere*0.5)*(up.radiance+down.radiance),0.5*(up.multiAs1+down.multiAs1));
}
@compute @workgroup_size(8,8,1)
fn multiScatterMain(@builtin(global_invocation_id) id:vec3u){
 if(f32(id.x)>=MULTI_SCATTER_SIZE.x||f32(id.y)>=MULTI_SCATTER_SIZE.y){return;}
 let texel=vec2f(id.xy)+0.5;
 let cosSun=texel.x/MULTI_SCATTER_SIZE.x*2.0-1.0;
 let toSun=vec3f(0.0,sqrt(saturate(1.0-cosSun*cosSun)),cosSun);
 let height=bottomRadius()+texel.y/MULTI_SCATTER_SIZE.y*(topRadius()-bottomRadius());
 let summed=sphereScatter(vec3f(0.0,0.0,height),toSun);
 // The radiance an isotropic phase scatters that illuminance into, and the orders after the first
 // as a geometric series.
 let inScattered=summed[0]/(4.0*PI);
 let multiAs1=summed[1];
 let square=multiAs1*multiAs1;
 let total=inScattered*(1.0+multiAs1+square+multiAs1*square+square*square);
 textureStore(table,id.xy,vec4f(total*atmo(${ATMOSPHERE_SLOT.ground}u).w,1.0));
}`,
    [SPHERE_DIRECTIONS_WGSL],
    shape,
  )

/** The sky table's coordinates. A direction in the eye's frame has a zenith angle and a longitude;
 *  the zenith angle is spread over the table's height in two halves — above the horizon, below it,
 *  where the ground is —, each stretched so that the horizon, which moves with the eye's height, has
 *  the most texels. */
export const SKY_VIEW_COORDINATES = `
fn eyeToTable(v:vec3f)->vec3f{return vec3f(dot(frame.forward.xyz,v),dot(frame.left.xyz,v),dot(frame.up.xyz,v));}
fn skyViewDirection(height:f32,uvIn:vec2f)->vec3f{
 let uv=subToUnit(uvIn,SKY_VIEW_SIZE);
 let bottom=bottomRadius();
 let beta=acos(sqrt(max(0.0,height*height-bottom*bottom))/height);
 let horizon=PI-beta;
 var zenith:f32;
 if(uv.y<0.5){
  var c=1.0-2.0*uv.y;
  c=1.0-c*c;
  zenith=horizon*c;
 }else{
  var c=uv.y*2.0-1.0;
  zenith=horizon+beta*c*c;
 }
 let longitude=uv.x*2.0*PI;
 return vec3f(sin(zenith)*cos(longitude),sin(zenith)*sin(longitude),cos(zenith));
}
fn skyViewUv(hitsGround:bool,dirTable:vec3f,height:f32)->vec2f{
 let bottom=bottomRadius();
 let beta=acos(sqrt(max(0.0,height*height-bottom*bottom))/height);
 let horizon=PI-beta;
 let zenith=acos(clamp(dirTable.z,-1.0,1.0));
 var uv:vec2f;
 if(!hitsGround){
  let c=sqrt(max(0.0,1.0-zenith/horizon));
  uv.y=(1.0-c)*0.5;
 }else{
  uv.y=sqrt(max(0.0,(zenith-horizon)/beta))*0.5+0.5;
 }
 uv.x=(atan2(-dirTable.y,-dirTable.x)+PI)/(2.0*PI);
 return unitToSub(uv,SKY_VIEW_SIZE);
}
`

/** The scene's metres of a point of the sky table's frame (up the table's z): the table's axes put
 *  the point back in the planet's, and the planet's ground is the scene's plane. */
const SKY_VIEW_TO_SCENE = `
fn airToScene(p:vec3f)->vec3f{
 let planet=frame.forward.xyz*p.x+frame.left.xyz*p.y+frame.up.xyz*p.z;
 return vec3f(planet.x*1000.0,(planet.y-bottomRadius())*1000.0+atmo(${ATMOSPHERE_SLOT.planet}u).w,planet.z*1000.0);
}`

/** The sky table's builder: one thread a texel, every image. */
export const skyViewProgram = (shape: AirShape) =>
  airProgram(
    {
      air: 'read',
      table: true,
      transmittance: true,
      multiScatter: true,
      frame: true,
      shadow: shape.shadows,
      cloudShadow: true,
    },
    `${SKY_VIEW_COORDINATES}${SKY_VIEW_TO_SCENE}
@compute @workgroup_size(8,8,1)
fn skyViewMain(@builtin(global_invocation_id) id:vec3u){
 if(f32(id.x)>=SKY_VIEW_SIZE.x||f32(id.y)>=SKY_VIEW_SIZE.y){return;}
 let uv=(vec2f(id.xy)+0.5)/SKY_VIEW_SIZE;
 let height=frame.camera.w;
 let dir=skyViewDirection(height,uv);
 var suns=airSuns();
 for(var k=0u;k<suns.count;k++){suns.list[k].toward=eyeToTable(suns.list[k].toward);}
 let top=moveToTopAtmosphere(vec3f(0.0,0.0,height),dir);
 if(top.w==0.0){textureStore(table,id.xy,vec4f(0.0));return;}
 var march=newMarch();
 march.variable=true;
 march.minSamples=SKY_VIEW_SAMPLES_MIN;
 march.maxSamples=samplesMaxOf(SKY_VIEW_SAMPLES_MAX,SKY_VIEW_SAMPLES_MIN);
 march.distanceInv=1.0/SKY_VIEW_DISTANCE_KM;
 let r=integrateAir(top.xyz,dir,false,march,true,suns,1.0,9000000.0);
 textureStore(table,id.xy,vec4f(r.radiance,dot(r.transmittance,vec3f(1.0/3.0))));
}`,
    [],
    shape,
  )
