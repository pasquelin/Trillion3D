import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { HV_RAY_MARCH_WGSL } from './liveShadingWgsl.ts'

/**
 * THE VOLUME'S AMBIENT OCCLUSION (RenderAmbientOcclusionWithLiveShadingCS, HeterogeneousVolumesAmbientOcclusionPipeline.usf:313-366):
 * a voxel of a coarser grid over the volume's bounds holds the mean transmittance of the rays that leave its centre over the whole
 * sphere (the equal-area mapping of a square of rays, `MonteCarlo.ush:159`), each marched through the volume as a shadow ray. The indirect
 * light is multiplied by it where it is read (`hvAmbientOcclusion`, `RayMarchingUtils.ush:270`).
 *
 * The reference's rays run in separate threads and add their share to the voxel as a 16-bit fixed-point number, each share cut
 * to an integer before the sum, which loses up to a ray's count of units of 1/65535; here one thread walks the rays and sums floats
 * (declared). The voxels away from any extinction, by a dilated mask (`UseExistenceMask`, `hvExistenceMain`, `hvDilateMain`), are given 1
 * without a ray, as the reference does. The pass declares the volume's
 * reads (`liveShadingWgsl.ts`), writes the occlusion in the red channel of hvCacheOut (a 3D texture of the occlusion's resolution)
 * and takes from the view's words: the rays along each side, the farthest ray (a float), the most steps.
 */
export const HV_AMBIENT_OCCLUSION_WGSL = wgslBlock(
  'HV_AMBIENT_OCCLUSION_WGSL',
  [HV_RAY_MARCH_WGSL],
  `
fn hvEquiArea(uvIn:vec2f)->vec3f{
 let uv=2.0*uvIn-vec2f(1.0);
 let d=1.0-(abs(uv.x)+abs(uv.y));
 let r=1.0-abs(d);
 let phi=select(0.7853981633974483*((abs(uv.y)-abs(uv.x))/r+1.0),0.0,r==0.0);
 let f=r*sqrt(2.0-r*r);
 return vec3f(f*sign(uv.x)*abs(cos(phi)),f*sign(uv.y)*abs(sin(phi)),sign(d)*(1.0-r*r));
}
@compute @workgroup_size(4,4,4)
fn hvAmbientOcclusionMain(@builtin(global_invocation_id) id:vec3u){
 hvInit();
 let size=textureDimensions(hvCacheOut);
 if(any(id>=size)){return;}
 let rays=vec2u(hvView.svt0.x,hvView.svt0.y);
 let maxDistance=bitcast<f32>(hvView.svt0.z);
 let uvw=(vec3f(id)+vec3f(0.5))/vec3f(size);
 let local=uvw*hv.boundsExtent.xyz*2.0+hv.boundsOrigin.xyz-hv.boundsExtent.xyz;
 let origin=(hv.localToWorld*vec4f(local,1.0)).xyz;
 var sum=0.0;
 // A voxel away from any extinction (the dilated mask) is open to every ray: one.
 if(hvUsesExistence()&&textureSampleLevel(hvExistence,hvSampler,uvw,0.0).r<=0.0){
  textureStore(hvCacheOut,vec3i(id),vec4f(1.0,0.0,0.0,1.0));
  return;
 }
 for(var y=0u;y<rays.y;y++){for(var x=0u;x<rays.x;x++){
  let direction=hvEquiArea((vec2f(f32(x),f32(y))+vec2f(0.5))/vec2f(rays));
  sum+=dot(hvComputeTransmittance(origin,direction*maxDistance,hvView.svt0.w),vec3f(0.2126,0.7152,0.0722));
 }}
 textureStore(hvCacheOut,vec3i(id),vec4f(sum/f32(rays.x*rays.y),0.0,0.0,1.0));
}
`,
)
