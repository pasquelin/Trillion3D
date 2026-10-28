import { wgslBlock, wgslStruct } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE LIVE SHADING OF A HETEROGENEOUS VOLUME: the pipeline the volumes take by default
 * (`r.HeterogeneousVolumes.Preshading` is 0, `HeterogeneousVolumes.cpp:186-191`, the branch at
 * `:1252-1297`). The volume's material is evaluated at each step of the march, never baked into a
 * grid first. A pass marches the ray of each pixel of the (downsampled) image through the volume's
 * bounds, from the camera to the opaque surface, adding the volume's emission and the light it
 * scatters toward the eye, and keeping the transmittance (`HeterogeneousVolumesLiveShadingPipeline.usf`,
 * `RenderSingleScatteringWithLiveShading`; the march `HeterogeneousVolumesRayMarchingUtils.ush`,
 * `RayMarchSingleScattering`). Before it, a pass fills the lighting cache: for each voxel of a 3D
 * texture over the bounds, the light the lights give the voxel's centre, shadowed by the scene and
 * by the volume itself (`RenderLightingCacheWithLiveShadingCS`, `ComputeInscattering`), so that the
 * march reads the in-scattered light with one fetch a step (the default `LightingCache` 2).
 *
 * The program that includes these declares what the volume and the frame provide:
 *
 * - `hv`, a uniform of `HvVolume`;
 * - `hvSampleExtinction`, `hvSampleAlbedo`, `hvSampleEmission(local, world)->vec3f`, the volume
 *   material's three outputs at a point (`subsurfaceColor`, `baseColor`, `emissive`;
 *   `HeterogeneousVolumesLiveShadingUtils.ush`, `SampleExtinctionCoefficients` held to
 *   [0, 65000], the emission the same, the albedo to [0, 1]);
 * - `hvSampleLightingCache(uvw)->vec3f` (the cache, filtered), `hvFog(cameraRelative, rayT)->vec4f`
 *   (the height and volumetric fog at a point of the ray: radiance in rgb, transmittance in alpha;
 *   one when the fog is off), `hvPreExposure()`;
 * - `hvPixelRay(viewPixel)->HvPixelRay` (the camera's ray and the opaque depth of a pixel),
 *   `hvLoadLighting(pixel)` and `hvStoreLighting(pixel, value)` (the radiance image and its alpha,
 *   the transmittance so far), `hvDownsample()`, `hvFrameIndex()`, `hvBlueNoise(pixel)->f32`.
 */

/** What a volume gives the pass, in the order the buffer holds it (`HvVolume`). Vectors are padded to four. */
const HV_VOLUME = wgslStruct(
  'HvVolume',
  [],
  `struct HvVolume{
 localToWorld:mat4x4f,
 worldToLocal:mat4x4f,
 boundsOrigin:vec4f,
 boundsExtent:vec4f,
 resolution:vec4f,
 cacheResolution:vec4f,
 step:vec4f,
 limits:vec4f,
 flags:vec4u,
 light:vec4u,
}`,
)

/** The camera's ray of a pixel: its origin and unit direction in the world, the opaque depth along the
 *  view (metres) and the ray's length per unit of that depth. */
export const HV_PIXEL_RAY = wgslStruct(
  'HvPixelRay',
  [],
  `struct HvPixelRay{origin:vec3f,direction:vec3f,depth:f32,perDepth:f32,}`,
)

/** The march of one ray and the end of it. */
const HV_RAY = wgslStruct(
  'HvRay',
  [],
  `struct HvRay{
 localOrigin:vec3f,
 localDirection:vec3f,
 tMin:f32,
 tMax:f32,
 worldOrigin:vec3f,
 worldDirection:vec3f,
 toWorldScale:f32,
 jitter:f32,
 stepSize:f32,
 maxSteps:u32,
 emission:bool,
 direct:bool,
}`,
)

/** The ray marching: the box, the step, and the single scattering. `hv.step` holds the step size, the
 *  step factor, the shadow step size and the shadow step factor; `hv.limits` the farthest view ray,
 *  the farthest shadow ray, the most steps and the jitter switch; `hv.flags` whether emission and
 *  transmittance are applied, whether direct lighting is, whether shadow transmittance is, and the
 *  mode of the fog's in-scattering (0 none, 1 reference, 2 linear approximation); hv.light.x the one light a pass
 *  of the transmittance cache is for (4294967295 for all); with mode 1 only the last pass applies the emission and sets the
 *  transmittance (hv.flags.x). */
export const HV_RAY_MARCH_WGSL = wgslBlock(
  'HV_RAY_MARCH_WGSL',
  [HV_VOLUME, HV_PIXEL_RAY, HV_RAY],
  `
/** The span of the ray inside the box, clamped to [tMin, tMax]: its two ends. */
fn hvIntersectAabb(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,boxMin:vec3f,boxMax:vec3f)->vec2f{
 let inverse=1.0/direction;
 let first=(boxMin-origin)*inverse;
 let second=(boxMax-origin)*inverse;
 let near=min(first,second);
 let far=max(first,second);
 return vec2f(max(max(near.x,max(near.y,near.z)),tMin),min(min(far.x,min(far.y,far.z)),tMax));
}
/** The step along a local ray: the step size where it is set, else the smallest distance across a
 *  voxel along the ray times the step factor; held at 0.01 or more. */
fn hvStepSize(direction:vec3f,size:f32,factor:f32)->f32{
 var step=size;
 if(step<=0.0){
  let voxel=hv.boundsExtent.xyz/hv.resolution.xyz;
  let along=abs(voxel/direction);
  step=min(along.x,min(along.y,along.z))*factor;
 }
 return max(step,0.01);
}
/** The step of the view ray. */
fn hvViewStepSize(direction:vec3f)->f32{return hvStepSize(direction,hv.step.x,hv.step.y);}
/** The step of a shadow ray. */
fn hvShadowStepSize(direction:vec3f)->f32{return hvStepSize(direction,hv.step.z,hv.step.w);}
/** The step lengthened where the box's diagonal would take more than the most steps. */
fn hvRecalculateStepSize(ray:HvRay)->f32{
 let diagonal=length(2.0*hv.boundsExtent.xyz);
 let count=u32(max(diagonal/ray.stepSize,1.0));
 return select(ray.stepSize,diagonal/f32(ray.maxSteps),count>ray.maxSteps);
}
/** The march of a ray: the steps it takes between its ends at its step (set in ray). */
fn hvStepCount(ray:ptr<function,HvRay>)->u32{
 (*ray).stepSize=hvRecalculateStepSize(*ray);
 return u32(max(ceil(abs((*ray).tMax-(*ray).tMin)/(*ray).stepSize),1.0));
}
/** A ray from localOrigin to localDirection inside the box, its scale to the world's the world length of its
 *  end over its local one. */
fn hvMakeRay(localOrigin:vec3f,localDirection:vec3f,tMin:f32,tMax:f32,worldOrigin:vec3f,worldDirection:vec3f,jitter:f32,stepSize:f32,maxSteps:u32,emission:bool,direct:bool)->HvRay{
 var ray:HvRay;
 ray.localOrigin=localOrigin;ray.localDirection=localDirection;ray.tMin=tMin;ray.tMax=tMax;
 ray.worldOrigin=worldOrigin;ray.worldDirection=worldDirection;
 let end=(hv.localToWorld*vec4f(localOrigin+localDirection*tMax,1.0)).xyz;
 ray.toWorldScale=length(end-worldOrigin)/tMax;
 ray.jitter=jitter;ray.stepSize=stepSize;ray.maxSteps=maxSteps;ray.emission=emission;ray.direct=direct;
 return ray;
}
/** The transmittance of a ray through the box with no lighting: the extinction summed over the steps. */
fn hvComputeTransmittance(worldOrigin:vec3f,toLight:vec3f,maxSteps:u32)->vec3f{
 let worldEnd=worldOrigin+toLight;
 let worldDirection=normalize(toLight);
 let localOrigin=(hv.worldToLocal*vec4f(worldOrigin,1.0)).xyz;
 let localEnd=(hv.worldToLocal*vec4f(worldEnd,1.0)).xyz;
 var localDirection=localEnd-localOrigin;
 let tMax=length(localDirection);
 localDirection/=tMax;
 var ray=hvMakeRay(localOrigin,localDirection,0.0,tMax,worldOrigin,worldDirection,0.5,hvShadowStepSize(localDirection),maxSteps,false,false);
 let span=hvIntersectAabb(ray.localOrigin,ray.localDirection,ray.tMin,ray.tMax,hv.boundsOrigin.xyz-hv.boundsExtent.xyz,hv.boundsOrigin.xyz+hv.boundsExtent.xyz);
 var transmittance=vec3f(1.0);
 if(span.y-span.x>0.0){
  ray.tMin=span.x;ray.tMax=span.y;
  let count=hvStepCount(&ray);
  for(var i=0u;i<count;i++){
   let t=ray.tMin+ray.stepSize*(ray.jitter+f32(i));
   let local=ray.localOrigin+ray.localDirection*t;
   let world=ray.worldOrigin+ray.worldDirection*t*ray.toWorldScale;
   transmittance*=exp(-hvSampleExtinction(local,world)*ray.stepSize);
   if(all(transmittance<vec3f(1.0e-7))){return vec3f(0.0);}
  }
 }
 return transmittance;
}
/** The world distance a cache voxel is biased by along the light: its diagonal times the voxel bias
 *  (GetLightingCacheVoxelBias); none where the volume has no cache. */
fn hvShadowBias()->f32{
 if(!all(hv.cacheResolution.xyz>vec3f(0.0))){return 0.0;}
 let voxel=2.0*hv.boundsExtent.xyz/hv.cacheResolution.xyz;
 return length((hv.localToWorld*vec4f(voxel,0.0)).xyz)*hv.cacheResolution.w;
}
/** The light a lit voxel keeps once the volume shadows it: radiance the light's colour times its
 *  attenuation and the scene's shadow at world, shadowed by the volume toward the light when the
 *  volume casts on itself (ComputeInscattering, without the light's own terms). */
fn hvShadowedInscattering(world:vec3f,radiance:vec3f,toLight:vec3f,bias:f32,applyShadow:bool)->vec3f{
 var result=radiance;
 if(any(result>vec3f(0.0))&&applyShadow){
  let direction=normalize(toLight);
  let biased=world+direction*bias;
  if(hv.flags.z==1u){
   // The transmittance toward the light, cached (mode 1, DIM_USE_TRANSMITTANCE_VOLUME): one fetch.
   let local=(hv.worldToLocal*vec4f(biased,1.0)).xyz;
   result*=hvSampleLightingCache(saturate((local-(hv.boundsOrigin.xyz-hv.boundsExtent.xyz))/(2.0*hv.boundsExtent.xyz)));
  }else{
   result*=hvComputeTransmittance(biased,toLight,u32(hv.limits.z));
  }
 }
 return result;
}
/** The march of a ray through the volume: the emission and the light scattered toward the eye, from
 *  the lighting cache, added to radiance, and the transmittance through it, held in transmittance
 *  (RayMarchSingleScattering, the in-scattering volume and the fog's linear approximation or reference).
 *  Gives the local distance of the first step with extinction (the ray's end where none has) and, in atFirst, the transmittance there
 *  (LocalScatterT0 and Transmittance0, which the reference fills in its adaptive march alone: the beer map of the camera needs them in this one, corrected). */
fn hvRayMarch(ray:HvRay,count:u32,radiance:ptr<function,vec3f>,transmittance:ptr<function,vec3f>,atFirst:ptr<function,vec3f>)->f32{
 var scatterTMin=ray.tMax;
 var fogRadiance=vec3f(0.0);
 let startTransmittance=*transmittance;
 var previousTransmittance=*transmittance;
 var previousFog=vec4f(0.0);
 let fogMode=hv.flags.w;
 let worldFogT=array<f32,2>(ray.tMin*ray.toWorldScale,ray.tMax*ray.toWorldScale);
 var fogAtEnds=array<vec4f,2>(vec4f(0.0),vec4f(0.0));
 if(fogMode==2u){
  for(var i=0;i<2;i++){fogAtEnds[i]=hvFog(ray.worldDirection*worldFogT[i],worldFogT[i]);}
 }
 var step=ray.stepSize;
 let jitterSize=step*ray.jitter;
 let boundsMin=hv.boundsOrigin.xyz-hv.boundsExtent.xyz;
 for(var i=0u;i<count;i++){
  var localT=ray.tMin+ray.stepSize*(ray.jitter+f32(i));
  if(i==count-1u){step=ray.tMax-(localT-jitterSize);}
  let worldT=localT*ray.toWorldScale;
  let local=ray.localOrigin+ray.localDirection*localT;
  let world=ray.worldOrigin+ray.worldDirection*worldT;
  let extinction=hvSampleExtinction(local,world);
  if(ray.emission){
   *radiance=*radiance+hvSampleEmission(local,world)*step*(*transmittance);
   if(hv.light.y==2u){
    *radiance=*radiance+hvIndirectInscattering(world)*(hvSampleAlbedo(local,world)*extinction)*(*transmittance)*step;
   }
  }
  if(ray.direct&&any(extinction>vec3f(0.0))){
   var scatter=vec3f(0.0);
   let albedo=hvSampleAlbedo(local,world);
   if(any(albedo>vec3f(0.0))){
    let uvw=saturate((local-boundsMin)/(2.0*hv.boundsExtent.xyz));
    // The cache of the in-scattered light (mode 2), else the lights at each step
    var inscattering:vec3f;
    if(hv.flags.z==2u){inscattering=hvSampleLightingCache(uvw)/hvPreExposure();}
    else{inscattering=hvInscatteringAt(world,hvShadowBias());}
    scatter=inscattering*(albedo*extinction)*(1.0/(4.0*3.14159265358979))*(*transmittance)*step;
   }
   if(fogMode==1u||fogMode==2u){
    var fog:vec4f;
    if(fogMode==1u){fog=hvFog(ray.worldDirection*worldT,worldT);}
    else{fog=mix(fogAtEnds[0],fogAtEnds[1],saturate((worldT-worldFogT[0])/(worldFogT[1]-worldFogT[0])));}
    scatter*=fog.a;
    let delta=clamp((*transmittance)/previousTransmittance,vec3f(0.0),vec3f(1.0));
    fogRadiance+=(fog.rgb-previousFog.rgb)*delta;
    previousFog=fog;
   }
   *radiance=*radiance+scatter;
  }
  if(any(extinction>vec3f(0.0))){
   if(scatterTMin==ray.tMax){scatterTMin=localT;*atFirst=*transmittance;}
  }
  *transmittance=*transmittance*exp(-extinction*step);
  if(all((*transmittance)<vec3f(1.0e-7))){*transmittance=vec3f(0.0);break;}
 }
 if(fogMode!=0u){
  *radiance=*radiance+fogRadiance*clamp(startTransmittance-(*transmittance),vec3f(0.0),vec3f(1.0));
 }
 return scatterTMin;
}
`,
)
