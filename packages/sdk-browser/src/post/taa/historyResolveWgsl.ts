import { MAX_10_BIT_FLOAT } from '../../../../math/src/constants.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { FILTER_FORMAT } from '../../blend/display/displayFilter.ts'
import { TAA_VIEW_WGSL, packedStorageWgsl } from './bindingsWgsl.ts'
import { COLOR_SPACES_WGSL } from './colorSpaceWgsl.ts'

/** The colour pass's bindings: it writes the resolved colour, in the history's colour format
 *  (`HistoryFormats.color`: the 11-11-10 format where the device stores to it, half floats else). */
export const RESOLVE_BINDINGS = {
  view: 0,
  history: 1,
  color: 2,
  half: 3,
} as const

/** The layers pass's bindings. */
export const RESOLVE_LAYER_BINDINGS = {
  tintHistory: 1,
  addHistory: 2,
  tint: 3,
  add: 4,
} as const

/** The workgroup's side: a thread to an output pixel. */
export const RESOLVE_TILE = 8
/** The kernel's width in history pixels: four, over a display pixel's two. */
const KERNEL = 4

/** The kernel's curve at distance `d` history pixels: the cubic of the Mitchell-Netravali family,
 *  `B = C = 1/3`, on `[0, 2)`. */
function kernelCurve(d: number) {
  const B = 1 / 3,
    C = 1 / 3
  if (d < 1)
    return ((12 - 9 * B - 6 * C) * d ** 3 + (-18 + 12 * B + 6 * C) * d ** 2 + (6 - 2 * B)) / 6
  if (d < 2)
    return (
      ((-B - 6 * C) * d ** 3 +
        (6 * B + 30 * C) * d ** 2 +
        (-12 * B - 48 * C) * d +
        (8 * B + 24 * C)) /
      6
    )
  return 0
}
/** The weights of the four history pixels a display pixel spans along an axis, at 1.5, 0.5, 0.5 and
 *  1.5 history pixels from its centre; their sum squared normalises the 2D kernel. */
const NEAR = kernelCurve(0.5)
const FAR = kernelCurve(1.5)
const TOTAL_WEIGHT = (2 * (NEAR + FAR)) ** 2

/** What both passes of the resolve share: the kernel's weight of its tap `(i, j)` and the top-left
 *  history pixel of an output pixel's four by four. */
const RESOLVE_KERNEL_WGSL = wgslBlock(
  'RESOLVE_KERNEL_WGSL',
  [],
  `
fn tapWeight(i:i32)->f32{return select(${wgslF32(NEAR)},${wgslF32(FAR)},i==0||i==${KERNEL - 1});}
fn tapsWeight(i:i32,j:i32)->f32{return tapWeight(i)*tapWeight(j)*${wgslF32(1 / TOTAL_WEIGHT)};}
fn tapsTop(o:vec2i,size:vec2i)->vec2i{return min(o,size-vec2i(1))*2-vec2i(1);}`,
)

/**
 * The history brought down to the display's size, per output pixel, when the history is twice it
 * (`resolveHistory`), the colour stored in `colorFormat`:
 * - the four by four history pixels around the output pixel's centre — two each way past its
 *   edges — weighed by the kernel's curve at their distance (`NEAR`, `FAR`, normalised by the sum
 *   of the sixteen weights), the colour each by its tone weight, then held between the least and
 *   the greatest of the sixteen and within the largest small float: the sum of the colours by their
 *   tone weights, divided by the tone weight the sum itself would have (`4 / (1 − luma)`);
 * - the colour's alpha: the same weights, held between the least and the greatest of the sixteen;
 * - with `HALF`, the half-size image the history's update writes where the history is the display's
 *   size (`resolveWgsl.ts`): each of its texels the mean of the four pixels it covers, gathered in
 *   workgroup memory.
 * History pixels past the edge are the edge's. One thread to an output pixel; 16 loads of the
 * colour. The display layers are the same kernel's second pass
 * (`resolveLayers`): the layers' history by the same weights, held between the least and the
 * greatest of the sixteen, 32 loads.
 */
