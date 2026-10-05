import { readOnly } from '../webgpu/core/bindLayout.ts';
import * as layer from './layers.ts';

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
  texelSampler: 9,
  ...layer.LAYER_BINDINGS,
  reactive: 14,
  shareHistory: 15,
  indices: 16,
  positions: 17,
  uvs: 18,
  geometryHistory: 19,
  shadingHistory: 20,
} as const;

/** The pass's bind group layout: one entry per binding above. A flagless resolve (OMB-11) neither
 *  binds nor reads the flags; a `filtered` one binds the layers'. The reactive value and the share
 *  target — the as-is share history beside the flicker gradient, still weight and count — are
 *  bound in every resolve (`historyWgsl.ts`). */
export function createTaaLayout(device: GPUDevice, asIs = true, blended = false, filtered = false) {
  const stage = GPUShaderStage.FRAGMENT;
  const entries: GPUBindGroupLayoutEntry[] = [
    {
      binding: TAA_BINDINGS.current,
      visibility: stage,
      texture: { sampleType: 'unfilterable-float' },
    },
    { binding: TAA_BINDINGS.history, visibility: stage, texture: { sampleType: 'float' } },
    {
      binding: TAA_BINDINGS.historySampler,
      visibility: stage,
      sampler: { type: 'filtering' },
    },
    { binding: TAA_BINDINGS.depth, visibility: stage, texture: { sampleType: 'depth' } },
    { binding: TAA_BINDINGS.ids, visibility: stage, texture: { sampleType: 'uint' } },
    { binding: TAA_BINDINGS.pages, visibility: stage, buffer: readOnly },
    { binding: TAA_BINDINGS.motion, visibility: stage, buffer: readOnly },
    { binding: TAA_BINDINGS.view, visibility: stage, buffer: { type: 'uniform' } },
    {
      binding: TAA_BINDINGS.flags,
      visibility: stage,
      texture: { sampleType: blended ? 'float' : 'uint' },
    },
    // Gathers only (`geometryHistoryWgsl.ts`): never filters, so depth and integers may use it.
    {
      binding: TAA_BINDINGS.texelSampler,
      visibility: stage,
      sampler: { type: 'non-filtering' },
    },
    { binding: TAA_BINDINGS.reactive, visibility: stage, texture: { sampleType: 'float' } },
    { binding: TAA_BINDINGS.shareHistory, visibility: stage, texture: { sampleType: 'float' } },
    {
      binding: TAA_BINDINGS.geometryHistory,
      visibility: stage,
      texture: { sampleType: 'uint' },
    },
    { binding: TAA_BINDINGS.shadingHistory, visibility: stage, texture: { sampleType: 'uint' } },
    // The page pool and the float pool the page geometry reads a deformed pixel's triangle from.
    ...[TAA_BINDINGS.indices, TAA_BINDINGS.positions, TAA_BINDINGS.uvs].map((binding) => ({
      binding,
      visibility: stage,
      buffer: readOnly,
    })),
  ];
  const kept = asIs ? entries : entries.filter(({ binding }) => binding !== TAA_BINDINGS.flags);
  return device.createBindGroupLayout({
    entries: [...kept, ...layer.layerEntries(filtered)],
  });
}

/** Uniform bytes: two matrices, two quadruplets, the nine weights in three, then the render grid,
 *  the jitter, the eye, the scene's exposure, the camera's parallax and the flicker rates. */
export const TAA_VIEW_BYTES = 304;

/**
 * Pass uniform. `prevViewProj` and `invViewProj` are REPORTED TO THIS FRAME'S EYE and
 * both WITHOUT jitter: the inverse yields, for the unshifted pixel centre and the depth read at
 * the sample, a position relative to the eye; the previous one takes it as-is — the same
 * anchoring as the partition, so five-digit world coordinates of an urban model do not eat
 * the single-precision of the reprojection. `viewport` = (width, height, 1/width,
 * 1/height) of the display, which the history has; `params` = (current-frame share, history
 * valid, a placement moved, the layers' history is the last image's); `weights` = the nine
 * weights of the current-frame filter at native size, neighbour by neighbour (`weights.ts`);
 * `render` = the same four of the grid the frame was drawn in, and `jitter` its offset in render
 * pixels (`upscaleWgsl.ts`), then whether the image moves and the image's rank among eight, which
 * dithers the history texel read (`historyWgsl.ts`); `eye` the eye in the world, and in `w` whether
 * a GPU deformation moved this frame (`deformWgsl.ts`, #357); `tsr.x` the exposure composition
 * applies, which the history's luma is measured in (`shadingHistoryWgsl.ts`); `parallax` the last
 * view-projection's image of the eye's move since then, `prevViewProj · (lastEye − eye, 0)`: what a
 * point's last projection gains when the camera only turned, its parallax; `moire` the flicker
 * count's fade-in rate and the parallax limit's inverse (`FLICKER_COUNT_RATE`, `flickerParallax`), a render pixel's
 * width in the world at a clip w of one (`shadingStill`).
 */
export const VIEW_WGSL = `struct TaaView{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,weights:array<vec4f,3>,render:vec4f,jitter:vec4f,eye:vec4f,tsr:vec4f,parallax:vec4f,moire:vec4f,}`;

export const BINDINGS_WGSL = `
@group(0) @binding(${TAA_BINDINGS.current}) var current:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.history}) var history:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.historySampler}) var historySampler:sampler;
@group(0) @binding(${TAA_BINDINGS.depth}) var depth:texture_depth_2d;
@group(0) @binding(${TAA_BINDINGS.ids}) var ids:texture_2d<u32>;
@group(0) @binding(${TAA_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${TAA_BINDINGS.motion}) var<storage,read> motion:array<mat4x4f>;
@group(0) @binding(${TAA_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${TAA_BINDINGS.reactive}) var reactive:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.shareHistory}) var shareHistory:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.geometryHistory}) var geometryHistory:texture_2d<u32>;
@group(0) @binding(${TAA_BINDINGS.shadingHistory}) var shadingHistory:texture_2d<u32>;
@group(0) @binding(${TAA_BINDINGS.texelSampler}) var texelSampler:sampler;
@group(0) @binding(${TAA_BINDINGS.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${TAA_BINDINGS.positions}) var<storage,read> positions:array<f32>;
@group(0) @binding(${TAA_BINDINGS.uvs}) var<storage,read> uvs:array<f32>;`;
export const shareBindingsWgsl = (blended: boolean) => `
@group(0) @binding(${TAA_BINDINGS.flags}) var flags:texture_2d<${blended ? 'f32' : 'u32'}>;`;
