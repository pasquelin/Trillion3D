import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DEPTH_WGSL } from '../taa/depthWgsl.ts'
import { SCENE_NUMBERS, POST_BINDINGS as B } from './postLayout.ts'

/** The entry point of a post-process material's fragment stage. */
export const POST_MATERIAL_ENTRY = 'postMaterial'

/**
 * THE SCENE A POST-PROCESS MATERIAL READS, in WGSL (`postLayout.ts` lays the bindings out): `ppScene(id, uv, filtered)` is the image `id` at
 * the viewport coordinate `uv` (0 to 1 over the image being processed), mapped into the texture it lives in and kept half a texel inside
 * the image, and `ppSceneSize(id)` its size in pixels then one over it. The image so far (`postProcessInput0`) is multiplied by one over the
 * pre-exposure it is held at, the colour of the lit image (`sceneColor`) is as it is stored; the depths are the distance along the view
 * axis (`sceneDepthOf`) in all four channels, the custom stencil its value in all four; an image the frame does not have reads as the
 * empty target does: a far depth, a stencil of zero. `ppStencilPasses` is the stencil test: the reference value compared to the pixel's stencil.
 */
export const POST_SCENE_WGSL = wgslBlock(
  'POST_SCENE_WGSL',
  [DEPTH_WGSL],
  `struct PpView{depth:vec4f,radius:vec4f,image:vec4f,scene:vec4f,custom:vec4f,head:vec4f,}
@group(0) @binding(${B.view}) var<uniform> view:PpView;
@group(0) @binding(${B.input}) var ppInput:texture_2d<f32>;
@group(0) @binding(${B.sceneColor}) var ppSceneColor:texture_2d<f32>;
@group(0) @binding(${B.sceneDepth}) var ppSceneDepth:texture_depth_2d;
@group(0) @binding(${B.customDepth}) var ppCustomDepth:texture_depth_2d;
@group(0) @binding(${B.customStencil}) var ppCustomStencil:texture_2d<u32>;
@group(0) @binding(${B.sampler}) var ppSampler:sampler;
fn ppUv(uv:vec2f,area:vec4f)->vec2f{
 return clamp(uv*area.xy/area.zw,vec2f(0.5)/area.zw,(area.xy-vec2f(0.5))/area.zw);
}
fn ppCustomArea()->vec4f{return vec4f(view.custom.xy,view.custom.xy);}
fn ppScene(id:u32,uv:vec2f,filtered:bool)->vec4f{
 if(id==${SCENE_NUMBERS.postProcessInput0}u){
  let t=ppUv(uv,view.image);
  let c=select(textureLoad(ppInput,vec2i(t*view.image.zw),0),textureSampleLevel(ppInput,ppSampler,t,0.0),filtered);
  return vec4f(c.rgb*view.head.y,c.a);
 }
 if(id==${SCENE_NUMBERS.sceneColor}u){
  let t=ppUv(uv,view.scene);
  let c=select(textureLoad(ppSceneColor,vec2i(t*view.scene.zw),0),textureSampleLevel(ppSceneColor,ppSampler,t,0.0),filtered);
  return vec4f(c.rgb,0.0);
 }
 if(id==${SCENE_NUMBERS.sceneDepth}u){
  return vec4f(sceneDepthOf(textureLoad(ppSceneDepth,vec2i(ppUv(uv,view.scene)*view.scene.zw),0)));
 }
 if(id==${SCENE_NUMBERS.customDepth}u){
  return vec4f(sceneDepthOf(textureLoad(ppCustomDepth,vec2i(ppUv(uv,ppCustomArea())*view.custom.xy),0)));
 }
 if(id==${SCENE_NUMBERS.customStencil}u){
  return vec4f(f32(textureLoad(ppCustomStencil,vec2i(ppUv(uv,ppCustomArea())*view.custom.xy),0).g));
 }
 return vec4f(0.0);
}
fn ppSceneSize(id:u32)->vec4f{
 var size=view.image.xy;
 if(id==${SCENE_NUMBERS.sceneColor}u||id==${SCENE_NUMBERS.sceneDepth}u){size=view.scene.xy;}
 if(id==${SCENE_NUMBERS.customDepth}u||id==${SCENE_NUMBERS.customStencil}u){size=view.custom.xy;}
 return vec4f(size,vec2f(1.0)/size);
}
fn ppStencilPasses(held:u32,mask:u32,reference:u32)->bool{
 return ((mask&1u)!=0u&&reference==held)||((mask&2u)!=0u&&reference<held)||((mask&4u)!=0u&&reference>held);
}`,
)
