import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { DISTANT_SKY, VIEW_SLOT } from './layout.ts'
import { airProgram } from './programs.ts'
import type { AirShape } from './shape.ts'
import { SPHERE_DIRECTIONS_WGSL } from './sphereSamples.ts'

/**
 * THE SKY, SUMMED OVER ITS DIRECTIONS, and the march every sky draw shares.
 *
 * The sky's mean radiance at a height of kilometres in the air (`distantSkyLightAltitudeKm`), over
 * the 64 directions of `sphereSamples.ts`, every image: the fog takes it on as its own colour,
 * scaled by the atmosphere's `heightFogContribution`, as a haze takes the sky's light; black at
 * `distantSkyLightTable` off. It is written into the view's block of the light buffer. The sky light
 * is no sum of it: the light's cube is drawn and filtered by its own capture (`modules/sky/skyLight`),
 * which marches the air as the sky does (`groundSkyMarch`), so a sky light and the sky agree.
 */

/** The statements that set a march of the sky's rays seen from `altitudeKm` above the ground — a
 *  number, or a WGSL expression of kilometres (the capture's `frame.capture.w`) —: the air's lights
 *  (`suns`), the ray's `start` and its `march`, the sky table's own — so a capture, a table by
 *  direction and the sky drawn agree —, and the expression of one ray's radiance along `dir`, the
 *  disks of the lights not in it (they are lights of their own). */
export const groundSkyMarch = (altitudeKm: number | string) => `
 let suns=airSuns();
 let start=vec3f(0.0,bottomRadius()+${altitudeKm},0.0);
 var march=newMarch();
 march.variable=true;
 march.minSamples=SKY_VIEW_SAMPLES_MIN;
 march.maxSamples=samplesMaxOf(SKY_VIEW_SAMPLES_MAX,SKY_VIEW_SAMPLES_MIN);
 march.distanceInv=1.0/SKY_VIEW_DISTANCE_KM;`
export const GROUND_SKY_RADIANCE = `integrateAir(start,dir,false,march,true,suns,1.0,9000000.0).radiance*atmo(${ATMOSPHERE_SLOT.skyFactor}u).xyz`

/** The statements that sum a workgroup's `part` array into its first element, halving the stride. */
const SUM_WORKGROUP = (threads: number) => `
 for(var stride=${threads / 2}u;stride>0u;stride=stride>>1u){
  if(li<stride){part[li]+=part[li+stride];}
  workgroupBarrier();
 }`

const distantSkyProgram = (shape: AirShape) =>
  airProgram(
    { air: 'read_write', transmittance: true, multiScatter: true },
    `
var<workgroup> part:array<vec3f,${DISTANT_SKY.directions}>;
@compute @workgroup_size(8,8,1)
fn distantSkyMain(@builtin(local_invocation_index) li:u32){
 // The sphere's directions, z up, are the scene's with y for z.
 let d=SPHERE_DIRECTION[li];
 let dir=vec3f(d.x,d.z,d.y);
 var march=newMarch();
 march.samples=${DISTANT_SKY.samples}.0;
 let suns=airSuns();
 let start=vec3f(0.0,bottomRadius()+DISTANT_SKY_ALTITUDE_KM,0.0);
 let r=integrateAir(start,dir,false,march,false,suns,1.0,9000000.0);
 part[li]=r.radiance*atmo(${ATMOSPHERE_SLOT.skyFactor}u).xyz;
 workgroupBarrier();${SUM_WORKGROUP(DISTANT_SKY.directions)}
 if(li==0u){
  // No table: the fog's sky is black.
  let mean=select(vec3f(0.0),part[0]/${DISTANT_SKY.directions}.0,DISTANT_SKY_ON);
  directLights.atmosphereView[${VIEW_SLOT.haze}].x=mean.x;
  directLights.atmosphereView[${VIEW_SLOT.haze}].y=mean.y;
  directLights.atmosphereView[${VIEW_SLOT.haze}].z=mean.z;
 }
}`,
    [SPHERE_DIRECTIONS_WGSL],
    shape,
  )

/** The sum's program. */
export const captureProgramsOf = (shape: AirShape) => ({
  distantSky: distantSkyProgram(shape),
})
