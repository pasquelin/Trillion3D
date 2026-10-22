import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { FOG_PLAN_WGSL } from './planWgsl.ts'
import { FOG_SKY_LIGHT_WGSL } from './skyLightWgsl.ts'

/**
 * THE BAKED LIGHT EACH CELL OF THE VOLUME SCATTERS (the static term), one thread a cell, written for the
 * scatter to add to the light of the cell's samples (`fogStaticTerm`, `scatterWgsl.ts`). It is a pass of
 * its own because the scatter binds the most sampled textures a stage may, and the volumetric lightmap
 * (`../volumetricLightmap/sampleWgsl.ts`) is nine more. The program declares the frame (`frame`), the
 * light buffer (`directLights`), the scene's depth (`fogDepth`), the furthest depths the plan reads and
 * the volume written (`fogStaticOut`), and lists the lightmap's sampling, the sky light's read, the fog's
 * text (`fogInscattering`) and the plan.
 *
 * It takes the samples the scatter takes — the cell's plan (`fogCellPlan`) names how many, and each is at
 * `fogSampleOffset`, so the points are the scatter's own — and writes the mean of what they add, in single
 * precision: a sum of terms is the sum of the sums, so adding the mean to the scatter's mean is the sum the
 * scatter would make sample by sample.
 *
 * A sample adds two terms, each where the frame asks for it (`staticLight`, `frame.ts`):
 * - the sky light's light, times the visibility the lightmap stores — the length of its bent normal —,
 *   where the sky light is stationary and casts shadows (`staticLight.y`): the scatter then leaves the
 *   sky light to this pass;
 * - the static lighting: the lightmap's two bands of harmonics dotted with the phase's zonal harmonic
 *   along the view direction, over π, never negative, times the fog's intensity (`staticLight.x`). The
 *   view direction is the camera vector, from the eye to the point; the coefficients are those of the
 *   scene's own axes (the bake projects the light in them), so the harmonic is the vector `(1, y, z, x)`
 *   of that direction times `(1, g, g, g)`, whichever axis is up.
 */
export const FOG_STATIC_WGSL = wgslBlock(
  'FOG_STATIC_WGSL',
  [FOG_PLAN_WGSL, FOG_SKY_LIGHT_WGSL, PI],
  `
/** The baked light of the sample of a cell at \`offset\` within it. */
fn fogStaticAt(cell:vec3u,offset:vec3f)->vec3f{
 let P=fogCellPoint(cell,offset).xyz;
 let toEyeFull=frame.eye.xyz-P;
 let span=max(sqrt(dot(toEyeFull,toEyeFull)),1e-6);
 let toEye=toEyeFull/span;
 let brickUvs=vlmBrickUvs(P);
 var light=vec3f(0.0);
 if(frame.staticLight.y>0.0){
  light+=fogSky(toEye,span)*length(vlmSkyBentNormal(brickUvs));
 }
 if(frame.staticLight.x>0.0){
  let cameraVector=-toEye;
  let g=frame.medium.x;
  let phase=vec4f(1.0,cameraVector.y,cameraVector.z,cameraVector.x)*vec4f(1.0,g,g,g);
  light+=(frame.staticLight.x/PI)*max(vlmDotSh2(vlmSh2(brickUvs),phase),vec3f(0.0));
 }
 return light;
}
@compute @workgroup_size(4,4,4)
fn staticMain(@builtin(global_invocation_id) cell:vec3u){
 if(any(cell>=vec3u(frame.grid.xyz))){return;}
 let plan=fogCellPlan(cell);
 var sum=vec3f(0.0);
 if(!plan.hidden){
  for(var s=0u;s<plan.samples;s++){
   sum+=fogStaticAt(cell,fogSampleOffset(cell,s));
  }
  sum/=f32(plan.samples);
 }
 textureStore(fogStaticOut,vec3i(cell),vec4f(sum,0.0));
}`,
)
