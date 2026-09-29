/** GGX split-sum kernel moments for the existing order-2 radiance probes.
 * With z=N.L, its normalized density is z/(1+k+(k-1)z)^2, k=roughness^4.
 * Zonal convolution multiplies bands 0/1/2 by E[1], E[z], E[(3z²-1)/2].
 * This evaluates the probe's represented radiance, not a new ray budget or a
 * second environment representation. The mirror continues to trace the proxy. */
export const PROBE_REFLECTION_FILTER_WGSL = `
fn reflectionProbeBands(rough:f32)->vec3f{
 let k=max(rough*rough*rough*rough,1e-8);
 let a=1.0+k;let b=k-1.0;let q=-b/a;
 var moments=vec3f(0.0);
 if(q<0.25){
  var power=1.0;
  // The geometric tail after twelve terms is below 3e-7 at q=.25.
  for(var index=0u;index<12u;index++){
   let i=f32(index);moments+=vec3f(1.0/(i+2.0),1.0/(i+3.0),1.0/(i+4.0))*(i+1.0)*power;
   power*=q;
  }
 }else{
  let j0=1.0/(a*(2.0*k));
  let h0=log(2.0*k/a)/b;
  let h1=(1.0-a*h0)/b;
  let h2=(0.5-a*h1)/b;
  let j1=(h0-a*j0)/b;
  let j2=(h1-a*j1)/b;
  let j3=(h2-a*j2)/b;
  moments=vec3f(j1,j2,j3);
 }
 return vec3f(1.0,moments.y/moments.x,0.5*(3.0*moments.z/moments.x-1.0));
}
fn filteredProbeReflection(P:vec3f,N:vec3f,R:vec3f,rough:f32)->vec3f{
 return sampleProbeField(P,N,R,reflectionProbeBands(rough),true);
}`;
