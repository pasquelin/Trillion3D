import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ndcToPixel, pixelToNdc } from '../../../../math/src/wgsl/projection.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { VECTOR_CODEC_WGSL } from '../../post/taa/velocityWgsl.ts'
import { SURFACE_PAST_WGSL } from '../bounce/screen/vectorsWgsl.ts'
import { REFLECTION_DEPTH_FORMAT } from './grids.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_TRACE_BINDINGS as B } from './trace/traceBindings.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_LINEAR_DEPTH_WGSL,
  reflectionBindingsWgsl,
} from './viewLayout.ts'

/** The surfaces' vectors of this image, two words a texel (`decodeVector`, `depthStepOf`): where each surface stood in the image before, which
 *  the accumulation (`temporalWgsl.ts`) and a screen hit (`reflectionPast`) read. */
export const REFLECTION_VECTORS_WGSL = wgslBlock(
  'REFLECTION_VECTORS_WGSL',
  [],
  `@group(0) @binding(${B.vectors}) var temporalVectors:texture_2d<u32>;`,
)

/**
 * WHERE A SCREEN HIT STOOD IN THE LAST IMAGE, and whether the last image showed it there — what a hit takes the lit image by (`seen.ts`,
 * `rayLightWgsl.ts`).
 *
 * `reflectionPast`: the hit at the world point `hit`, on the screen of this image at `S` (pixels, continuous) and the device depth `z`, stood
 * in the last image at `pixel` (pixels of the lit image) at the device depth `z` of the result: where the last view-projection puts the point
 * (`ReflectionView.radianceViewProj`) — or, where the surface it lands on moves by itself (`hasOwnMotion`, the vector the velocity stage
 * drew at the pixel of `S`, `temporalVectors`), where that vector says it stood, at the depth its depth step says (`depthStepOf`); both
 * without the jitter of either image, the vectors being drawn without it, and the jitter of the last put back, the lit image having been
 * drawn with it. `valid` is false for a point behind the last camera.
 * `reflectionPastTexel`: the texel of the lit image the place lies in, held within it. `reflectionPastAgrees`: whether the depth the last image kept at that
 * texel (`reflectionDepthHistory`, written after each image's trace, `keepDepth`; this image's own where the one held is not
 * the last image's, `ReflectionView.traced.y`) lies from the depth the place is expected at, `z`, by less than `thickness` (the setting's,
 * `ReflectionView.historyThickness`) times a share from a half to twice by `noise`: the hit then lands on what the last image showed there.
 *
 * The kept depth is read at a texel only (`textureLoad`), so it is bound as a sampled texture or, where `stored`, as a read-only storage texture:
 * the scene stage through the scene's triangles binds it the second way, the sampled textures of its stage being the sixteen WebGPU allows
 * once the fog's cubemap is counted, while a compute stage may hold four storage textures and that stage holds three.
 */
export const reflectionPastWgsl = (group: number, stored = false) =>
  wgslBlock(
    `reflectionPastWgsl(${group},${stored})`,
    [
      reflectionBindingsWgsl(group),
      hizDepthWgsl(group, REFLECTION_DEPTH_BINDING),
      REFLECTION_LINEAR_DEPTH_WGSL,
      REFLECTION_VECTORS_WGSL,
      VECTOR_CODEC_WGSL,
      SURFACE_PAST_WGSL,
      ndcToPixel,
      pixelToNdc,
    ],
    `@group(0) @binding(${B.depthHistory}) var reflectionDepthHistory:${stored ? `texture_storage_2d<${REFLECTION_DEPTH_FORMAT},read>` : 'texture_2d<f32>'};
@group(0) @binding(${B.depthKeep}) var reflectionDepthKeep:texture_storage_2d<${REFLECTION_DEPTH_FORMAT},write>;
struct ReflectionPast{pixel:vec2f,z:f32,valid:bool,}
fn reflectionPast(hit:vec3f,S:vec2f,z:f32)->ReflectionPast{
 let previous=reflectionView.radianceViewProj*vec4f(hit,1.0);
 let last=vec2i(textureDimensions(temporalVectors))-vec2i(1);
 let words=textureLoad(temporalVectors,clamp(vec2i(S),vec2i(0),last),0);
 let moves=hasOwnMotion(words.r);
 let jitter=reflectionView.jitter;
 let here=pixelToNdc(S,view.viewport.xy)-jitter.xy;
 let still=previous.xy/previous.w-jitter.zw;
 let ndc=surfacePast(words.r,here,still)+jitter.zw;
 return ReflectionPast(ndcToPixel(ndc,reflectionView.radiance.xy),select(previous.z/previous.w,z-depthStepOf(words.g),moves),moves||previous.w>0.0);
}
fn reflectionPastTexel(past:ReflectionPast)->vec2i{
 let size=reflectionView.radiance.xy;
 return vec2i(clamp(past.pixel,vec2f(0.5),size-vec2f(0.5)));
}
fn reflectionPastAgrees(past:ReflectionPast,noise:f32,thickness:f32)->bool{
 if(!past.valid){return false;}
 let at=reflectionPastTexel(past);
 let kept=select(hizOpaqueDepth(at),textureLoad(reflectionDepthHistory,at${stored ? '' : ',0'}).r,reflectionView.traced.y!=0u);
 return abs(kept-past.z)<thickness*mix(0.5,2.0,noise);
}
/** The opaque depth of this image, kept for the next image's hits (\`reflectionDepthHistory\`): a thread a pixel. */
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn keepDepth(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)){return;}
 textureStore(reflectionDepthKeep,vec2i(id.xy),vec4f(hizOpaqueDepth(vec2i(id.xy)),0.0,0.0,0.0));
}`,
  )
