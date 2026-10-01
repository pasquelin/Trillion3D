import { shadeColorAttachments } from '../pages/prepare/attachments.ts';
import { MATERIAL_CLASS_KEYS } from '../../visibility/shader/materialClass.ts';
import { rowsUnread } from '../row/dirty.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { type PresentClasses, markPresentClasses } from './presentClasses.ts';

/** Labels of the two resolve passes, as the profile and the pass blocks read them. */
export const MATERIAL_DEPTH_PASS = 'Trillion3D material depth';
export const MATERIAL_SURFACES_PASS = 'Trillion3D material surfaces v1';
export const createPresentClasses = (): PresentClasses => ({
  stamps: new Uint32Array(MATERIAL_CLASS_KEYS),
  keys: [],
  stamp: 0,
  read: rowsUnread(),
});

/**
 * Surfaces of the opaque image. A prepared one-class scene shades directly and rejects background
 * in its fragment stage. Otherwise material depth writes each pixel's class, the material tiles
 * list the screen tiles each class holds (`materialTiles.ts`), then each class draws its tiles at
 * its depth under `equal`. The surfaces and feedback target are cleared once and then kept.
 */
export function encodeMaterialPasses(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis, run } = rt,
    { rows } = rt.layout,
    [width, height] = gpu.targetSize;
  // The image checked its pipelines, table and surfaces before encoding; what the resolve adds is
  // its own target, its bind group and the class factory, and it fails by name without them.
  const tiles = vis.materialTiles;
  if (!vis.materialDepthView || !vis.shadeBindGroup || !vis.shadePipelineFor || !tiles)
    throw new Error('MATERIAL_DEPTH_UNAVAILABLE');
  const keys = markPresentClasses(
    rows.pageTableInts!,
    rows.packedCount,
    vis.presentClasses,
    rows.rowWrites,
  );
  const key = keys.length === 1 ? keys[0] : undefined;
  const singlePipeline = key === undefined ? undefined : vis.singleShadePipelines.get(key);
  let tileGroup: GPUBindGroup | undefined;
  if (!singlePipeline) {
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
    tiles.assign(keys);
    tileGroup = tiles.encode(encoder, width, height, {
      vis: vis.visView!,
      pages: vis.pageTable!,
      uniform: vis.shadeUniform!,
    });
  }
  const shadeDescriptor: GPURenderPassDescriptor = {
    label: MATERIAL_SURFACES_PASS,
    colorAttachments: shadeColorAttachments(rt, gpu.surfaces!),
  };
  if (!singlePipeline)
    shadeDescriptor.depthStencilAttachment = { view: vis.materialDepthView, depthReadOnly: true };
  const shadePass = encoder.beginRenderPass(shadeDescriptor);
  shadePass.setViewport(0, 0, width, height, 0, 1);
  shadePass.setBindGroup(0, vis.shadeBindGroup);
  if (tileGroup) shadePass.setBindGroup(1, tileGroup);
  for (let at = 0; at < keys.length; at++) {
    const classKey = keys[at];
    // A class the census did not see — a material the host changed since — compiles on its first
    // draw, once, like the scene's classes at preparation; created outside a validation scope, a
    // refused pipeline reaches the device's uncaptured-error path, as any mid-image creation does.
    let pipeline = singlePipeline ?? vis.shadePipelines.get(classKey);
    if (!pipeline) vis.shadePipelines.set(classKey, (pipeline = vis.shadePipelineFor(classKey)));
    shadePass.setPipeline(pipeline);
    if (singlePipeline) shadePass.draw(3);
    else tiles.draw(shadePass, at);
  }
  shadePass.end();
  run.gpuDrawCalls += keys.length + (singlePipeline ? 0 : 1);
}
