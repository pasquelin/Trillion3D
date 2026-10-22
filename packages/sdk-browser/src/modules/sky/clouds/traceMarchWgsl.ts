/**
 * THE VIEW TRACING'S PIECES THAT DO NOT VARY WITH ITS KEY (`traceWgsl.ts`): the ray's shell, and the
 * march with the finish of a ray's colour.
 */

/** The traced texel's ray, its entry and exit of the layer. */
export const CLOUD_SHELL_WGSL = `/** The traced texel's ray, shifted to pass through the centre of the pixel it traces. */
fn cloudNdc(p:vec2u)->vec2f{
 return pixelToNdc(vec2f(p)+0.5,vec2f(cloudTrace.traced.xy))-cloudTrace.jitter.xy;
}
/** The point at device depth \`z\` on the ray of \`ndc\`. */
fn cloudUnproject(ndc:vec2f,z:f32)->vec3f{
 return unprojectPoint(cloudTrace.inverseView,vec3f(ndc,z));
}
/** The ray's entry and exit of the layer, in centimetres; false where it never meets the shell. */
fn cloudShell(r:ptr<function,CloudRay>)->bool{
 let bottom=cloudPlanetKm(cloudTrace.counts.w==1u,cloudTrace.sky.x)+cloudTrace.layer.x;
 let tTop=raySphere((*r).origin,(*r).dir,bottom+cloudTrace.layer.y);
 let tBottom=raySphere((*r).origin,(*r).dir,bottom);
 (*r).tTop=tTop;
 (*r).tBottom=tBottom;
 if(all(tTop==vec2f(-1.0))){return false;}
 var low=tTop.x;
 var high=tTop.y;
 if(any(tBottom!=vec2f(-1.0))){
  let bottomAhead=all(tBottom>vec2f(0.0));
  let topNear=min(tTop.x,tTop.y);
  let topEnd=select(select(max(tTop.x,tTop.y),topNear,all(tTop>vec2f(0.0))),max(0.0,topNear),bottomAhead);
  let bottomEnd=select(max(tBottom.x,tBottom.y),min(tBottom.x,tBottom.y),bottomAhead);
  low=min(bottomEnd,topEnd);
  high=max(bottomEnd,topEnd);
 }
 (*r).tMin=max(0.0,low)*CM_PER_KM;
 (*r).tMax=max(0.0,high)*CM_PER_KM;
 return true;
}`

/** The longest march, the mean depth of the cloud a ray met, the haze and fog laid over its colour,
 *  and the march itself. */
export const CLOUD_MARCH_WGSL = `/** The longest march, from the layer's entry or from the eye; false where nothing is left to trace. */
fn cloudMaxDistance(r:ptr<function,CloudRay>,depthCm:f32)->bool{
 let longest=cloudTrace.reach.z;
 if(cloudTrace.reach.w==0.0){
  (*r).tMax=(*r).tMin+min(longest,(*r).tMax-(*r).tMin);
  return true;
 }
 (*r).tMin=min(longest,(*r).tMin);
 let tBottom=(*r).tBottom;
 if(all(tBottom>vec2f(0.0))&&max(tBottom.x,tBottom.y)*CM_PER_KM<=longest){
  (*r).tMax=min(min(longest,max((*r).tTop.x,(*r).tTop.y)*CM_PER_KM),depthCm);
 }else{
  (*r).tMax=min((*r).tMax,longest);
 }
 return (*r).tMax-(*r).tMin>0.0;
}
/** The mean distance of the cloud the ray met, weighted by what it let through; \`noCloud\` where it met none. */
fn cloudMeanDepth(a:CloudAccum,noCloud:f32)->f32{
 return select(a.tapSum/max(0.0000000001,a.tapWeights),noCloud,a.tapWeights==0.0);
}
/** The ray's luminance with the haze of the air laid over it, then the fog of the scene where the
 *  trace lays it (the late fog off: on the pixels the ray met cloud on, or on every pixel), at its
 *  mean distance \`meanDepth\` (\`cloudMeanDepth\`), and its transmittance, the grey of the three
 *  channels' mean, nothing under the opacity limit. */
fn cloudFinish(a:CloudAccum,meanDepth:f32,dir:vec3f)->vec4f{
 let mean=dot(a.transmittance,vec3f(1.0/3.0));
 var luminance=a.luminance;
 let eye=frame.eye.xyz;
 let there=eye+dir*(meanDepth*CLOUD_CM_TO_M);
 let inTrace=cloudTrace.switches.x==1u;
 let everywhere=inTrace&&cloudTrace.switches.y==1u;
 if(cloudTrace.options.x==1u&&(everywhere||a.tapWeights>0.0)){
  let air=aerialPerspective(there,eye);
  luminance=air.rgb*(1.0-mean)+air.a*luminance;
 }
 if(inTrace&&(everywhere||a.tapWeights>0.0)){
  let fog=cloudFog(there,eye);
  luminance=fog.rgb*(1.0-mean)+fog.a*luminance;
 }
 return vec4f(luminance,select(mean,0.0,mean<cloudTrace.layer.w));
}
fn cloudMarch(r:CloudRay,closestCm:f32,p:vec2u)->CloudMarched{
 var m:CloudMarched;
 m.seen.transmittance=vec3f(1.0);
 m.nearest.transmittance=vec3f(1.0);
 let span=r.tMax-r.tMin;
 let counted=u32(max(f32(cloudTrace.counts.x),floor(cloudTrace.samples.x)*saturate(span*cloudTrace.samples.w)));
 let stepT=span/f32(counted);
 let steps=min(counted,cloudTrace.counts.y);
 let onEmpty=cloudEmptyStep();
 let octaves=cloudOctaves();
 let lights=cloudLights(r.dir);
 let pixel=vec2u((vec2f(p)+0.5)*f32(cloudTrace.mapping.y));
 var jitter=0.5;
 if(cloudTrace.options.y==0u){jitter=vsmNoiseOne(pixel,cloudTrace.sizes.x);}
 var t=r.tMin+jitter*stepT;
 var i=cloudStartSteps(p,&t,stepT);
 loop{
  if(i>=steps){break;}
  let rel=r.dir*t;
  let here=cloudPointAt(rel);
  if(here.spot.conservativeDensity.x<=0.0){
   i+=onEmpty;
   t+=f32(onEmpty)*stepT;
   continue;
  }
  if(here.norm<=0.0||here.norm>=1.0){continue;}
  cloudSampleStep(rel,t,here.norm,here.spot,lights,octaves,stepT*CLOUD_CM_TO_M,closestCm,&m);
  if(all(m.seen.transmittance<vec3f(cloudTrace.layer.w))){break;}
  continuing{
   i++;
   t+=stepT;
  }
 }
 return m;
}`
