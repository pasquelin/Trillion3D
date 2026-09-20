import { shadeColorAttachments } from './webgpuPagesAttachments.ts';
import { PAGE_INFO_STRIDE } from './visibilityBuffer.ts';
import { MATERIAL_CLASS_KEYS, ROW_MATERIAL_CLASS_WORD } from './visibilityMaterialClass.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Labels of the two resolve passes, as the profile and the pass blocks read them. */
export const MATERIAL_DEPTH_PASS = 'WG material depth';
export const MATERIAL_SURFACES_PASS = 'WG material surfaces v1';

/** Stamp of each class key: the classes whose stamp is this encode's have a drawable row. */
const present = new Uint32Array(MATERIAL_CLASS_KEYS);
let encodes = 0;

/**
 * Classes of the packed rows, stamped into `stamps`: one word read per row, on the same table
 * the GPU draws from. A class the image has no row of is not drawn: its full-screen triangle
 * would be refused pixel by pixel, at the cost of a clear. Returns how many classes are present.
 */
export function markPresentClasses(
  ints: Uint32Array,
  packedCount: number,
  stamp: number,
  stamps: Uint32Array,
) {
  const stride = PAGE_INFO_STRIDE / 4;
  let count = 0;
  for (let row = 0; row < packedCount; row++) {
    const key = ints[row * stride + ROW_MATERIAL_CLASS_WORD];
    if (stamps[key] === stamp) continue;
    stamps[key] = stamp;
    count++;
  }
  return count;
}

/**
 * Surfaces of the opaque image, the published visibility-buffer design: the material-depth pass
 * writes each pixel's class, then each class present draws one full-screen triangle at its own
 * depth under `equal` — the hardware keeps its pixels, and its pipeline runs the fragment stage
 * compiled for that class alone. The surfaces and the virtual-texture feedback target are those
 * of the single-pass resolve, cleared once by the first class and kept by the next ones.
 */
export function encodeMaterialPasses(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis, run } = rt,
    { rows } = rt.layout,
    [width, height] = gpu.targetSize;
  if (
    !gpu.surfaces ||
    !vis.materialDepthView ||
    !vis.materialDepthPipeline ||
    !vis.shadePipelineFor
  )
    throw new Error('MATERIAL_DEPTH_UNAVAILABLE');
  if (!vis.shadeBindGroup || !rows.pageTableInts) return;
  const stamp = ++encodes;
  markPresentClasses(rows.pageTableInts, rows.packedCount, stamp, present);
  // A class the census did not see — a material the host changed since — compiles on its first
  // draw, once, the way the scene's classes did at preparation.
  for (let key = 0; key < present.length; key++)
    if (present[key] === stamp && !vis.shadePipelines.has(key))
      vis.shadePipelines.set(key, vis.shadePipelineFor(key));
  const depthPass = encoder.beginRenderPass({
    label: MATERIAL_DEPTH_PASS,
    colorAttachments: [],
    depthStencilAttachment: {
      view: vis.materialDepthView,
      depthClearValue: 0,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  depthPass.setViewport(0, 0, width, height, 0, 1);
  depthPass.setPipeline(vis.materialDepthPipeline);
  depthPass.setBindGroup(0, vis.shadeBindGroup);
  depthPass.draw(3);
  depthPass.end();
  const shadePass = encoder.beginRenderPass({
    label: MATERIAL_SURFACES_PASS,
    colorAttachments: shadeColorAttachments(rt, gpu.surfaces),
    depthStencilAttachment: { view: vis.materialDepthView, depthReadOnly: true },
  });
  shadePass.setViewport(0, 0, width, height, 0, 1);
  shadePass.setBindGroup(0, vis.shadeBindGroup);
  let draws = 0;
  for (const [key, pipeline] of vis.shadePipelines) {
    if (present[key] !== stamp) continue;
    shadePass.setPipeline(pipeline);
    shadePass.draw(3);
    draws++;
  }
  shadePass.end();
  run.gpuDrawCalls += draws + 1;
  return draws;
}
