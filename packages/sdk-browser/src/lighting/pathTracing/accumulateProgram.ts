import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { PT_ADAPTIVE_UTILS_WGSL } from './adaptiveUtilsWgsl.ts'
import { PT_STATE_WGSL } from './pathWgsl.ts'
import { PT_VIEW_WGSL } from './viewWgsl.ts'

/** The bindings of the accumulation programs' group 0: the parameters (read at the dynamic offset of the dispatch), the paths' states and queue, the accumulated images of the image before (read)
 *  and this image's (written), the variance of the image before and this image's, the sizes of the variance's chain with the error that stops a pixel, and the depth of the image before (read) and this image's (written). */
export const PT_ACCUMULATE_BINDINGS = {
  view: 0,
  states: 2,
  queue: 3,
  radianceIn: 10,
  albedoIn: 11,
  normalIn: 12,
  radianceOut: 13,
  albedoOut: 14,
  normalOut: 15,
  varianceIn: 16,
  varianceOut: 17,
  varianceDims: 18,
  depthIn: 19,
  depthOut: 20,
} as const

const B = PT_ACCUMULATE_BINDINGS

export const PT_ACCUMULATE_ENTRIES = {
  resolve: 'ptResolve',
  variance: 'ptResolveVariance',
  adaptiveStart: 'ptAdaptiveStart',
} as const

/**
 * THE END OF A SAMPLE, once every bounce has run: the pixels the sample traced (the bit `ptStorePath` set, cleared here) are written to the images that accumulate.
 * `ptResolveVariance` first (it reads the state's bit): the variance's first level takes the luminance of the pixel's radiance and its square, blended by one over the samples
 * gathered (the weights of a running mean), and the count. `ptResolve` then blends the radiance, with its alpha, the albedo and the normal into the image before, by the blend factor of the
 * image (one over the samples, `limits.w`) or, with adaptive sampling, the pixel's own (one over its count): the first sample of a restart (`iteration` 0) reads nothing of the image before, which holds
 * what the last accumulation left. Two textures of each image, one read and one written, because a storage texture is not read and written by one kernel on every device
 * and the albedo and normal and the variance cannot all be written by one dispatch of four storage textures; the pixels a sample did not trace are copied across by the host.
 * The depth of the camera's hit (`PtPath.depth`, the device depth the frame stores, 0 where the ray escaped) accumulates by the nearest of the samples (the largest, the depth being reversed), as the
 * reference keeps it. `ptAdaptiveStart` fills the list of the first bounce with the pixels that still need samples (`ptSampleFactor` over the variance's chain above 1) and counts them.
 */
export const PT_ACCUMULATE_WGSL = wgslProgram(
  `@group(0) @binding(${B.view}) var<uniform> ptView:PtView;
@group(0) @binding(${B.states}) var<storage,read_write> ptStates:array<PtState>;
@group(0) @binding(${B.queue}) var<storage,read_write> ptQueue:array<atomic<u32>>;
@group(0) @binding(${B.radianceIn}) var ptRadianceIn:texture_2d<f32>;
@group(0) @binding(${B.albedoIn}) var ptAlbedoIn:texture_2d<f32>;
@group(0) @binding(${B.normalIn}) var ptNormalIn:texture_2d<f32>;
@group(0) @binding(${B.radianceOut}) var ptRadianceOut:texture_storage_2d<rgba32float,write>;
@group(0) @binding(${B.albedoOut}) var ptAlbedoOut:texture_storage_2d<rgba16float,write>;
@group(0) @binding(${B.normalOut}) var ptNormalOut:texture_storage_2d<rgba16float,write>;
@group(0) @binding(${B.varianceIn}) var ptVariance:texture_2d<f32>;
@group(0) @binding(${B.varianceOut}) var ptVarianceOut:texture_storage_2d<rgba32float,write>;
@group(0) @binding(${B.varianceDims}) var<uniform> ptVarianceDims:vec4u;
@group(0) @binding(${B.depthIn}) var ptDepthIn:texture_2d<f32>;
@group(0) @binding(${B.depthOut}) var ptDepthOut:texture_storage_2d<r32float,write>;
fn ptTracedAt(local:vec2u)->bool{
 return ((ptStates[local.x+local.y*ptView.tile.z].identity.w>>8u)&1u)!=0u;
}
@compute @workgroup_size(8,8,1)
fn ${PT_ACCUMULATE_ENTRIES.variance}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=ptView.tile.zw)||!ptTracedAt(id.xy)){return;}
 let pixel=vec2i(ptView.tile.xy+id.xy);
 let state=ptStates[id.x+id.y*ptView.tile.z];
 let was=select(vec4f(0.0),textureLoad(ptVariance,pixel,0),ptView.image.w>0u);
 let blend=1.0/(was.z+1.0);
 let lum=luminance(state.radiance.xyz);
 textureStore(ptVarianceOut,pixel,vec4f(mix(was.xy,vec2f(lum,lum*lum),blend),was.z+1.0,0.0));
}
@compute @workgroup_size(8,8,1)
fn ${PT_ACCUMULATE_ENTRIES.resolve}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=ptView.tile.zw)||!ptTracedAt(id.xy)){return;}
 let index=id.x+id.y*ptView.tile.z;
 let pixel=vec2i(ptView.tile.xy+id.xy);
 let state=ptStates[index];
 let again=ptView.image.w>0u;
 let samples=select(0.0,textureLoad(ptVariance,pixel,0).z,again)+1.0;
 let blend=select(ptView.limits.w,1.0/samples,ptView.flags.z!=0u);
 let path=ptLoadPath(index);
 let radiance=select(vec4f(0.0),textureLoad(ptRadianceIn,pixel,0),again);
 let albedo=select(vec4f(0.0),textureLoad(ptAlbedoIn,pixel,0),again);
 let normal=select(vec4f(0.0),textureLoad(ptNormalIn,pixel,0),again);
 textureStore(ptRadianceOut,pixel,mix(radiance,vec4f(path.radiance,path.alpha),blend));
 textureStore(ptAlbedoOut,pixel,vec4f(mix(albedo.xyz,path.albedo,blend),albedo.w));
 textureStore(ptNormalOut,pixel,vec4f(mix(normal.xyz,path.normal,blend),normal.w));
 let seen=select(0.0,textureLoad(ptDepthIn,pixel,0).r,again);
 textureStore(ptDepthOut,pixel,vec4f(max(seen,path.depth),0.0,0.0,0.0));
 ptStates[index].identity.w=state.identity.w&~(1u<<8u);
}
@compute @workgroup_size(8,8,1)
fn ${PT_ACCUMULATE_ENTRIES.adaptiveStart}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=ptView.tile.zw)){return;}
 let factor=ptSampleFactor(ptView.tile.xy+id.xy,ptView.sampling.x);
 if(factor>1.0){
  let slot=atomicAdd(&ptQueue[0u],1u);
  atomicStore(&ptQueue[ptView.counts.w+slot],id.x+id.y*ptView.tile.z);
 }
}`,
  [PT_VIEW_WGSL, PT_STATE_WGSL, PT_ADAPTIVE_UTILS_WGSL, luminance],
)
