import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { pixelToNdc, unprojectPoint } from '../../../../../math/src/wgsl/projection.ts'
import { ATMOSPHERE_SLOT } from '../../../../../sdk-core/src/scene/core/atmospherePack.ts'

/**
 * THE VIEW TRACING'S PIECES THAT DO NOT VARY WITH ITS KEY (`traceWgsl.ts`): the ray's shell, and the
 * march with the finish of a ray's colour.
 */

/** The traced texel's ray: its centre in normalised device coordinates, shifted by the jitter, and
 *  the point at a device depth on it. */
export const CLOUD_RAY_WGSL = wgslBlock(
  'CLOUD_RAY_WGSL',
  [pixelToNdc, unprojectPoint],
  `/** The traced texel's ray, shifted to pass through the centre of the pixel it traces. */
fn cloudNdc(p:vec2u)->vec2f{
 return pixelToNdc(vec2f(p)+0.5,vec2f(cloudTrace.traced.xy))-cloudTrace.jitter.xy;
}
/** The point at device depth \`z\` on the ray of \`ndc\`. */
fn cloudUnproject(ndc:vec2f,z:f32)->vec3f{
 return unprojectPoint(cloudTrace.inverseView,vec3f(ndc,z));
}
/** A ray in the scene: its origin in metres and its unit direction. */
struct CloudViewRay{origin:vec3f,dir:vec3f,}
/** The ray of the pixel of \`ndc\`. A perspective view's leaves the eye and passes through the pixel.
 *  An orthographic view's (\`frame.eye.w\` 0) leaves the pixel's own point on the near plane (device
 *  depth 1) and runs along the view's direction, the same for every pixel. */
fn cloudViewRay(ndc:vec2f)->CloudViewRay{
 var ray:CloudViewRay;
 ray.origin=frame.eye.xyz;
 if(frame.eye.w==0.0){ray.origin=cloudUnproject(ndc,1.0);}
 ray.dir=normalize(cloudUnproject(ndc,0.5)-ray.origin);
 return ray;
}`,
)

/** The ray's shell: its entry and exit of the layer. */
export const CLOUD_SHELL_WGSL = `
/** The radius of the layer's bottom and of its top, kilometres from the planet's centre. */
fn cloudBottomKm()->f32{return cloudPlanetKm(cloudTrace.counts.w==1u,cloudTrace.sky.x)+cloudTrace.layer.x;}
fn cloudTopKm()->f32{return cloudBottomKm()+cloudTrace.layer.y;}
/** The ray's entry and exit of the layer, in centimetres; false where it never meets the shell. */
fn cloudShell(r:ptr<function,CloudRay>)->bool{
 let bottom=cloudBottomKm();
 let tTop=raySphere((*r).origin,(*r).dir,cloudTopKm());
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
/** The haze on the cloud at \`there\`, \`depthCm\` along \`dir\` from the ray's origin: in a capture, the one
 *  around the capture's place; else, with a start for the Mie or the Rayleigh scattering past 0, the
 *  two volumes read apart, each from the larger of the air's start and its own, the light summed
 *  and the transmittances multiplied; else the view's volume. */
fn cloudAir(there:vec3f,eye:vec3f,dir:vec3f,depthCm:f32)->vec4f{
 let startKm=atmo(${ATMOSPHERE_SLOT.scatteredFactor}u).w;
 if(cloudTrace.options.y==1u){return captureHaze(dir,depthCm*CLOUD_CM_TO_KM,startKm);}
 let apart=cloudTrace.haze;
 if(apart.x+apart.z>0.0){
  let mie=hazeOnly(there,eye,max(startKm,apart.z),apart.w);
  let ray=airOnly(there,eye,max(startKm,apart.x),apart.y);
  return vec4f(mie.rgb+ray.rgb,mie.a*ray.a);
 }
 return aerialPerspective(there,eye);
}
/** The ray's luminance, none where the clouds are a hole in the alpha (\`alphaHole\`), with the haze of
 *  the air laid over it, then the fog of the scene where the trace lays it (the late fog off: on the
 *  pixels the ray met cloud on, or on every pixel), at its
 *  mean distance \`meanDepth\` (\`cloudMeanDepth\`) and in the view's pixel \`pixel\`, which finds the local fog
 *  volumes' tile, and its transmittance, the grey of the three channels' mean, nothing under the
 *  opacity limit. */
fn cloudFinish(a:CloudAccum,meanDepth:f32,dir:vec3f,pixel:vec2f)->vec4f{
 let mean=dot(a.transmittance,vec3f(1.0/3.0));
 var luminance=select(a.luminance,vec3f(0.0),cloudTrace.local.y!=0.0);
 let eye=cloudOrigin;
 let there=eye+dir*(meanDepth*CLOUD_CM_TO_M);
 let inTrace=cloudTrace.switches.x==1u;
 let everywhere=inTrace&&cloudTrace.switches.y==1u;
 if(cloudTrace.options.x==1u&&(everywhere||a.tapWeights>0.0)){
  let air=cloudAir(there,eye,dir,meanDepth);
  luminance=air.rgb*(1.0-mean)+air.a*luminance;
 }
 if(inTrace&&(everywhere||a.tapWeights>0.0)){
  let fog=fogOverNoHaze(there,eye,pixel);
  luminance=fog.rgb*(1.0-mean)+fog.a*luminance;
 }
 return vec4f(luminance,select(mean,0.0,mean<cloudTrace.layer.w));
}
/** How far the sample at \`t\` along the ray moves for a pixel to the right and one below, from the
 *  rays of the neighbouring pixels (\`rayX\`, \`rayY\`: their origins, which differ in an orthographic
 *  view, and their directions): what the material picks the level of its textures from
 *  (\`cloudDdx\`). The shadow samples keep the main sample's. */
fn cloudFootprint(t:f32,dir:vec3f,rayX:CloudViewRay,rayY:CloudViewRay){
 let dx=(rayX.origin-cloudOrigin)*CLOUD_M_TO_CM+(rayX.dir-dir)*t;
 let dy=(rayY.origin-cloudOrigin)*CLOUD_M_TO_CM+(rayY.dir-dir)*t;
 cloudDdx=vec3f(dx.x,dx.z,dx.y);
 cloudDdy=vec3f(dy.x,dy.z,dy.y);
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
 let rayX=cloudViewRay(cloudNdc(p+vec2u(1u,0u)));
 let rayY=cloudViewRay(cloudNdc(p+vec2u(0u,1u)));
 var jitter=0.5;
 if(cloudTrace.options.y==0u){jitter=blueNoiseScalar(pixel,cloudTrace.sizes.x);}
 var t=r.tMin+jitter*stepT;
 var i=cloudStartSteps(p,&t,stepT);
 loop{
  if(i>=steps){break;}
  let rel=r.dir*t;
  cloudFootprint(t,r.dir,rayX,rayY);
  let probe=cloudProbeAt(rel);
  if(!cloudProbeDense(probe)){
   i+=onEmpty;
   t+=f32(onEmpty)*stepT;
   continue;
  }
  if(probe.norm<=0.0||probe.norm>=1.0){continue;}
  let here=cloudPointOf(probe,rel);
  cloudSampleStep(rel,t,here.norm,here.spot,lights,octaves,stepT*CLOUD_CM_TO_M,closestCm,&m);
  if(all(m.seen.transmittance<vec3f(cloudTrace.layer.w))){break;}
  continuing{
   i++;
   t+=stepT;
  }
 }
 return m;
}`
