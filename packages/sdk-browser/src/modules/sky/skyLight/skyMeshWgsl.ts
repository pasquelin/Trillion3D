import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { HALF_MAX } from '../../../../../math/src/wgsl/constants.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'

/**
 * THE COPY OF A SKY MESH IMAGE: the sky meshes (the surfaces of a sky material) drawn alone from the sky light's place
 * through the six cameras of a cube (`encodeSkyMeshes.ts`) are taken by this one program twice — from the lit image of
 * each camera into a layer of the meshes' cube, then from that layer into the face of the real-time capture where the
 * atmosphere would be drawn (`captureFaces.ts`). It reads the image bilinearly over the share of it the face fills
 * (`scale.xy`), turned about its vertical axis when asked (`scale.z`: a cube's faces are laid as seen from outside, a
 * camera sees them from inside), multiplied by `scale.w` (the pre-exposure the real-time capture is written with, 1 for the
 * first copy) and held between 0 and the half float's largest value, the alpha 1. `side.x` is the inverse of the target's side.
 *
 * With the depth buffer (`skyLightDepthBuffer`) a second entry, `skyMeshDepthMain`, takes the depth of each camera the same way, nearest texel,
 * into a layer of the depth cube the fog reads (`fogFaceProgram`): the hardware depth of the camera, zero (the far) where no mesh was drawn.
 */
export const SKY_MESH_LAYOUT = fieldLayout('SkyMeshBlock', [
  ['scale', 'vec4f'],
  ['side', 'vec4f'],
] as const)

export const SKY_MESH_CODE = wgslProgram(
  `${SKY_MESH_LAYOUT.wgsl}
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var imageSampler:sampler;
@group(0) @binding(2) var<uniform> mesh:SkyMeshBlock;
@fragment fn skyMeshMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let uv=pixel.xy*mesh.side.x;
 let at=vec2f(select(uv.x,1.0-uv.x,mesh.scale.z>0.5),uv.y)*mesh.scale.xy;
 let seen=textureSampleLevel(image,imageSampler,at,0.0).rgb*mesh.scale.w;
 return vec4f(clamp(seen,vec3f(0.0),vec3f(HALF_MAX)),1.0);
}
@group(0) @binding(3) var depthImage:texture_depth_2d;
@fragment fn skyMeshDepthMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let uv=pixel.xy*mesh.side.x;
 let at=vec2f(select(uv.x,1.0-uv.x,mesh.scale.z>0.5),uv.y)*mesh.scale.xy;
 let texel=vec2i(at*vec2f(textureDimensions(depthImage)));
 return vec4f(textureLoad(depthImage,texel,0),0.0,0.0,1.0);
}`,
  [FULLSCREEN_VERTEX, HALF_MAX],
)
export const SKY_MESH_ENTRY = 'skyMeshMain'
export const SKY_MESH_DEPTH_ENTRY = 'skyMeshDepthMain'
/** The depth cube's format: the depth of the meshes, one float a texel. */
export const SKY_MESH_DEPTH_FORMAT: GPUTextureFormat = 'r32float'
/** The nearest distance a face of the capture draws, in metres: 5 cm, the capture's own, whatever the sky light's distance threshold. */
export const SKY_MESH_NEAR = 0.05
