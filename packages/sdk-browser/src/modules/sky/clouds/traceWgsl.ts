import { HALF_MAX } from '../../../../../math/src/wgsl/constants.ts'
import { pixelToNdc, unprojectPoint } from '../../../../../math/src/wgsl/projection.ts'
import { HAZE_READ_WGSL } from '../../../lighting/atmosphere/hazeReadWgsl.ts'
import { airProgram, type AirBindings } from '../../../lighting/atmosphere/programs.ts'
import { vsmBlueNoiseWgsl } from '../../../lighting/shadows/vsm/blueNoise.ts'
import { cloudMaterialBindings } from './materialWgsl.ts'
import type { CloudSetup } from './cloudModes.ts'
import { CLOUD_FORMAT, DEVICE_DEPTH_FLOOR } from './reconstructLayout.ts'
import { cloudDepthBinding, cloudSceneDepthFn } from './traceDepthWgsl.ts'
import { CLOUD_TRACE_BINDING as B, CLOUD_TRACE_LAYOUT } from './traceLayout.ts'
import { CLOUD_FOG_WGSL } from './composeWgsl.ts'
import { CLOUD_LIGHT_WGSL } from './traceLightWgsl.ts'
import { CLOUD_GROUND_WGSL } from './traceGroundWgsl.ts'
import { cloudTraceExtraWgsl } from './traceExtraWgsl.ts'
import { CLOUD_TRACE_PLAIN, type CloudTracePermutation } from './traceExtraLayout.ts'

/** The tracing's own group: group 0 is the air's. */
const G = 1

/** What the tracing binds of the air, in group 0: the light buffer, the transmittance table and
 *  its sampler, the image's frame, and the fog's cubemap and volume. */
export const CLOUD_TRACE_AIR: AirBindings = {
  air: 'read',
  transmittance: true,
  frame: true,
  fog: true,
}

/** The format of the scene's depth range, two half floats (the nearest and the farthest depth); the
 *  half-size checkerboard depth is written in its first channel. */
export const CLOUD_DEPTH_RANGE_FORMAT: GPUTextureFormat = 'rg16float'

/** The threads of a group along each axis. */
export const CLOUD_TRACE_GROUP_SIZE = 8

/**
 * THE VIEW TRACING: one thread to a texel of the traced image, a ray from the eye through the view
 * pixel the image traces this time, marched through the cloud layer's shell.
 *
 * The ray is cut to the shell, to the scene's depth, to the longest march and the nearest start,
 * and takes as many steps as its length asks (`samples`), the first of each placed by the blue
 * noise of its pixel. At each step the material (`cloudMaterialAt`) gives the extinction, the
 * colour and the emission; where the cloud scatters, the light of the air and the sky is gathered
 * (`traceLightWgsl.ts`) and integrated over the step. The march ends where every channel of what
 * the ray lets through is under the opacity limit.
 *
 * Three images are written (`reconstructLayout.ts`): the luminance and the transmittance, the same
 * for the samples before the nearest depth of the texel's block, and the depths in kilometres. The
 * haze of the air is laid over each once, at the mean distance of the cloud the ray met weighted by
 * what it let through. The fog of the scene is laid here only with the late fog off
 * (\`cloudFogLate\`); with it on, it is laid with the composition. The haze is laid here unless a
 * second pass lays it per pixel (\`options.x\`).
 *
 * The frame's options vary the program (\`traceExtraWgsl.ts\`): the empty-space table, the sun's
 * opaque shadow and the lamps. A reflection or a capture (\`options.y\`) places the first sample of
 * a ray in the middle of its step, not by the blue noise.
 *
 * Lengths are centimetres; the shell is intersected in kilometres from the planet's centre.
 */
const traceOwn = (setup: CloudSetup) => `${CLOUD_TRACE_LAYOUT.wgsl}
@group(${G}) @binding(${B.block}) var<uniform> cloudTrace:CloudTraceBlock;${cloudMaterialBindings(G, B.material)}
${cloudDepthBinding(G, B.depthRange, setup.depth)}
@group(${G}) @binding(${B.colour}) var colourOut:texture_storage_2d<${CLOUD_FORMAT},write>;${
  setup.minMaxDepth
    ? `
