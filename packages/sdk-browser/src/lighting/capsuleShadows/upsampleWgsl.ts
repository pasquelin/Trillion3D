import { FLOAT32_MAX } from '../../../../math/src/constants.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { wgslBlock, wgslVariants } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import type { CapsuleHooks } from './hooks.ts'
import { UPSAMPLE_BINDINGS as B } from './layout.ts'

/**
 * THE UPSAMPLE: the shadow factors, worked out at a fraction of the image, put back at the image's resolution by a draw of the tiles that
 * met a shape (`CapsuleShadowProgram` wrote their counts; a tile with none is collapsed to a point and draws nothing).
 *
 * Each pixel reads the four factors around it and weighs each by its distance in the grid, by the likeness of the depth it was worked out
 * at to the pixel's own (the inverse of their difference), and drops the neighbours that are no shadow and lie where no shadow was
 * worked out; at the full resolution it reads its own. The result is the light's attenuation (the draw blends it into the light's shadow
 * mask by the minimum), or, for the indirect shadow, a factor the draw multiplies into the scene's colour and, in a second target, into the
 * ambient occlusion (`ssao`), lessened on the surface of a caster by its own intensity (`capsuleCastsIndirect`).
 *
 * The frame is read through `capsuleSceneDepth(pixel)` and `capsuleCastsIndirect(pixel)` (`capsuleHooks`, over `upsampleParams.depth`).
 */

/** The factors and their reading, shared by the draw and the composition. */
const SHARED_WGSL = wgslBlock(
  'CAPSULE_UPSAMPLE_SHARED_WGSL',
  [],
  `
struct UpsampleParams{
 scissor:vec4f,
 buffer:vec4f,
 low:vec4f,
 tile:vec4f,
 viewport:vec4f,
 shading:vec4f,
 depth:vec4f,
}
@group(0) @binding(${B.params}) var<uniform> upsampleParams:UpsampleParams;
@group(0) @binding(${B.tileCounts}) var<storage,read> upsampleCounts:array<u32>;
@group(0) @binding(${B.factors}) var upsampleFactors:texture_2d<f32>;
fn capsuleFactor(texel:vec2i)->vec2f{
 let clamped=clamp(texel,vec2i(0),vec2i(upsampleParams.low.zw));
 return textureLoad(upsampleFactors,clamped,0).xy;
}
fn capsuleUpsampledShadow(position:vec2f)->f32{
 let pixel=vec2i(position);
 let sceneDepth=capsuleSceneDepth(pixel);
 let downsample=upsampleParams.shading.y;
 var shadow:f32;
 if(downsample>1.0){
  let uv=(position-upsampleParams.scissor.xy)*upsampleParams.buffer.zw;
  let low=upsampleParams.low.xy;
  let base=floor(uv*low);
  let corner=(base/low)+0.5*upsampleParams.buffer.zw;
  let weights=saturate((uv-corner)*low);
  let texel=vec2i(base);
  let v00=capsuleFactor(texel);
  let v10=capsuleFactor(texel+vec2i(1,0));
  let v01=capsuleFactor(texel+vec2i(0,1));
  let v11=capsuleFactor(texel+vec2i(1,1));
  let cornerWeights=vec4f(
   (1.0-weights.y)*(1.0-weights.x),
   (1.0-weights.y)*weights.x,
   weights.y*(1.0-weights.x),
   weights.y*weights.x);
  let factors=vec4f(v00.x,v10.x,v01.x,v11.x);
  let depths=abs(vec4f(v00.y,v10.y,v01.y,v11.y));
  let valid=select(vec4f(0.0),vec4f(1.0),((depths>vec4f(0.0))&(depths<vec4f(${wgslF32(FLOAT32_MAX)})))|(factors<vec4f(1.0)));
  let depthWeights=1.0/(abs(depths-vec4f(sceneDepth))+0.0001);
  let blended=cornerWeights*valid*depthWeights;
  let total=dot(blended,vec4f(1.0));
  shadow=select(1.0,dot(factors,blended)/total,total!=0.0);
 }else{
  shadow=textureLoad(upsampleFactors,vec2i(position-upsampleParams.scissor.xy),0).x;
 }
 return shadow;
}
`,
)

