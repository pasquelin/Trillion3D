import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { HV_RAY_MARCH_WGSL } from './liveShadingWgsl.ts'

/**
 * THE BAKE OF A VOLUME'S MATERIAL (`HeterogeneousVolumesBakeMaterialCS`, `HeterogeneousVolumesMaterialBakingPipeline.usf:56-117`): for each voxel of the
 * texture hvCacheOut, the volume's material evaluated at a point of the voxel, written as one of its three outputs, chosen by the view's first word
 * (0 extinction, 1 albedo, 2 emission). The point is the voxel's centre, or a place in it drawn from the blue noise where the jitter is on
 * (the limits' last word); the view's second word is the pixel format (0 keeps the red channel alone). The reference clamps the coordinate to the
 * volume's resolution, which bounds nothing; it is held to 1 here.
 */
export const HV_BAKE_WGSL = wgslBlock(
  'HV_BAKE_WGSL',
  [HV_RAY_MARCH_WGSL],
  `
@compute @workgroup_size(4,4,4)
fn hvBakeMain(@builtin(global_invocation_id) voxel:vec3u){
 hvInit();
 let size=textureDimensions(hvCacheOut);
 if(any(voxel>=size)){return;}
 var jitter=vec3f(0.5);
 if(hv.limits.w>0.5){
  let at=vec2u(voxel.y*size.x+voxel.x,voxel.z);
  jitter=vec3f(blueNoiseVec2(at,hvView.flags.z%8u),blueNoiseScalar(at,hvView.flags.z%8u));
 }
 let uvw=clamp((vec3f(voxel)+jitter)/vec3f(size),vec3f(0.0),vec3f(1.0));
 let local=uvw*2.0*hv.boundsExtent.xyz+hv.boundsOrigin.xyz-hv.boundsExtent.xyz;
 let world=(hv.localToWorld*vec4f(local,1.0)).xyz;
 var value:vec3f;
 if(hvView.svt0.x==0u){value=hvSampleExtinction(local,world);}
 else if(hvView.svt0.x==1u){value=hvSampleAlbedo(local,world);}
 else{value=hvSampleEmission(local,world);}
 if(hvView.svt0.y==0u){value=vec3f(value.x,0.0,0.0);}
 textureStore(hvCacheOut,vec3i(voxel),vec4f(value,1.0));
}
`,
)
