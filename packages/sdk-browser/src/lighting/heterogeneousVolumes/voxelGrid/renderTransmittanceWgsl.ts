import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { HV_FORMAT, HV_PIXEL_RAY_READ, HV_VIEW } from '../liveShadingProgram.ts'
import { VG_TRACKING_WGSL } from './gridTrackingWgsl.ts'

/** The ways the transmittance through the grids can be found, the debug mode less one (`RenderTransmittanceWithVoxelGridCS` permutations). */
export const VG_TRANSMITTANCE_MODES = [
  'dda-marching',
  'sample-marching',
  'sample-majorant',
  'sample-max-majorant',
  'sample-majorant-dda',
  'delta-tracking',
  'ratio-tracking',
  'spectral-ratio-tracking',
  'tracking-majorant-dda',
] as const

/** The bytes of the parameters: the farthest the rays go, in the first word. */
export const VG_TRANSMITTANCE_PARAMS_BYTES = 16

/**
 * THE TRANSMITTANCE THROUGH THE VOXEL GRIDS SEEN FROM THE CAMERA (`RenderTransmittanceWithVoxelGridCS`), one program for each way of finding it
 * (`VG_TRANSMITTANCE_MODES`, the permutation `mode`): the ray of each pixel of the volumes' image, as far as the opaque surface or the
 * farthest trace, is followed through the grids, and the pixel takes the transmittance's luminance in its alpha, and in its colour what the
 * way gathers: one minus the transmittance for the ways by samples, the radiance and the emission of the opacity left by the ways by tracking,
 * nothing for the walk cell by cell.
 *
 * - 0 walks the frustum grid, where there is one, from the near to the far plane or the surface, and the ortho grid on the rest of the ray.
 * - 1 to 4 follow the ray in the span the ortho grid's bounds cut, by samples: steps (the first offset by a random fraction of a step),
 *   the majorant of the cell under each step, the greatest majorant of the grid, or the cells of the majorant grid in turn, each by samples.
 * - 5 to 8 track it with the grid's greatest majorant as sigmaBar: spectral weighted delta tracking, ratio tracking, spectral ratio
 *   tracking, or the cells of the majorant grid in turn, each by delta tracking.
 *
 * Bindings: 0 the parameters (uniform), 1 the grids' parameters (uniform), 2 the ortho grid's top-level cells, 3 its indirection cells, 4 its
 * extinction cells, 5 the frustum grid's top-level cells, 6 its extinction cells, 7 the ortho grid's emission and scattering cells, 8 its
 * majorant cells (all read-only storage), 9 the view (uniform), 10 the opaque depth, 11 the image the pass writes (a storage texture).
 */
