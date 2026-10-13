import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/** The lighting of the declared lights at a point, which a probe's or a reflection's ray lands on. */
export const SURFACE_IRRADIANCE_WGSL = wgslBlock(
  'SURFACE_IRRADIANCE_WGSL',
  [],
  `
/**
 * Irradiance of the declared lights at a point a ray landed on. Shadows are traced against the proxy,
 * which keeps a closed door closed for bounce as for the direct term. Every shadow-casting light
 * that adds light at the point is tested: one left untested would shine through the wall.
 * The bounce budget holds the cost of the probe pass by updating fewer probes.
 */
fn directIrradiance(P:vec3f,N:vec3f,reach:f32)->vec3f{
 var total=vec3f(0.0);
 let count=directLights.count;
 let offset=P+N*1e-3;
 for(var index=0u;index<count;index++){
  let light=directLights.items[index];
  // A rectangle casts no shadow: its irradiance is its whole contribution.
  if(isRect(light)){total+=light.colorIntensity.rgb*light.colorIntensity.w*rectIrradiance(light,P,N).w;continue;}
  let incidence=directIncidence(light,P);
  if(incidence.w<=0.0){continue;}
  let cosine=dot(N,incidence.xyz);
  if(cosine<=0.0){continue;}
  let lit=light.colorIntensity.rgb*light.colorIntensity.w*incidence.w*cosine;
  if(all(lit==vec3f(0.0))){continue;}
  if(light.params.z>0.5){
   let span=select(length(light.positionRange.xyz-P),reach,isSun(light));
   if(rtBlocked(offset,incidence.xyz,span)){continue;}
  }
  total+=lit;
 }
 return total;
}
`,
)
