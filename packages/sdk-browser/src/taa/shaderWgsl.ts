import { FULLSCREEN_VERTEX } from '../lighting/deferred/shaders.ts';
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts';
import { AS_IS_FLAG } from '../scene/surfaceModel.ts';
import { readOnly } from '../webgpu/core/bindLayout.ts';
import * as layer from './layers.ts';

/** Pass label; its timestamp duration absorbs that of the passes that precede it on
 *  some devices (apple metal-3), and is only read safely by envelope difference. */
export const TAA_PASS = 'Trillion3D temporal antialiasing';

/** Pass bindings, in the order of its layout entries. */
export const TAA_BINDINGS = {
  current: 0,
  history: 1,
  historySampler: 2,
  depth: 3,
  ids: 4,
  pages: 5,
  motion: 6,
  view: 7,
  flags: 8,
  shareHistory: 9,
  ...layer.LAYER_BINDINGS,
} as const;

/** The pass's bind group layout: one entry per binding above, in its order. The share's two come
 *  next: a flagless resolve (OMB-11) neither binds nor reads them; a `filtered` one the layers'. */
export function createTaaLayout(device: GPUDevice, asIs = true, blended = false, filtered = false) {
  const fragment = GPUShaderStage.FRAGMENT;
  const entries: GPUBindGroupLayoutEntry[] = [
    {
      binding: TAA_BINDINGS.current,
      visibility: fragment,
      texture: { sampleType: 'unfilterable-float' },
    },
    { binding: TAA_BINDINGS.history, visibility: fragment, texture: { sampleType: 'float' } },
    {
      binding: TAA_BINDINGS.historySampler,
      visibility: fragment,
      sampler: { type: 'filtering' },
    },
    { binding: TAA_BINDINGS.depth, visibility: fragment, texture: { sampleType: 'depth' } },
    { binding: TAA_BINDINGS.ids, visibility: fragment, texture: { sampleType: 'uint' } },
    { binding: TAA_BINDINGS.pages, visibility: fragment, buffer: readOnly },
    { binding: TAA_BINDINGS.motion, visibility: fragment, buffer: readOnly },
    { binding: TAA_BINDINGS.view, visibility: fragment, buffer: { type: 'uniform' } },
    {
      binding: TAA_BINDINGS.flags,
      visibility: fragment,
      texture: { sampleType: blended ? 'float' : 'uint' },
    },
    {
      binding: TAA_BINDINGS.shareHistory,
      visibility: fragment,
      texture: { sampleType: 'float' },
    },
  ];
  const kept = asIs ? entries : entries.filter(({ binding }) => binding < TAA_BINDINGS.flags);
  return device.createBindGroupLayout({ entries: [...kept, ...layer.layerEntries(filtered)] });
}

/** Uniform bytes: two matrices, two quadruplets, the nine weights in three, then the render grid
 *  and the jitter. */
export const TAA_VIEW_BYTES = 240;

/**
 * Pass uniform. `prevViewProj` and `invViewProj` are REPORTED TO THIS FRAME'S EYE and
 * both WITHOUT jitter: the inverse yields, for the unshifted pixel centre and the depth read at
 * the sample, a position relative to the eye; the previous one takes it as-is — the same
 * anchoring as the partition, so five-digit world coordinates of an urban model do not eat
 * the single-precision of the reprojection. `viewport` = (width, height, 1/width,
 * 1/height) of the display, which the history has; `params` = (current-frame share, history
 * valid, a placement moved, the layers' history is the last image's); `weights` = the nine
 * weights of the current-frame filter at native size, neighbour by neighbour (`weights.ts`);
 * `render` = the same four of the grid the frame was drawn in, and `jitter` its offset in render pixels (`upscaleWgsl.ts`).
 */
const VIEW_WGSL = `struct TaaView{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,weights:array<vec4f,3>,render:vec4f,jitter:vec4f,}`;