export const renderTransmittanceProgram = (mode: number) => {
  if (!Number.isInteger(mode) || mode < 0 || mode >= VG_TRANSMITTANCE_MODES.length)
    throw new Error(
      `the transmittance through the grids has ${VG_TRANSMITTANCE_MODES.length} ways, not ${mode}`,
    )
  return wgslProgram(
    `struct VgTransmittanceParams{limits:vec4f,}
@group(0) @binding(0) var<uniform> transmittanceParams:VgTransmittanceParams;
@group(0) @binding(1) var<uniform> gridParams:VgGridParams;
@group(0) @binding(2) var<storage,read> gridOrthoTop:array<u32>;
@group(0) @binding(3) var<storage,read> gridIndirection:array<u32>;
@group(0) @binding(4) var<storage,read> gridExtinction:array<vec2u>;
@group(0) @binding(5) var<storage,read> gridFrustumTop:array<u32>;
@group(0) @binding(6) var<storage,read> gridFrustumExtinction:array<vec2u>;
@group(0) @binding(7) var<storage,read> gridMaterial:array<vec4u>;
@group(0) @binding(8) var<storage,read> gridMajorant:array<vec2u>;
@group(0) @binding(9) var<uniform> hvView:HvView;
@group(0) @binding(10) var hvDepth:texture_depth_2d;
@group(0) @binding(11) var transmittanceImage:texture_storage_2d<${HV_FORMAT},write>;

const TRANSMITTANCE_MODE=${mode};

/** The transmittance of the frustum grid along the pixel's ray, from the near plane's depth to the far plane's or the surface's. The
 *  ray's span in the frustum grid is given back along the camera's ray (the reference adds the near offset to the whole of the ray's
 *  span, past its end: corrected). */
fn transmittanceInFrustum(ray:HvPixelRay,sceneDepth:f32,span:ptr<function,vec2f>)->vec3f{
 var transmittance=vec3f(1.0);
 let nearDepth=min(sceneDepth,gridParams.nearDepth);
 let farDepth=min(sceneDepth,gridParams.farDepth);
 let nearPoint=ray.origin+ray.direction*(nearDepth*ray.perDepth);
 let farPoint=ray.origin+ray.direction*(farDepth*ray.perDepth);
 let viewNear=(gridParams.worldToView*vec4f(nearPoint,1.0)).xyz;
 let viewFar=(gridParams.worldToView*vec4f(farPoint,1.0)).xyz;
 var voxelDirection=vgViewToVoxel(viewFar)-vgViewToVoxel(viewNear);
 let voxelLength=length(voxelDirection);
 voxelDirection/=voxelLength;
 let worldLength=length(farPoint-nearPoint);
 vgMarchTopLevel(true,false,vgViewToVoxel(viewNear),voxelDirection,0.0,voxelLength,worldLength,gridParams.frustumResolution,&transmittance);
 let offset=length(nearPoint-ray.origin);
 *span=vec2f(offset,offset+worldLength);
 return transmittance;
}

@compute @workgroup_size(8,8,1)
fn renderTransmittanceWithVoxelGrid(@builtin(global_invocation_id) id:vec3u){
 let downsample=hvView.flags.y;
 let scaled=(hvView.rect.zw+vec2u(downsample)-vec2u(1u))/vec2u(downsample);
 if(any(id.xy>=scaled)){return;}
 let pixel=id.xy+hvView.rect.xy/vec2u(downsample);
 let viewPixel=id.xy*downsample+hvView.rect.xy;
 let ray=hvPixelRay(vec2f(viewPixel));
 let sceneDepth=min(ray.depth,transmittanceParams.limits.x);
 let rayLength=sceneDepth*ray.perDepth;
 let linearIndex=id.y*((scaled.x+7u)/8u*8u)+id.x;
 var sequence=randomSequenceCreate(linearIndex,hvView.flags.z);
 let jitter=randomDraw(&sequence);
 var radiance=vec3f(0.0);
 var transmittance=vec3f(1.0);
 let clip=hvIntersectAabb(ray.origin,ray.direction,0.0,rayLength,gridParams.orthoMin,gridParams.orthoMax);
 if(TRANSMITTANCE_MODE==0){
  var span=vec2f(0.0);
  if(gridParams.useFrustum!=0){transmittance=transmittanceInFrustum(ray,sceneDepth,&span);}
  if(gridParams.useOrtho!=0){
   if(gridParams.useFrustum!=0&&span.x<span.y){
    transmittance*=vgTraceOrtho(ray.origin,ray.direction,0.0,span.x);
    transmittance*=vgTraceOrtho(ray.origin,ray.direction,span.y,rayLength);
   }else{
    transmittance=vgTraceOrtho(ray.origin,ray.direction,0.0,rayLength);
   }
  }
 }else if(TRANSMITTANCE_MODE<5){
  if(clip.x<clip.y){
   let stepSize=trackStepSize(ray.direction);
   let start=clip.x+jitter*stepSize;
   var result:TrackingResult;
   if(TRANSMITTANCE_MODE==1){
    result=trackSampleBasedMarch(ray.origin,ray.direction,start,clip.y,stepSize);
   }else if(TRANSMITTANCE_MODE==2){
    result=trackSampleBasedMajorantMarch(ray.origin,ray.direction,start,clip.y,stepSize);
   }else if(TRANSMITTANCE_MODE==3){
    result=trackSampleBasedMaxMajorantMarch(ray.origin,ray.direction,start,clip.y,stepSize);
   }else{
    result=trackDdaMajorantMarch(ray.origin,ray.direction,clip.x,clip.y,false,&sequence);
   }
   transmittance=result.throughput;
  }
  radiance=vec3f(1.0)-transmittance;
 }else{
  if(clip.x<clip.y){
   let sigmaBar=vgMajorantOf(gridMajorant[0]);
   sequence=randomSequenceCreate(linearIndex,hvView.flags.z);
   var result:TrackingResult;
   if(TRANSMITTANCE_MODE==5){
    result=trackSpectralWeightedDelta(ray.origin,ray.direction,clip.x,clip.y,sigmaBar,&sequence);
   }else if(TRANSMITTANCE_MODE==6){
    result=trackRatio(ray.origin,ray.direction,clip.x,clip.y,sigmaBar,&sequence);
   }else if(TRANSMITTANCE_MODE==7){
    result=trackSpectralRatio(ray.origin,ray.direction,clip.x,clip.y,sigmaBar,&sequence);
   }else{
    result=trackDdaMajorantMarch(ray.origin,ray.direction,clip.x,clip.y,true,&sequence);
   }
   radiance=result.radiance+(vec3f(1.0)-result.throughput);
   transmittance=result.throughput;
  }
 }
 textureStore(transmittanceImage,vec2i(pixel),vec4f(radiance,luminance(transmittance)));
}`,
    [HV_VIEW, HV_PIXEL_RAY_READ, VG_TRACKING_WGSL, luminance],
  )
}
