/** The same centroid lighting for resident cache cells and displaced owner hits. */
export const SURFACE_IRRADIANCE_WGSL = `
/**
 * Irradiance of the declared lights at a texel point. Shadows are traced against the proxy,
 * which keeps a closed door closed for bounce as for the direct term. Every shadow-casting light
 * that adds light at the point is tested: one left untested would shine through the wall (#29).
 * In the surface cache and probe passes the bounce budget holds the cost by updating fewer cells;
 * a mirror ray landing on an owned leaf (\`rayRadiance\`) pays one ray per such light per pixel.
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
   if(proxyBlocked(offset,incidence.xyz,span,false)){continue;}
  }
  total+=lit;
 }
 return total;
}
`;