@group(${G}) @binding(${B.secondary}) var secondaryOut:texture_storage_2d<${CLOUD_FORMAT},write>;`
    : ''
}
@group(${G}) @binding(${B.depth}) var depthOut:texture_storage_2d<${CLOUD_FORMAT},write>;
struct CloudRay{origin:vec3f,dir:vec3f,tMin:f32,tMax:f32,tTop:vec2f,tBottom:vec2f,}
struct CloudTraced{colour:vec4f,secondary:vec4f,depth:vec4f,}
struct CloudDepth{closestCm:f32,furthestCm:f32,km:vec4f,}
/** The traced texel's ray, shifted to pass through the centre of the pixel it traces. */
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
}
${cloudSceneDepthFn(setup.depth)}
/** The longest march, from the layer's entry or from the eye; false where nothing is left to trace. */
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
}
fn cloudRayTrace(p:vec2u)->CloudTraced{
 var out:CloudTraced;
 out.colour=vec4f(0.0,0.0,0.0,1.0);
 out.secondary=vec4f(0.0,0.0,0.0,1.0);
 out.depth=vec4f(HALF_MAX);
 let ndc=cloudNdc(p);
 var r:CloudRay;
 r.origin=frame.camera.xyz;
 r.dir=normalize(cloudUnproject(ndc,0.5)-frame.eye.xyz);
 if(!cloudShell(&r)){return out;}
 if(r.tMax<=r.tMin||r.tMin>cloudTrace.reach.x){return out;}
 let depth=cloudSceneDepth(p,ndc);
 out.depth=depth.km;
 if(cloudTrace.options.z==1u){
  if(depth.furthestCm<r.tMin){return out;}
  r.tMax=min(r.tMax,depth.furthestCm);
 }
 if(!cloudMaxDistance(&r,depth.furthestCm)){return out;}
 r.tMin=max(r.tMin,cloudTrace.reach.y);
 r.tMax=max(r.tMin,r.tMax);
 let m=cloudMarch(r,${setup.minMaxDepth ? 'depth.closestCm' : '-1.0'},p);
 let seenDepth=cloudMeanDepth(m.seen,r.tMax);
 out.colour=cloudFinish(m.seen,seenDepth,r.dir);
${
  setup.minMaxDepth
    ? ' out.secondary=cloudFinish(m.nearest,cloudMeanDepth(m.nearest,r.tMax),r.dir);\n'
    : ''
} out.depth.x=select(seenDepth,r.tMax,out.colour.a>0.99)*CLOUD_CM_TO_KM;
 return out;
}
@compute @workgroup_size(${CLOUD_TRACE_GROUP_SIZE},${CLOUD_TRACE_GROUP_SIZE},1)
fn cloudTraceMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=cloudTrace.traced.x||id.y>=cloudTrace.traced.y){return;}
 cloudStart();
 cloudLampsStart(id.xy,f32(cloudTrace.mapping.y));
 let traced=cloudRayTrace(id.xy);
 textureStore(colourOut,id.xy,traced.colour);${
   setup.minMaxDepth ? '\n textureStore(secondaryOut,id.xy,traced.secondary);' : ''
 }
 textureStore(depthOut,id.xy,traced.depth);
}`

const programs = new Map<string, string>()

/** The view tracing's whole program for `setup` (`CLOUD_TRACE_ENTRY`) and the variation `extra` of
 *  its options: the scene's depth it reads, the second surface it traces or not, and the options
 *  make the program; one is made for each and kept. */
export function cloudTraceProgram(
  setup: CloudSetup,
  extra: CloudTracePermutation = CLOUD_TRACE_PLAIN,
) {
  const key = `${setup.depth}${setup.minMaxDepth}${extra.emptySpace}${extra.opaqueShadow}${extra.localLights}`
  let code = programs.get(key)
  if (code === undefined) {
    code = airProgram({ ...CLOUD_TRACE_AIR, lights: extra.localLights }, traceOwn(setup), [
      CLOUD_LIGHT_WGSL,
      CLOUD_GROUND_WGSL,
      cloudTraceExtraWgsl(extra),
      CLOUD_FOG_WGSL,
      HALF_MAX,
      DEVICE_DEPTH_FLOOR,
      pixelToNdc,
      unprojectPoint,
      HAZE_READ_WGSL,
      vsmBlueNoiseWgsl(G, B.blueNoise),
    ]).code
    programs.set(key, code)
  }
  return code
}
export const CLOUD_TRACE_ENTRY = 'cloudTraceMain'
