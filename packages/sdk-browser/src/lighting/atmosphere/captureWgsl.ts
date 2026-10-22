import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { radianceProjectionShader } from '../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { DISTANT_SKY, SKY_CAPTURE, SKY_VIEW_LUT, VIEW_SLOT } from './layout.ts'
import { airProgram } from './programs.ts'

/**
 * THE SKY, SUMMED OVER ITS DIRECTIONS: two small programs, one group each, run when the air or the
 * sun changes — never per image.
 *
 * - The sky's mean radiance at a height of kilometres in the air: the fog takes it on as its own
 *   colour, scaled by the atmosphere's `heightFogContribution`, as a haze takes the sky's light.
 *   It is written into the view's block of the light buffer.
 * - The sky as a light: the radiance of the upper sky, a thousand directions over the hemisphere,
 *   projected on the nine harmonics the environment's light is made of (`irradianceBasis.ts`),
 *   written to a buffer the CPU reads back a few frames later, the sky lights add it to the
 *   scene's irradiance. The sun's disk is no part of it — the sun is a light of its own —, and the
 *   lower half is left to the light's own ground colour.
 * Both march the air as the sky does, from the planet's top, and the same directions the same way,
 * so a sky light and the sky agree.
 */

/** The statements that set a march of the sky's rays seen from `altitudeKm` above the ground: the
 *  sun's illuminance through the air (`illuminance`), the ray's `start` and its `march`, the sky
 *  table's own — so a capture, a table by direction and the sky drawn agree —, and the expression
 *  of one ray's radiance along `dir`, the sun's disk not in it (it is a light of its own). */
export const groundSkyMarch = (altitudeKm: number) => `
 let illuminance=atmo(${ATMOSPHERE_SLOT.sunIlluminance}u).xyz*atmo(${ATMOSPHERE_SLOT.scatteredFactor}u).xyz;
 let start=vec3f(0.0,bottomRadius()+${altitudeKm},0.0);
 var march:Marching;
 march.variable=true;
 march.minSamples=${SKY_VIEW_LUT.minSamples}.0;
 march.maxSamples=max(min(32.0*atmo(${ATMOSPHERE_SLOT.sunIlluminance}u).w,${SKY_VIEW_LUT.maxSamples}.0),march.minSamples);
 march.distanceInv=1.0/${SKY_VIEW_LUT.distanceKm}.0;`
export const GROUND_SKY_RADIANCE = `integrateAir(start,dir,false,march,true,sunDirection(),illuminance,1.0,9000000.0).radiance*atmo(${ATMOSPHERE_SLOT.skyFactor}u).xyz`

/** The `n`th of `count` directions spread evenly over the sphere, up the scene's y. */
const SPHERE_DIRECTION = (n: string, count: number) => `
 let y=1.0-2.0*(${n}+0.5)/${count}.0;
 let ring=sqrt(max(0.0,1.0-y*y));
 let phi=${n}*2.39996323;
 let dir=vec3f(ring*cos(phi),y,ring*sin(phi));`

/** The statements that sum a workgroup's `part` array into its first element, halving the stride. */
const SUM_WORKGROUP = (threads: number) => `
 for(var stride=${threads / 2}u;stride>0u;stride=stride>>1u){
  if(li<stride){part[li]+=part[li+stride];}
  workgroupBarrier();
 }`

const DISTANT_SKY_PROGRAM = airProgram(
  { air: 'read_write', transmittance: true, multiScatter: true },
  `
var<workgroup> part:array<vec3f,${DISTANT_SKY.directions}>;
@compute @workgroup_size(8,8,1)
fn distantSkyMain(@builtin(local_invocation_index) li:u32){
 let n=f32(li);${SPHERE_DIRECTION('n', DISTANT_SKY.directions)}
 var march:Marching;
 march.samples=${DISTANT_SKY.samples}.0;
 let illuminance=atmo(${ATMOSPHERE_SLOT.sunIlluminance}u).xyz*atmo(${ATMOSPHERE_SLOT.scatteredFactor}u).xyz;
 let start=vec3f(0.0,bottomRadius()+${DISTANT_SKY.altitudeKm}.0,0.0);
 let r=integrateAir(start,dir,false,march,false,sunDirection(),illuminance,1.0,9000000.0);
 part[li]=r.radiance*atmo(${ATMOSPHERE_SLOT.skyFactor}u).xyz;
 workgroupBarrier();${SUM_WORKGROUP(DISTANT_SKY.directions)}
 if(li==0u){
  let mean=part[0]/${DISTANT_SKY.directions}.0;
  directLights.atmosphereView[${VIEW_SLOT.haze}].x=mean.x;
  directLights.atmosphereView[${VIEW_SLOT.haze}].y=mean.y;
  directLights.atmosphereView[${VIEW_SLOT.haze}].z=mean.z;
 }
}`,
)

/** The coefficient floats the capture writes: nine harmonics, three channels, padded to 32. */
export const CAPTURE_FLOATS = 32

const SKY_CAPTURE_PROGRAM = airProgram(
  { air: 'read', transmittance: true, multiScatter: true, capture: true },
  `
var<workgroup> part:array<f32,${SKY_CAPTURE.threads}>;
@compute @workgroup_size(${SKY_CAPTURE.threads})
fn skyCaptureMain(@builtin(local_invocation_index) li:u32){
 var acc:array<vec3f,9>;
 let each=${SKY_CAPTURE.directions / SKY_CAPTURE.threads}u;${groundSkyMarch(SKY_CAPTURE.altitudeKm)}
 for(var j=0u;j<each;j++){
  // The directions of the upper hemisphere, each one's share of it the same: height evenly spread.
  let n=f32(li*each+j);
  let y=(n+0.5)/${SKY_CAPTURE.directions}.0;
  let ring=sqrt(max(0.0,1.0-y*y));
  let phi=n*2.39996323;
  let dir=vec3f(ring*cos(phi),y,ring*sin(phi));
  let radiance=${GROUND_SKY_RADIANCE};
  ${radianceProjectionShader((k) => `acc[${k}]`, 'radiance', 'dir')}
 }
 let weight=2.0*PI/${SKY_CAPTURE.directions}.0;
 for(var q=0u;q<27u;q++){
  part[li]=acc[q/3u][q%3u];
  workgroupBarrier();${SUM_WORKGROUP(SKY_CAPTURE.threads)}
  if(li==0u){capture[q]=part[0]*weight;}
 }
}`,
)

/** The two sums' programs, by what they sum. */
export const CAPTURE_PROGRAMS = {
  distantSky: DISTANT_SKY_PROGRAM,
  skyCapture: SKY_CAPTURE_PROGRAM,
}
