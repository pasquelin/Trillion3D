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
  shareHistory: 9,
  ...layer.LAYER_BINDINGS,
  reactive: 14,
  tagHistory: 15,
  indices: 16,
  positions: 17,
  uvs: 18,
} as const;

/** The pass's bind group layout: one entry per binding above. A flagless resolve (OMB-11) neither
 *  binds nor reads the share's two; a `filtered` one binds the layers'. The reactive value and the
 *  history's placement tags are bound in every resolve (`historyWgsl.ts`). */
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
    { binding: TAA_BINDINGS.reactive, visibility: fragment, texture: { sampleType: 'float' } },
    { binding: TAA_BINDINGS.tagHistory, visibility: fragment, texture: { sampleType: 'float' } },
    // The page pool and the float pool the page geometry reads a deformed pixel's triangle from.
    ...[TAA_BINDINGS.indices, TAA_BINDINGS.positions, TAA_BINDINGS.uvs].map((binding) => ({
      binding,
      visibility: fragment,
      buffer: readOnly,
    })),
  ];
  const share: number[] = [TAA_BINDINGS.flags, TAA_BINDINGS.shareHistory];
  const kept = asIs ? entries : entries.filter(({ binding }) => !share.includes(binding));
  return device.createBindGroupLayout({ entries: [...kept, ...layer.layerEntries(filtered)] });
}

/** Uniform bytes: two matrices, two quadruplets, the nine weights in three, then the render grid,
 *  the jitter and the eye. */
export const TAA_VIEW_BYTES = 256;

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
 * pixels (`upscaleWgsl.ts`), then whether the image moves (`historyWgsl.ts`); `eye` the eye in the
 * world, and in `w` whether a GPU deformation moved this frame (`deformWgsl.ts`, #357).
 */
export const VIEW_WGSL = `struct TaaView{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,weights:array<vec4f,3>,render:vec4f,jitter:vec4f,eye:vec4f,}`;

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
@group(0) @binding(${TAA_BINDINGS.tagHistory}) var tagHistory:texture_2d<f32>;
@group(0) @binding(${TAA_BINDINGS.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${TAA_BINDINGS.positions}) var<storage,read> positions:array<f32>;
@group(0) @binding(${TAA_BINDINGS.uvs}) var<storage,read> uvs:array<f32>;`;
export const shareBindingsWgsl = (blended: boolean) => `
@group(0) @binding(${TAA_BINDINGS.flags}) var flags:texture_2d<${blended ? 'f32' : 'u32'}>;
@group(0) @binding(${TAA_BINDINGS.shareHistory}) var shareHistory:texture_2d<f32>;`;
