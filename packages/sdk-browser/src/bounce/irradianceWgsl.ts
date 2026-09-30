/** The same centroid lighting for resident cache cells and displaced owner hits. */
export const SURFACE_IRRADIANCE_WGSL = `
/**
 * Irradiance of the declared lights at a texel point. Shadows are traced against the proxy,
 * which keeps a closed door closed for bounce as for the direct term. Every contributing
 * shadow-casting light is tested; frame budgets limit updated cells, never their visibility.
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
  if(light.params.z>0.5){
   let span=select(length(light.positionRange.xyz-P),reach,isSun(light));
   if(proxyBlocked(offset,incidence.xyz,span,false)){continue;}
  }
  total+=light.colorIntensity.rgb*light.colorIntensity.w*incidence.w*cosine;
 }
 return total;
}
`;