const BINDINGS_WGSL = `
@group(0) @binding(${TAA_BINDINGS.current}) var current:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.history}) var history:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.historySampler}) var historySampler:sampler;
@group(0) @binding(${TAA_BINDINGS.depth}) var depth:texture_depth_2d;
@group(0) @binding(${TAA_BINDINGS.ids}) var ids:texture_2d<u32>;
@group(0) @binding(${TAA_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${TAA_BINDINGS.motion}) var<storage,read> motion:array<mat4x4f>;
@group(0) @binding(${TAA_BINDINGS.view}) var<uniform> view:TaaView;`;
const shareBindingsWgsl = (blended: boolean) => `
@group(0) @binding(${TAA_BINDINGS.flags}) var flags:texture_2d<${blended ? 'f32' : 'u32'}>;
@group(0) @binding(${TAA_BINDINGS.shareHistory}) var shareHistory:texture_2d<f32>;`;

/** YCoCg, the space where the neighbour box tightens best around the colour. */
export const YCOCG_WGSL = `
fn toYcocg(c:vec3f)->vec3f{return vec3f(0.25*c.r+0.5*c.g+0.25*c.b,0.5*c.r-0.5*c.b,-0.25*c.r+0.5*c.g-0.25*c.b);}
fn fromYcocg(c:vec3f)->vec3f{return vec3f(c.x+c.y-c.z,c.x+c.z,c.x-c.y-c.z);}`;

/**
 * Where this pixel was on the previous frame, in history texture coordinates, and whether that
 * position is readable. The pixel is rebuilt in homogeneous from its depth — the background, at
 * zero depth (reversed, infinite far plane), is a direction and reprojects too, which
 * keeps the silhouette stable when the camera turns. When a placement has moved, a geometry
 * pixel first goes through its own motion matrix — `previous·current⁻¹`, identity
 * for those that have not moved; otherwise nothing is read, neither identifier, nor record, nor matrix.
 * `coord` is the display pixel, `at` the render texel its depth and identifier were read at.
 */
export const TAA_REPROJECT_WGSL = `
fn previousUv(coord:vec2i,depthValue:f32,at:vec2i)->vec3f{
 let ndc=vec2f((f32(coord.x)+0.5)*view.viewport.z*2.0-1.0,1.0-(f32(coord.y)+0.5)*view.viewport.w*2.0);
 var position=view.invViewProj*vec4f(ndc,depthValue,1.0);
 if(view.params.z!=0.0){
  let id=textureLoad(ids,at,0).r;
  if(id!=0u){position=motion[pages[(id>>8u)-1u].placement]*position;}
 }
 let previous=view.prevViewProj*position;
 if(previous.w<=0.0){return vec3f(0.0,0.0,0.0);}
 let uv=vec2f(previous.x/previous.w*0.5+0.5,0.5-previous.y/previous.w*0.5);
 let inside=all(uv>=vec2f(0.0))&&all(uv<=vec2f(1.0));
 return vec3f(uv,select(0.0,1.0,inside));
}`;

/** `text` in a resolve that carries the as-is share, `none` in the flagless one. */
export const shareText =
  (asIs: boolean) =>
  (text: string, none = '') =>
    asIs ? text : none;

/**
 * Temporal resolve. The current image is refiltered on its 3×3 neighbours with the uniform
 * weights (Blackman-Harris centred on the unshifted centre); history is read at the
 * reprojected point, clamped to the YCoCg box of those
 * same neighbours — which removes ghosts of a moving object or a discovery — then the
 * two are mixed, each weighted by the inverse of its luminance so a spark does not settle.
 * All four channels are accumulated: alpha carries the coverage that composition divides.
 * Beside the colour, each pixel's as-is share — the weight of debug views (`AS_IS_FLAG`) in it,
 * which composition keeps off the display curve — is filtered, clamped and mixed with the very
 * same weights, so it follows the colour it describes: an edge between a debug view and a lit
 * surface settles on one blend of the curve and none, never flipping with the jitter. Without an
 * as-is pixel in the frame (`asIs` false, OMB-11) that share is exactly 0 wherever the colour is
 * finite — each neighbour 0, and history clamped to [0, 0] —: the flagless resolve writes 0 and
 * reads neither the flags nor the share history, its colour the same text.
 */
