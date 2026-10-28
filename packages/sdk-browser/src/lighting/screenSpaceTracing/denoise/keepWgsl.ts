import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { SCREEN_SPACE_INPUTS_WGSL, SCREEN_SPACE_SURFACE_WGSL } from '../rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP_SIDE } from '../screenSpaceQuality.ts'
import { SCREEN_SPACE_GROUP } from '../screenSpaceView.ts'
import { DENOISE_BINDINGS as D } from './denoiseView.ts'

/**
 * THE SURFACE KEPT FOR THE NEXT IMAGE (`keepCompute`, a thread a pixel of the view): the depth the image drew (zero where nothing is) and its normal with the
 * roughness, the metadata the accumulation in time compares the surface it finds in the last image with.
 */
export const keepWgsl = () =>
  wgslProgram(
    `@group(${SCREEN_SPACE_GROUP}) @binding(${D.keepDepth}) var keepDepthOut:texture_storage_2d<r32float,write>;
@group(${SCREEN_SPACE_GROUP}) @binding(${D.keepNormals}) var keepNormalsOut:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn keepCompute(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=ssView.size.xy)){return;}
 let pixel=vec2i(id.xy);
 let surface=ssSurfaceAt(pixel);
 textureStore(keepDepthOut,pixel,vec4f(hizOpaqueDepth(pixel),0.0,0.0,0.0));
 textureStore(keepNormalsOut,pixel,vec4f(surface.N,surface.roughness));
}`,
    [SCREEN_SPACE_INPUTS_WGSL, SCREEN_SPACE_SURFACE_WGSL],
  )
