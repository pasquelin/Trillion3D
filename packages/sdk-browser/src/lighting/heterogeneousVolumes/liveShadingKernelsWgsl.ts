import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { HV_RAY_MARCH_WGSL } from './liveShadingWgsl.ts'
import { BEER_DATA_WGSL } from './beerShadowMapWgsl.ts'

/**
 * THE TWO KERNELS OF THE LIVE SHADING (`HeterogeneousVolumesLiveShadingPipeline.usf`), over the
 * march of `liveShadingWgsl.ts` and the hooks it lists, with, besides:
 *
 * - `hvInscatteringAt(world, bias)->vec3f`: the light every light of the scene gives the point
 *   (colour times attenuation times the scene's shadow of the light, shadowed by the volume with
 *   hvShadowedInscattering), plus, in the indirect mode 1, the indirect in-scattering times 4 pi
 *   (ComputeInscattering, HeterogeneousVolumesRayMarchingUtils.ush);
 * - hvStoreCache(voxel, value): a write of the lighting cache.
 */
export const HV_KERNELS_WGSL = wgslBlock(
  'HV_KERNELS_WGSL',
  [HV_RAY_MARCH_WGSL, BEER_DATA_WGSL],
  `
/** Fills the lighting cache: for each voxel, the light the lights give the voxel's centre, times the
 *  pre-exposure, where the volume has extinction; zero where it has none (RenderLightingCacheWithLiveShadingCS). */
@compute @workgroup_size(4,4,4)
fn hvLightingCacheMain(@builtin(global_invocation_id) voxel:vec3u){
 hvInit();
 if(any(voxel>=vec3u(hv.cacheResolution.xyz))){return;}
 let uvw=(vec3f(voxel)+vec3f(0.5))/hv.cacheResolution.xyz;
 // The voxels away from any extinction (the dilated mask, hvExistenceMain) are not evaluated: the transmittance cache holds one there, the in-scattering cache none.
 if(hvUsesExistence()&&textureSampleLevel(hvExistence,hvSampler,uvw,0.0).r<=0.0){
  hvStoreCache(voxel,vec3f(select(0.0,1.0,hv.flags.z==1u)));
  return;
 }
 let boundsMin=hv.boundsOrigin.xyz-hv.boundsExtent.xyz;
 let local=uvw*hv.boundsExtent.xyz*2.0+boundsMin;
 let world=(hv.localToWorld*vec4f(local,1.0)).xyz;
 let extinction=hvSampleExtinction(local,world);
 if(all(extinction<vec3f(1.0e-7))){hvStoreCache(voxel,vec3f(select(0.0,1.0,hv.flags.z==1u)));return;}
 // Mode 1 caches the transmittance toward the one light of the pass, mode 2 the in-scattered light of all of them.
 if(hv.flags.z==1u){hvStoreCache(voxel,hvTransmittanceToLight(world));return;}
 hvStoreCache(voxel,hvInscatteringAt(world,hvShadowBias())*hvPreExposure());
}
/** The existence mask: one where the volume has extinction at the centre of the voxel of the grid hvCacheOut is, zero where it has none
 *  (RenderExistenceMaskWithLiveShadingCS). */
@compute @workgroup_size(4,4,4)
fn hvExistenceMain(@builtin(global_invocation_id) voxel:vec3u){
 hvInit();
 let size=textureDimensions(hvCacheOut);
 if(any(voxel>=size)){return;}
 let uvw=(vec3f(voxel)+vec3f(0.5))/vec3f(size);
 let local=uvw*hv.boundsExtent.xyz*2.0+hv.boundsOrigin.xyz-hv.boundsExtent.xyz;
 let world=(hv.localToWorld*vec4f(local,1.0)).xyz;
 textureStore(hvCacheOut,vec3i(voxel),vec4f(select(0.0,1.0,any(hvSampleExtinction(local,world)>vec3f(0.0))),0.0,0.0,1.0));
}
/** The mask dilated: one where the trilinear read of the mask at the voxel's corner, which averages the eight voxels round it, is
 *  not zero (DilateExistenceMaskCS). The mask is read from hvCacheIn. */
@compute @workgroup_size(4,4,4)
fn hvDilateMain(@builtin(global_invocation_id) voxel:vec3u){
 let size=textureDimensions(hvCacheOut);
 if(any(voxel>=size)){return;}
 let seen=textureSampleLevel(hvCacheIn,hvSampler,vec3f(voxel)/vec3f(size),0.0).r;
 textureStore(hvCacheOut,vec3i(voxel),vec4f(select(0.0,1.0,seen>0.0),0.0,0.0,1.0));
}
/** The march of the ray of each pixel of the downsampled image through the volume: added to the
 *  radiance image, its alpha the transmittance left (RenderSingleScatteringWithLiveShading). */
@compute @workgroup_size(8,8,1)
fn hvLiveShadingMain(@builtin(global_invocation_id) id:vec3u){
 hvInit();
 let scaled=(hvViewSize()+vec2u(hvDownsample())-vec2u(1u))/vec2u(hvDownsample());
 if(any(id.xy>=scaled)){return;}
 let pixel=id.xy+hvViewMin()/vec2u(hvDownsample());
 let viewPixel=id.xy*hvDownsample()+hvViewMin();
 let previous=hvLoadLighting(pixel);
 let previousTransmittance=previous.a;
 // The beer map of the camera (composited with the translucency): this volume's data, what the volumes before it left, combined by expansion
 // (InitializeBeerShadowMapData, CombineBeerShadowMapData); the first volume starts from a map that holds nothing.
 let cameraMap=hvCameraBeer();
 var beerData=vec4f(hv.limits.x,0.0,previousTransmittance,previousTransmittance);
 var beerBefore=vec4f(hv.limits.x,0.0,1.0,1.0);
 if(cameraMap&&hvView.flags.x==0u){beerBefore=textureLoad(hvBeerPrevious,vec2i(pixel),0);}
 let jitter=select(0.0,hvBlueNoise(viewPixel),hv.limits.w>0.5);
 let pixelRay=hvPixelRay(vec2f(viewPixel));
 let depth=min(pixelRay.depth,hv.limits.x);
 let rayLength=depth*pixelRay.perDepth;
 let localOrigin=(hv.worldToLocal*vec4f(pixelRay.origin,1.0)).xyz;
 let localEnd=(hv.worldToLocal*vec4f(pixelRay.origin+pixelRay.direction*rayLength,1.0)).xyz;
 var localDirection=localEnd-localOrigin;
 let localLength=length(localDirection);
 localDirection/=localLength;
 let span=hvIntersectAabb(localOrigin,localDirection,0.0,localLength,hv.boundsOrigin.xyz-hv.boundsExtent.xyz,hv.boundsOrigin.xyz+hv.boundsExtent.xyz);
 if(span.y-span.x<=0.0){
  // The ray misses the volume: the image and the map go on as they were, the next pass reading what this one wrote.
  hvStoreLighting(pixel,previous);
  if(cameraMap){textureStore(hvBeerOut,vec2i(pixel),select(beerBefore,beerCombine(beerBefore,beerData),hv.flags.x!=0u));}
  return;
 }
 var ray=hvMakeRay(localOrigin,localDirection,span.x,span.y,pixelRay.origin,pixelRay.direction,jitter,hvViewStepSize(localDirection),u32(hv.limits.z),hv.flags.x!=0u,hv.flags.y!=0u);
 var radiance=vec3f(0.0);
 var transmittance=vec3f(previousTransmittance);
 var atFirst=vec3f(previousTransmittance);
 var scatterT=ray.tMax;
 if(hvUsesBoxes()){
  // Only the spans of the voxels the ray meets are marched, nearest first, each from its own start; the ray goes on past a voxel's far end
  // (RenderSingleScatteringWithPreshadingRGS). Every distance is the local ray's: the reference mixes the local one and the world's.
  var hit=hvNextVoxelSpan(localOrigin,localDirection,span.x,span.y);
  while(hit.y>hit.x&&dot(transmittance,vec3f(0.2126,0.7152,0.0722))>0.001){
   var part=ray;
   part.tMin=hit.x;
   part.tMax=hit.y;
   let partCount=hvStepCount(&part);
   var partFirst=vec3f(0.0);
   let found=hvRayMarch(part,partCount,&radiance,&transmittance,&partFirst);
   if(scatterT==ray.tMax&&found<part.tMax){scatterT=found;atFirst=partFirst;}
   hit=hvNextVoxelSpan(localOrigin,localDirection,hit.y+max(0.001,abs(hit.y)*0.000001),span.y);
  }
 }else{
  let count=hvStepCount(&ray);
  scatterT=hvRayMarch(ray,count,&radiance,&transmittance,&atFirst);
 }
 // A volume that holds out adds no light to the image: it leaves its opacity in the holdout.
 let holdsOut=hvHoldsOut();
 if(holdsOut){radiance=vec3f(0.0);}
 var result=vec4f(previous.rgb+radiance*hvPreExposure(),previous.a);
 if(hv.flags.x!=0u){
  result.a=dot(transmittance,vec3f(0.2126,0.7152,0.0722));
  if(holdsOut){hvHoldoutAdd(pixel,previousTransmittance-result.a);}
  // Where the ray met extinction the data runs from its first place to the end of the ray (the reference trims no further: exponential
  // interpolation needs the end), the transmittance at the first and the one left.
  if(scatterT<ray.tMax){
   beerData=vec4f(scatterT*ray.toWorldScale,ray.tMax*ray.toWorldScale,dot(atFirst,vec3f(0.2126,0.7152,0.0722)),result.a);
  }
  // The pixel this volume turns opaque writes the velocity of the point where the ray first met it.
  if(scatterT<ray.tMax&&1.0-previousTransmittance<0.5&&1.0-result.a>0.5){
   hvWriteVelocity(viewPixel,pixelRay.origin+pixelRay.direction*(scatterT*ray.toWorldScale));
  }
 }
 hvStoreLighting(pixel,result);
 if(cameraMap){textureStore(hvBeerOut,vec2i(pixel),select(beerBefore,beerCombine(beerBefore,beerData),hv.flags.x!=0u));}
}
`,
)