/** The draw: a vertex stage over the tiles that met a shape, a fragment stage that writes the shadow at the pixel. */
const drawWgsl = wgslVariants((ssao: boolean) =>
  wgslBlock(
    `CAPSULE_UPSAMPLE_DRAW_WGSL(${ssao})`,
    [SHARED_WGSL],
    `
struct UpsampleVertex{@builtin(position) position:vec4f,}
@vertex
fn capsuleUpsampleVertex(@builtin(vertex_index) corner:u32,@builtin(instance_index) tile:u32)->UpsampleVertex{
 let across=u32(upsampleParams.tile.x);
 let coordinate=vec2u(tile%across,tile/across);
 var quad=array<vec2f,6>(vec2f(0.0,0.0),vec2f(1.0,0.0),vec2f(0.0,1.0),vec2f(0.0,1.0),vec2f(1.0,0.0),vec2f(1.0,1.0));
 let pixel=(vec2f(coordinate)+quad[corner])*upsampleParams.tile.z+upsampleParams.scissor.xy;
 let v=upsampleParams.viewport;
 var position=vec4f(2.0*(pixel.x-v.x)/v.z-1.0,1.0-2.0*(pixel.y-v.y)/v.w,0.0,1.0);
 if(upsampleCounts[tile]==0u){position=vec4f(0.0,0.0,0.0,1.0);}
 return UpsampleVertex(position);
}
struct UpsampleOutput{@location(0) color:vec4f,${ssao ? '@location(1) occlusion:vec4f,' : ''}}
@fragment
fn capsuleUpsampleFragment(@builtin(position) position:vec4f)->UpsampleOutput{
 let pixel=vec2i(position.xy);
 var shadow=capsuleUpsampledShadow(position.xy);
 var color:vec4f;
 if(upsampleParams.tile.w>0.0){
  color=vec4f(sqrt(shadow));
 }else{
  if(upsampleParams.shading.x<1.0){
   shadow=mix(1.0,shadow,select(1.0,upsampleParams.shading.x,capsuleCastsIndirect(pixel)));
  }
  color=vec4f(shadow);
 }
 return UpsampleOutput(color${ssao ? ',vec4f(shadow)' : ''});
}`,
  ),
)

/** The composition into a sun's mask: a thread a pixel of the pass's rectangle that takes the minimum of the layer's visibility and the capsule shadow's
 *  (the layer is the visibility itself, not its square root). A pixel of a tile that met no shape keeps what it holds. */
const COMPOSE_WGSL = wgslBlock(
  'CAPSULE_COMPOSE_SUN_WGSL',
  [SHARED_WGSL],
  `
@group(0) @binding(${B.sunMask}) var sunMask:texture_storage_2d_array<r32float,read_write>;
@compute @workgroup_size(8,8,1)
fn capsuleComposeSun(@builtin(global_invocation_id) id:vec3u){
 let rect=upsampleParams.scissor;
 if(any(vec2f(id.xy)>=rect.zw)){return;}
 let tileSide=u32(upsampleParams.tile.z);
 let tile=(id.y/tileSide)*u32(upsampleParams.tile.x)+id.x/tileSide;
 if(upsampleCounts[tile]==0u){return;}
 let pixel=vec2u(rect.xy)+id.xy;
 let layer=i32(upsampleParams.shading.z);
 let held=textureLoad(sunMask,pixel,layer).x;
 let shadow=capsuleUpsampledShadow(vec2f(pixel)+vec2f(0.5));
 textureStore(sunMask,pixel,layer,vec4f(min(held,shadow),0.0,0.0,0.0));
}`,
)

/** The upsample draw's program, over the frame's reading (`hooks`). With `ssao` the fragment writes a second target, the
 *  factor again, for the ambient occlusion. */
export const capsuleUpsampleShader = (hooks: CapsuleHooks, ssao: boolean) =>
  wgslProgram(hooks.text, [...hooks.uses, drawWgsl(ssao)])

/** The program that composes the capsule shadow into a layer of the suns' mask. */
export const capsuleComposeShader = (hooks: CapsuleHooks) =>
  wgslProgram(hooks.text, [...hooks.uses, COMPOSE_WGSL])