export const resolveHistoryShader = (colorFormat: GPUTextureFormat) =>
  wgslProgram(
    `override HALF:bool=false;
@group(0) @binding(${RESOLVE_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${RESOLVE_BINDINGS.history}) var history:texture_2d<f32>;
@group(0) @binding(${RESOLVE_BINDINGS.color}) var colorOut:texture_storage_2d<${colorFormat},write>;
@group(0) @binding(${RESOLVE_BINDINGS.half}) var halfOut:texture_storage_2d<${colorFormat},write>;
var<workgroup> quad:array<vec4f,${RESOLVE_TILE * RESOLVE_TILE}>;
@compute @workgroup_size(${RESOLVE_TILE},${RESOLVE_TILE})
fn resolveHistory(@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_index) lane:u32){
 let size=vec2i(textureDimensions(colorOut));
 let o=vec2i(gid.xy);
 let top=tapsTop(o,size);
 let last=vec2i(textureDimensions(history))-vec2i(1);
 var weighed=vec3f(0.0);var alpha=0.0;var lo=vec3f(1e30);var hi=vec3f(-1e30);
 for(var j=0;j<${KERNEL};j++){for(var i=0;i<${KERNEL};i++){
  let p=clamp(top+vec2i(i,j),vec2i(0),last);
  let w=tapsWeight(i,j);
  let c=textureLoad(history,p,0);
  weighed+=c.rgb*(w*toneWeight(c.rgb));alpha+=c.a*w;
  lo=min(lo,c.rgb);hi=max(hi,c.rgb);
 }}
 // Held from zero: WGSL leaves a division by zero indeterminate, at a weighed luma of one.
 let found=weighed*(4.0/max(1.0-luma4(weighed),1e-4));
 let colour=vec4f(clamp(clamp(found,lo,hi),vec3f(0.0),vec3f(${wgslF32(MAX_10_BIT_FLOAT)})),clamp(alpha,0.0,1.0));
 if(all(o<size)){textureStore(colorOut,o,colour);}
 if(HALF){
  quad[lane]=colour;
  workgroupBarrier();
  if((lane&1u)==0u&&((lane>>3u)&1u)==0u){
   let mean=(quad[lane]+quad[lane+1u]+quad[lane+${RESOLVE_TILE}u]+quad[lane+${RESOLVE_TILE + 1}u])*0.25;
   let at=o/2;
   if(all(at<vec2i(textureDimensions(halfOut)))){textureStore(halfOut,at,mean);}
  }
 }
}`,
    [...packedStorageWgsl(colorFormat), TAA_VIEW_WGSL, COLOR_SPACES_WGSL, RESOLVE_KERNEL_WGSL],
  )

/** The display layers' pass of the resolve: the layers' history of the history's size brought down
 *  by the colour's kernel (`resolveHistoryShader`). */
export const resolveLayersShader = () =>
  wgslProgram(
    `@group(0) @binding(${RESOLVE_LAYER_BINDINGS.tintHistory}) var tintHistory:texture_2d<f32>;
@group(0) @binding(${RESOLVE_LAYER_BINDINGS.addHistory}) var addHistory:texture_2d<f32>;
@group(0) @binding(${RESOLVE_LAYER_BINDINGS.tint}) var tintOut:texture_storage_2d<${FILTER_FORMAT},write>;
@group(0) @binding(${RESOLVE_LAYER_BINDINGS.add}) var addOut:texture_storage_2d<${FILTER_FORMAT},write>;
@compute @workgroup_size(${RESOLVE_TILE},${RESOLVE_TILE})
fn resolveLayers(@builtin(global_invocation_id) gid:vec3u){
 let size=vec2i(textureDimensions(tintOut));
 let o=vec2i(gid.xy);
 if(any(o>=size)){return;}
 let top=tapsTop(o,size);
 let last=vec2i(textureDimensions(tintHistory))-vec2i(1);
 var tint=vec4f(0.0);var tintLo=vec4f(1.0);var tintHi=vec4f(0.0);
 var add=vec4f(0.0);var addLo=vec4f(1.0);var addHi=vec4f(0.0);
 for(var j=0;j<${KERNEL};j++){for(var i=0;i<${KERNEL};i++){
  let p=clamp(top+vec2i(i,j),vec2i(0),last);
  let w=tapsWeight(i,j);
  let t=textureLoad(tintHistory,p,0);let a=textureLoad(addHistory,p,0);
  tint+=t*w;tintLo=min(tintLo,t);tintHi=max(tintHi,t);
  add+=a*w;addLo=min(addLo,a);addHi=max(addHi,a);
 }}
 textureStore(tintOut,o,clamp(tint,tintLo,tintHi));
 textureStore(addOut,o,clamp(add,addLo,addHi));
}`,
    [RESOLVE_KERNEL_WGSL],
  )
