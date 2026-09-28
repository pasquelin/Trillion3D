import { BOUNCE_SETTINGS } from '../../../sdk-core/src/index.ts';

/** The same centroid lighting for resident cache cells and displaced owner hits. */
export const SURFACE_IRRADIANCE_WGSL = `
const LIGHTS_PER_TEXEL:u32=${BOUNCE_SETTINGS.lightsPerRay}u;
/**
 * Irradiance of the declared lights at a texel point. Shadows are traced against the proxy,
 * which keeps a closed door closed for bounce as for the direct term; the shadow-ray count
 * is capped, and what it skips is skipped in light order, hence deterministically.
 */
fn directIrradiance(P:vec3f,N:vec3f,reach:f32)->vec3f{
 var total=vec3f(0.0);
 var shadows=0u;
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
  if(light.params.z>0.5&&shadows<LIGHTS_PER_TEXEL){
   shadows++;
   let span=select(length(light.positionRange.xyz-P),reach,isSun(light));
   if(proxyBlocked(offset,incidence.xyz,span)){continue;}
  }
  total+=light.colorIntensity.rgb*light.colorIntensity.w*incidence.w*cosine;
 }
 return total;
}
`;