export const taaShader = (asIs: boolean, blended = false, filtered = false) => {
  const share = shareText(asIs);
  return `${taaPrelude(asIs, blended, filtered)}
@fragment fn resolve(@builtin(position) pixel:vec4f)->TaaOut{
 let coord=vec2i(pixel.xy);
 let last=vec2i(view.viewport.xy)-vec2i(1);
 var filtered=vec4f(0.0);
 var lo=vec4f(1e9);var hi=vec4f(-1e9);
${share(' var share=0.0;var shareLo=1.0;var shareHi=0.0;\n')}${layer.layerWgsl(filtered, 'vars')} var k=0u;
 for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let at=clamp(coord+vec2i(dx,dy),vec2i(0),last);
  let sample=textureLoad(current,at,0);
  let weight=view.weights[k>>2u][k&3u];k++;
  filtered+=sample*weight;
  let y=vec4f(toYcocg(sample.rgb),sample.a);
  lo=min(lo,y);hi=max(hi,y);
${taaShareTap(asIs, blended)}${layer.layerWgsl(filtered, 'tap')} }}
 if(view.params.y==0.0){return ${layer.taaOut(asIs, filtered)};}
 let previous=previousUv(coord,textureLoad(depth,coord,0),coord);
${taaHistoryBlend(asIs, filtered)}
}`;
};

/** One neighbour's as-is share, weighed like its colour, in both resolves: nothing in the flagless
 *  one. */
export const taaShareTap = (asIs: boolean, blended: boolean) =>
  shareText(
    asIs,
  )(`  let asIs=${blended ? 'textureLoad(flags,at,0).r' : `f32(textureLoad(flags,at,0).r==${AS_IS_FLAG}u)`};
  share+=asIs*weight;shareLo=min(shareLo,asIs);shareHi=max(shareHi,asIs);\n`);

/** What both resolves open with: bindings, uniform, the full-screen triangle, YCoCg, reprojection
 *  and their output. */
export const taaPrelude = (asIs: boolean, blended: boolean, filtered = false) => `
${PAGE_INFO_STRUCT_WGSL}
${VIEW_WGSL}
${BINDINGS_WGSL}${asIs ? shareBindingsWgsl(blended) : ''}${layer.layerWgsl(filtered, 'bindings')}
${FULLSCREEN_VERTEX}
${YCOCG_WGSL}
${TAA_REPROJECT_WGSL}
struct TaaOut{@location(0) color:vec4f,@location(1) share:f32,${filtered ? '@location(2) tint:vec4f,@location(3) add:vec4f,' : ''}}`;

/**
 * What both resolves close with, once `previous`, `filtered`, the YCoCg box `lo`–`hi` and, with
 * `asIs`, `share` and its box are known: history read at the reprojected point, clamped to the box,
 * mixed with the current image by the inverse of each one's luminance.
 */
export const taaHistoryBlend = (asIs: boolean, filtered = false) => {
  const share = shareText(asIs);
  return ` if(previous.z==0.0){return ${layer.taaOut(asIs, filtered)};}
 let read=textureSampleLevel(history,historySampler,previous.xy,0.0);
 let clamped=clamp(vec4f(toYcocg(read.rgb),read.a),lo,hi);
 let kept=vec4f(fromYcocg(clamped.xyz),clamped.w);
${share(' let keptShare=clamp(textureSampleLevel(shareHistory,historySampler,previous.xy,0.0).r,shareLo,shareHi);\n')} let alpha=view.params.x;
 let wc=alpha/(1.0+toYcocg(filtered.rgb).x);
 let wh=(1.0-alpha)/(1.0+clamped.x);
${layer.layerWgsl(filtered, 'kept')} return ${layer.taaOut(asIs, filtered, true)};`;
};
export const TAA_SHADER = taaShader(true);
