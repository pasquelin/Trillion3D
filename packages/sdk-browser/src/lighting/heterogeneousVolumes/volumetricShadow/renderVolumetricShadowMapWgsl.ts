import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { VG_EVAL_WGSL } from '../voxelGrid/gridEvalWgsl.ts'
import { HV_INTERSECT_AABB } from '../intersectAabbWgsl.ts'
import { AVSM_LIST_EDIT_WGSL } from './avsmListEditWgsl.ts'
import { AVSM_WGSL } from './avsmWgsl.ts'

/** The bytes of the render's parameters (`AvsmRenderParams`). */
export const AVSM_RENDER_PARAMS_BYTES = 480

/**
 * THE VOLUMETRIC SHADOW MAP OF A LIGHT, OR OF THE CAMERA, FROM THE VOXEL GRIDS: for each texel of a face, the ray from its near plane to its
 * far plane is cut by the grids' bounds and marched in steps of the shadow step (a blue-noise offset in the first when jittering), the
 * extinction of the grids read at each point; a sample (the distance, the luminance of the transmittance) is added to the texel's linked
 * list whenever the transmittance leaves the straight line the last sample's extinction would have kept it on, by more than both the
 * absolute and the relative error. The list ends with the transmittance at the end of the march, and a ray that meets no grid is a list of
 * one sample at distance 0.
 *
 * Bindings: 0 the parameters (uniform: the face matrices from texel space to the world, `shadowToWorld`), 1 the grids' parameters
 * (uniform), 2 the ortho grid's top-level cells, 3 its indirection cells, 4 its extinction cells, 5 the frustum grid's top-level cells,
 * 6 its extinction cells (all read-only storage), 7 the linked lists (storage), 8 the debug strip (a storage texture), 9 the blue noise.
 * The face `params.debugTweak` also writes its transmittance to the strip.
 */
