import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { viewDepthCmOfDevice } from '../../../../../math/src/wgsl/projection.ts'
import { hizDepthWgsl } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import { DFAO_COMMON_WGSL, DFAO_FAR_CM } from './commonWgsl.ts'
import { AO_DOWNSAMPLE, TILE_SIZE } from './cones.ts'
import { DFAO_BINDING as B, DFAO_NORMAL_FORMAT } from './layout.ts'

/**
 * THE NORMALS AND DEPTHS GRID (`dfaoNormals`), the grid every other pass of the occlusion reads: half the scene's
 * resolution, a cell the surface at the top left of its 2 × 2 pixels — its world normal and its scene depth in
 * centimetres, the depth held short of a half float's infinity where no surface is. Cells past the view are
 * cleared. A normal of no length reads as (0, 0, 1), so that no cell hands a pass a value without a direction.
 */
export const DFAO_NORMALS_WGSL = wgslProgram(
  `@group(0) @binding(${B.surfaceNormals}) var surfaceNormals:texture_2d<f32>;
@group(0) @binding(${B.output}) var normalsOut:texture_storage_2d<${DFAO_NORMAL_FORMAT},write>;
@compute @workgroup_size(${TILE_SIZE},${TILE_SIZE})
fn dfaoNormals(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dfao.grid.xy)){return;}
 if(any(id.xy>=dfao.grid.zw/${AO_DOWNSAMPLE}u)){
  textureStore(normalsOut,vec2i(id.xy),vec4f(0.0));
  return;
 }
 let pixel=vec2i(id.xy)*${AO_DOWNSAMPLE};
 let depth=min(viewDepthCmOfDevice(dfao.depth,hizOpaqueDepth(pixel)),${DFAO_FAR_CM}.0);
 let normal=dfaoSafeNormal(textureLoad(surfaceNormals,pixel,0).xyz);
 textureStore(normalsOut,vec2i(id.xy),vec4f(normal,depth));
}`,
  [DFAO_COMMON_WGSL, hizDepthWgsl(0, B.depth), viewDepthCmOfDevice],
)
