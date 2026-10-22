import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'

/**
 * THE HAZE ON A CLOUD, MARCHED FOR ITS PIXEL: the light the air scatters into the way from the eye
 * to a cloud at `depthKm` along `dir`, and what it keeps of the cloud's own light — the second pass
 * of the clouds' high-quality haze (`cloudHighQualityAerial`), in place of the volume's cell the
 * trace reads for a cloud. The ray is marched from the eye (moved to the air's top when it stands
 * above it, and past the haze's start) with the march of a sky pixel's samples
 * (`atmosphereSamplesMin`, `atmosphereSamplesMax`, `atmosphereDistanceToMaxSamplesKm`), jittered by
 * `noise`, as far as the cloud, the distance scale of the haze on it (`aerialPerspectiveDistanceScale`)
 * and the sky's luminance factor not applied (it is a surface's haze, not the sky's).
 *
 * `cloudHaze(dir, depthKm, noise)` is the light in `rgb` and the grey transmittance in `a`;
 * `cloudHazeOver(cloud, haze)` lays it over a cloud pixel `cloud` (its light, its transmittance in
 * `a`): the cloud's light kept by the haze's grey transmittance, the haze's light by the cloud's
 * coverage, the cloud's transmittance unchanged. A program that includes the block binds what the
 * air's programs bind (`AirBindings`: the light buffer, the two tables, the sampler and the frame)
 * and gets the shape's constants from `airProgram`.
 */
export const CLOUD_HAZE_WGSL = wgslBlock(
  'CLOUD_HAZE_WGSL',
  [],
  `
fn cloudHaze(dir:vec3f,depthKm:f32,noise:f32)->vec4f{
 let top=moveToTopAtmosphere(frame.camera.xyz,dir);
 if(top.w==0.0){return vec4f(0.0,0.0,0.0,1.0);}
 let start=top.xyz+dir*atmo(${ATMOSPHERE_SLOT.scatteredFactor}u).w;
 var march=newMarch();
 march.variable=true;
 march.minSamples=MARCH_SAMPLES_MIN;
 march.maxSamples=samplesMaxOf(MARCH_SAMPLES_MAX,MARCH_SAMPLES_MIN);
 march.distanceInv=1.0/MARCH_DISTANCE_KM;
 march.offset=noise;
 let r=integrateAir(start,dir,false,march,true,airSuns(),atmo(${ATMOSPHERE_SLOT.skyFactor}u).w,depthKm);
 return vec4f(r.radiance,dot(r.transmittance,vec3f(1.0/3.0)));
}
fn cloudHazeOver(cloud:vec4f,haze:vec4f)->vec4f{
 let coverage=1.0-cloud.a;
 return vec4f(cloud.rgb*haze.a+coverage*haze.rgb,cloud.a);
}`,
)
