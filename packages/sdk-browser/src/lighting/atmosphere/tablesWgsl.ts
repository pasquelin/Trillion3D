import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { MULTISCATTERING_LUT, SKY_VIEW_LUT, TRANSMITTANCE_LUT } from './layout.ts'
import { airProgram } from './programs.ts'

/**
 * THE THREE TABLES THE SKY IS DRAWN FROM, one program each, a thread to a texel.
 *
 * - The transmittance table: for a point at a height and a direction up from the horizon at it, what
 *   the air keeps of a ray to the top of the air. The sun's light at any point, and every step of
 *   the march, read it instead of marching toward the sun. It depends on the air alone.
 * - The multiple-scattering table: for a sun elevation and a height, the light the air scatters
 *   more than once, per unit of the sun's illuminance, from the single scattering of a ray up and a
 *   ray down and the geometric series of the further orders it implies. It depends on the air alone.
 * - The sky table: the sky seen from the eye, in a frame whose up is the planet's at the eye, the
 *   zenith angle spread to dwell near the horizon, where the sky changes fastest. It depends on the
 *   eye's height, its turn and the sun, so it is built every image, small.
 */

/** Tables of the air alone: built when the air changes. */
export const TRANSMITTANCE_PROGRAM = airProgram(
  { air: 'read', table: true },
  `
@compute @workgroup_size(8,8,1)
fn transmittanceMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=${TRANSMITTANCE_LUT.width}u||id.y>=${TRANSMITTANCE_LUT.height}u){return;}
 let uv=(vec2f(id.xy)+0.5)/vec2f(${TRANSMITTANCE_LUT.width}.0,${TRANSMITTANCE_LUT.height}.0);
 let here=transmittanceParams(uv);
 let start=vec3f(0.0,0.0,here.x);
 let dir=vec3f(0.0,sqrt(max(0.0,1.0-here.y*here.y)),here.y);
 // The table's rays all leave the horizon upward: the far end of the one through the air's top.
 let reach=raySphere(start,dir,topRadius()).y;
 let samples=${TRANSMITTANCE_LUT.samples}.0;
 var depth=vec3f(0.0);
 for(var i:f32=0.0;i<samples;i+=1.0){
  depth+=mediumAt(start+reach*(i+SAMPLE_OFFSET)/samples*dir).extinction*(reach/samples);
 }
 textureStore(table,id.xy,vec4f(exp(-depth),1.0));
}`,
)

export const MULTISCATTER_PROGRAM = airProgram(
  { air: 'read', table: true, transmittance: true },
  `
@compute @workgroup_size(8,8,1)
fn multiScatterMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=${MULTISCATTERING_LUT.width}u||id.y>=${MULTISCATTERING_LUT.height}u){return;}
 let texel=vec2f(id.xy)+0.5;
 let size=vec2f(${MULTISCATTERING_LUT.width}.0,${MULTISCATTERING_LUT.height}.0);
 let cosSun=texel.x/size.x*2.0-1.0;
 let toSun=vec3f(0.0,sqrt(saturate(1.0-cosSun*cosSun)),cosSun);
 let height=bottomRadius()+texel.y/size.y*(topRadius()-bottomRadius());
 let start=vec3f(0.0,0.0,height);
 var march:Marching;
 march.samples=${MULTISCATTERING_LUT.samples}.0;
 // A unit white sun: the table is a transfer, independent of the light.
 let sun=singleSun(toSun,vec3f(1.0));
 let up=integrateAir(start,vec3f(0.0,0.0,1.0),true,march,false,sun,1.0,9000000.0);
 let down=integrateAir(start,vec3f(0.0,0.0,-1.0),true,march,false,sun,1.0,9000000.0);
 // The two rays stand for the sphere: the illuminance they bring, then the radiance an isotropic
 // phase scatters it into, and the orders after the first as a geometric series.
 let sphere=4.0*PI;
 let inScattered=(sphere*0.5)*(up.radiance+down.radiance)/sphere;
 let multiAs1=0.5*(up.multiAs1+down.multiAs1);
 let square=multiAs1*multiAs1;
 let total=inScattered*(1.0+multiAs1+square+multiAs1*square+square*square);
 textureStore(table,id.xy,vec4f(total*atmo(${ATMOSPHERE_SLOT.ground}u).w,1.0));
}`,
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

export const SKY_VIEW_PROGRAM = airProgram(
  { air: 'read', table: true, transmittance: true, multiScatter: true, frame: true },
  `${SKY_VIEW_COORDINATES}
@compute @workgroup_size(8,8,1)
fn skyViewMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=${SKY_VIEW_LUT.width}u||id.y>=${SKY_VIEW_LUT.height}u){return;}
 let uv=(vec2f(id.xy)+0.5)/SKY_VIEW_SIZE;
 let height=frame.camera.w;
 let dir=skyViewDirection(height,uv);
 var suns=airSuns();
 for(var k=0u;k<suns.count;k++){suns.list[k].toward=eyeToTable(suns.list[k].toward);}
 let top=moveToTopAtmosphere(vec3f(0.0,0.0,height),dir);
 if(top.w==0.0){textureStore(table,id.xy,vec4f(0.0));return;}
 var march:Marching;
 march.variable=true;
 march.minSamples=${SKY_VIEW_LUT.minSamples}.0;
 march.maxSamples=max(min(32.0*atmo(${ATMOSPHERE_SLOT.sunIlluminance}u).w,${SKY_VIEW_LUT.maxSamples}.0),march.minSamples);
 march.distanceInv=1.0/${SKY_VIEW_LUT.distanceKm}.0;
 let r=integrateAir(top.xyz,dir,false,march,true,suns,1.0,9000000.0);
 textureStore(table,id.xy,vec4f(r.radiance,dot(r.transmittance,vec3f(1.0/3.0))));
}`,
)