/**
 * THE COMPOSITION (HeterogeneousVolumesComposite.usf): the volume's image upsampled to the view
 * (nearest or bilinear), then filtered (bilateral, 3x3 or 5x5 Gaussian); the pass blends the result
 * over the lit image, the volume's radiance added and the image times the transmittance the volume
 * left. The program declares hvDownsampled(pixel)->vec4f (the volume's image, at its own pixel),
 * hvDownsampledAt(uv)->vec4f (bilinear), the view's rectangle, the downsample and the modes
 * (hvUpsampleMode, hvFilterMode, hvFilterWidth) and hvResolution() (the upsampled image's size). One pass upsamples by
 * the factor of one iteration (hvDownsample) and filters; the reference iterates by 3 or 2 until the view's size.
 */
export const HV_COMPOSITE_WGSL = wgslBlock(
  'HV_COMPOSITE_WGSL',
  [],
  `
/** The volume's image at a pixel of the upsampled one: the pixel it covers (mode 1), or its bilinear sample (mode 2) at the
 *  pixel's centre (the reference adds half the factor instead of half a pixel, shifting the image: corrected). */
fn hvUpsampled(viewPixel:vec2u)->vec4f{
 if(hvUpsampleMode()==2u){
  let uv=(vec2f(viewPixel)+vec2f(0.5))/hvResolution();
  return hvDownsampledAt(clamp(uv,vec2f(0.0),vec2f(hvViewMin()+hvViewSize()-vec2u(1u))/hvResolution()));
 }
 return hvDownsampled(viewPixel/vec2u(hvDownsample()));
}
const HV_GAUSS3=array<f32,9>(1.0,2.0,1.0,2.0,4.0,2.0,1.0,2.0,1.0);
const HV_GAUSS5=array<f32,25>(1.0,4.0,7.0,4.0,1.0,4.0,16.0,26.0,16.0,4.0,7.0,26.0,41.0,26.0,7.0,4.0,16.0,26.0,16.0,4.0,1.0,4.0,7.0,4.0,1.0);
/** The upsampled image at a pixel filtered by the mode: 1 bilateral of the width, 2 Gaussian 3x3, 3 Gaussian 5x5; 0 unchanged. */
fn hvFiltered(pixel:vec2i)->vec4f{
 let mode=hvFilterMode();
 let low=vec2i(hvViewMin());
 let high=vec2i(hvViewMin()+hvViewSize())-vec2i(1);
 let centre=hvUpsampled(vec2u(pixel));
 if(mode==1u){
  let width=i32(hvFilterWidth());
  var sum=vec4f(0.0);
  var weights=0.0;
  let reach=width/2;
  let radius=max(2.0*f32(width*width),1.0);
  for(var x=0;x<width;x++){for(var y=0;y<width;y++){
   let offset=vec2i(x,y)-vec2i(reach);
   let at=clamp(pixel+offset,low,high);
   let weight=max(radius-f32(dot(offset,offset)),0.0);
   let value=hvUpsampled(vec2u(at));
   let delta=centre.rgb-value.rgb;
   let radianceWeight=saturate(1.0-dot(delta,delta));
   let tau=centre.a-value.a;
   let tauWeight=1.0-tau*tau;
   sum+=value*(weight*radianceWeight*tauWeight);
   weights+=weight*radianceWeight*tauWeight;
  }}
  return sum/weights;
 }
 if(mode==2u||mode==3u){
  let reach=select(1,2,mode==3u);
  let side=2*reach+1;
  var sum=vec4f(0.0);
  var weights=0.0;
  for(var x=0;x<side;x++){for(var y=0;y<side;y++){
   let at=clamp(pixel+vec2i(x,y)-vec2i(reach),low,high);
   let weight=select(HV_GAUSS3[y*3+x],HV_GAUSS5[y*5+x],mode==3u);
   sum+=hvUpsampled(vec2u(at))*weight;
   weights+=weight;
  }}
  return sum/weights;
 }
 return centre;
}
`,
)