export const avsmRenderProgram = (format: 'rgba16float' | 'rgba32float') =>
  wgslProgram(
    `struct AvsmRenderParams{
 resolution:vec2i,
 maxSampleCount:i32,
 jitter:i32,
 stepSize:f32,
 maxStepCount:i32,
 debugTweak:i32,
 frameIndexMod8:u32,
 absoluteError:f32,
 relativeError:f32,
 compress:i32,
 pad0:f32,
 temporalJitter:vec4f,
 // The point the distances of the samples are measured from, where the fourth component is one; else from the start of the texel's ray.
 distanceFrom:vec4f,
 shadowToWorld:array<mat4x4f,6>,
}
@group(0) @binding(0) var<uniform> params:AvsmRenderParams;
@group(0) @binding(1) var<uniform> gridParams:VgGridParams;
@group(0) @binding(2) var<storage,read> gridOrthoTop:array<u32>;
@group(0) @binding(3) var<storage,read> gridIndirection:array<u32>;
@group(0) @binding(4) var<storage,read> gridExtinction:array<vec2u>;
@group(0) @binding(5) var<storage,read> gridFrustumTop:array<u32>;
@group(0) @binding(6) var<storage,read> gridFrustumExtinction:array<vec2u>;
@group(0) @binding(7) var<storage,read_write> avsmList:array<vec2u>;
@group(0) @binding(8) var debugMap:texture_storage_2d<${format},write>;

/** The step along the ray: the shadow step where it is set, else the smallest distance across a voxel of the ortho grid; 0.01 at least. */
fn avsmStepSize(direction:vec3f,extent:vec3f)->f32{
 var size=params.stepSize;
 if(size<=0.0){
  let voxel=extent/vec3f(max(gridParams.orthoResolution,vec3i(1)));
  let along=abs(voxel/direction);
  size=min(along.x,min(along.y,along.z));
 }
 return max(size,0.01);
}

@compute @workgroup_size(8,8,1)
fn renderVolumetricShadowMap(@builtin(global_invocation_id) id:vec3u){
 let pixel=id.xy;
 if(any(vec2i(pixel)>=params.resolution)){return;}
 let face=id.z;
 let linear=avsmLinearIndex(face,pixel,params.resolution);

 // The ray of the texel, from its near plane to its far plane.
 let uv=(vec2f(pixel)+params.temporalJitter.xy)/vec2f(params.resolution);
 let startH=params.shadowToWorld[face]*vec4f(uv,1.0,1.0);
 let endH=params.shadowToWorld[face]*vec4f(uv,0.0,1.0);
 let origin=startH.xyz/startH.w;
 var direction=endH.xyz/endH.w-origin;
 let rayLength=length(direction);
 direction/=rayLength;

 var boundsMin=gridParams.frustumMin;
 var boundsMax=gridParams.frustumMax;
 if(gridParams.useOrtho!=0){
  boundsMin=gridParams.orthoMin;
  boundsMax=gridParams.orthoMax;
 }
 let hit=hvIntersectAabb(origin,direction,0.0,rayLength,boundsMin,boundsMax);
 var hitT=hit.x;
 var transmittance=vec3f(1.0);
 let measured=select(0.0,length(origin-params.distanceFrom.xyz),params.distanceFrom.w>0.5);
 let pixelIndex=i32(linear)*params.maxSampleCount;
 let maxCount=params.maxSampleCount;
 let compress=params.compress!=0;

 if(hit.y-hit.x>0.0){
  let jitter=select(0.0,blueNoiseScalar(pixel,params.frameIndexMod8),params.jitter!=0);
  let extent=(boundsMax-boundsMin)*0.5;
  // The step, lengthened where the bounds' diagonal would take more than the most steps.
  var step=avsmStepSize(direction,extent);
  let diagonal=length(2.0*extent);
  if(u32(max(diagonal/step,1.0))>u32(params.maxStepCount)){step=diagonal/f32(params.maxStepCount);}
  let stepCount=max(u32(ceil(abs(hit.y-hit.x)/step)),1u);

  var expectedExtinction=vec3f(0.0);
  var expectedTransmittance=vec3f(1.0);
  var prevElement=i32(AVSM_NULL_PTR);
  var element=0;
  for(var stepIndex=0u;stepIndex<stepCount;stepIndex++){
   hitT=min(hit.x+step*(jitter+f32(stepIndex)),hit.y);
   let extinction=vgEvalExtinction(origin+direction*hitT);
   transmittance*=exp(-extinction*step);
   if(element==0){
    avsmAddSample(avsmSample(measured+hitT,luminance(transmittance)),pixelIndex,&prevElement,&element);
    expectedExtinction=extinction;
    expectedTransmittance=transmittance;
   }else{
    // A sample is kept when the transmittance has left the line the last sample's extinction would have followed.
    expectedTransmittance*=exp(-expectedExtinction*step);
    let absoluteError=length(transmittance-expectedTransmittance);
    let relativeError=length((transmittance-expectedTransmittance)/expectedTransmittance);
    if(absoluteError>params.absoluteError&&relativeError>params.relativeError){
     avsmAddOrReplaceSample(avsmSample(measured+hitT,luminance(transmittance)),pixelIndex,maxCount,compress,&prevElement,&element);
     expectedExtinction=extinction;
     expectedTransmittance=transmittance;
    }
   }
   if(all(transmittance<vec3f(1.0e-7))){transmittance=vec3f(0.0);break;}
  }
  // Stitch up the previous entry and end the list with the transmittance at the end of the march.
  if(prevElement!=i32(AVSM_NULL_PTR)){
   avsmList[pixelIndex+prevElement]=avsmListSetNext(avsmList[pixelIndex+prevElement],u32(element));
  }
  var last=avsmListSetSample(vec2u(0u),avsmSample(measured+hitT,luminance(transmittance)));
  last=avsmListSetPrev(last,u32(prevElement));
  avsmList[pixelIndex+element]=avsmListSetNext(last,AVSM_NULL_PTR);
 }else{
  var only=avsmListSetSample(vec2u(0u),avsmSample(0.0,luminance(transmittance)));
  only=avsmListSetPrev(only,AVSM_NULL_PTR);
  avsmList[pixelIndex]=avsmListSetNext(only,AVSM_NULL_PTR);
 }
 if(i32(face)==params.debugTweak){
  textureStore(debugMap,vec2i(pixel),vec4f(transmittance,1.0));
 }
}`,
    [
      AVSM_WGSL,
      AVSM_LIST_EDIT_WGSL,
      VG_EVAL_WGSL,
      HV_INTERSECT_AABB,
      luminance,
      blueNoiseWgsl(0, 9),
    ],
  )
