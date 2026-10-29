import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** The kernel that converts the normals, 8 by 8 pixels a group. */
export const PT_NORMAL_SPACE_ENTRY = 'ptConvertNormalSpace'

/**
 * THE DENOISER'S NORMALS IN THE CAMERA'S SPACE (`pathTracingDenoiserNormalSpace` 1): each normal the tracer wrote in the
 * world's space is turned by the rotation of the view (`ptNormalToCamera`, the view matrix's upper 3 by 3, camera = matrix * world; a direction: no translation, the fourth component 0),
 * over the `size` pixels of the view; the converted normals are written to a texture beside (storage textures are not read and written by one kernel on every device).
 */
export const PT_NORMAL_SPACE_WGSL = wgslBlock(
  'PT_NORMAL_SPACE_WGSL',
  [],
  `struct PtNormalView{worldToCamera:mat3x3f,size:vec2i}
@group(0) @binding(0) var<uniform> ptNormalView:PtNormalView;
@group(0) @binding(1) var ptNormals:texture_2d<f32>;
@group(0) @binding(2) var ptCameraNormals:texture_storage_2d<rgba16float,write>;
fn ptNormalToCamera(worldToCamera:mat3x3f,n:vec3f)->vec4f{
 return vec4f(worldToCamera*n,0.0);
}
@compute @workgroup_size(8,8,1)
fn ${PT_NORMAL_SPACE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let at=vec2i(id.xy);
 if(any(at>=ptNormalView.size)){return;}
 textureStore(ptCameraNormals,at,ptNormalToCamera(ptNormalView.worldToCamera,textureLoad(ptNormals,at,0).xyz));
}`,
)
