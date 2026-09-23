import { shadeColorAttachments } from '../pages/prepare/attachments.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';
import { MATERIAL_CLASS_KEYS } from '../../visibility/shader/materialClass.ts';
import { ROW_MATERIAL_CLASS_WORD } from '../row/pageRow.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Labels of the two resolve passes, as the profile and the pass blocks read them. */
export const MATERIAL_DEPTH_PASS = 'Trillion3D material depth';
export const MATERIAL_SURFACES_PASS = 'Trillion3D material surfaces v1';

/** Which classes an image draws: a stamp per class key, and the keys stamped by this image. */
export type PresentClasses = { stamps: Uint32Array; keys: number[]; stamp: number };
export const createPresentClasses = (): PresentClasses => ({
  stamps: new Uint32Array(MATERIAL_CLASS_KEYS),
  keys: [],
  stamp: 0,
});

/**
 * Classes of the packed rows: one word read per row, on the same table the GPU draws from, each
 * key listed once. A class the image has no row of is not drawn: its full-screen triangle would
 * be refused pixel by pixel, at the cost of a clear.
 */
export function markPresentClasses(ints: Uint32Array, packedCount: number, into: PresentClasses) {
  const stride = PAGE_INFO_STRIDE / 4,
    stamp = ++into.stamp;
  into.keys.length = 0;
  for (let row = 0; row < packedCount; row++) {
    const key = ints[row * stride + ROW_MATERIAL_CLASS_WORD];
    if (into.stamps[key] === stamp) continue;
    into.stamps[key] = stamp;
    into.keys.push(key);
  }
  return into.keys;
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
  // The image checked its pipelines, table and surfaces before encoding; what the resolve adds is
  // its own target, its bind group and the class factory, and it fails by name without them.
  if (!vis.materialDepthView || !vis.shadeBindGroup || !vis.shadePipelineFor)
    throw new Error('MATERIAL_DEPTH_UNAVAILABLE');
  const keys = markPresentClasses(rows.pageTableInts!, rows.packedCount, vis.presentClasses);
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
  depthPass.setPipeline(vis.materialDepthPipeline!);
  depthPass.setBindGroup(0, vis.shadeBindGroup);
  depthPass.draw(3);
  depthPass.end();
  const shadePass = encoder.beginRenderPass({
    label: MATERIAL_SURFACES_PASS,
    colorAttachments: shadeColorAttachments(rt, gpu.surfaces!),
    depthStencilAttachment: { view: vis.materialDepthView, depthReadOnly: true },
  });
  shadePass.setViewport(0, 0, width, height, 0, 1);
  shadePass.setBindGroup(0, vis.shadeBindGroup);
  for (const key of keys) {
    // A class the census did not see — a material the host changed since — compiles on its first
    // draw, once, like the scene's classes at preparation; created outside a validation scope, a
    // refused pipeline reaches the device's uncaptured-error path, as any mid-image creation does.
    let pipeline = vis.shadePipelines.get(key);
    if (!pipeline) vis.shadePipelines.set(key, (pipeline = vis.shadePipelineFor(key)));
    shadePass.setPipeline(pipeline);
    shadePass.draw(3);
  }
  shadePass.end();
  run.gpuDrawCalls += keys.length + 1;
}
