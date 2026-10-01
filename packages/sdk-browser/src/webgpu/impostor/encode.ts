import { viewProj } from '../pages/helpers.ts';
import { CARD_FLOATS, CARD_VIEW_FLOATS } from './cardWgsl.ts';
import { IMPOSTOR_PASS } from './pass.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { ClusterRoot } from '../../page/selection/types.ts';

const viewWords = new Float32Array(CARD_VIEW_FLOATS);
let attachmentsFor: GPUTextureView[] | undefined,
  attachments: GPURenderPassColorAttachment[] = [];

/**
 * Draws this image's cards (`frame.ts`) over the opaque surfaces the material passes wrote, before
 * they are lit: one instanced draw per mesh atlas, the image's render view-projection (its jitter
 * included) and eye in the view uniform. An image without cards encodes nothing.
 */
export function encodeImpostorCards(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const state = rt.gpu.impostors,
    { surfaces, depthView } = rt.gpu;
  if (!state?.count || !rt.vis.visEnabled || !surfaces || !depthView) return;
  const { pass } = state,
    image = pass.imageGroup(state.count),
    eye = rt.run.gate.cam.eye;
  viewWords.set(viewProj);
  for (let k = 0; k < 3; k++) viewWords[16 + k] = eye[k];
  viewWords[19] = 1;
  device.queue.writeBuffer(pass.viewBuffer, 0, viewWords);
  device.queue.writeBuffer(image.buffer, 0, state.records, 0, state.count * CARD_FLOATS);
  // The surfaces keep what the material passes wrote: the cards draw over them, depth-tested.
  const views = surfaces.views();
  if (views !== attachmentsFor) {
    attachmentsFor = views;
    attachments = views.map((view) => ({ view, loadOp: 'load', storeOp: 'store' }));
  }
  const [width, height] = rt.gpu.targetSize;
  const draw = encoder.beginRenderPass({
    label: IMPOSTOR_PASS,
    colorAttachments: attachments,
    depthStencilAttachment: { view: depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  draw.setViewport(0, 0, width, height, 0, 1);
  draw.setPipeline(pass.pipeline);
  draw.setBindGroup(0, image.group);
  for (const run of state.runs) {
    draw.setBindGroup(1, run.group);
    draw.draw(6, run.count, 0, run.first);
  }
  draw.end();
  rt.run.gpuDrawCalls += state.runs.length;
}

/**
 * Hands this image's suppressed roots to the GPU cut, which draws on the current frame's mask:
 * a switched root is parked like a root its host parks (`parkWorld`), and given back when it
 * switches back, in the same image. `roots` are the GPU cut's, `switched` planned over them.
 */
export function parkSwitchedRoots(
  rt: WebgpuPagesRuntime,
  roots: readonly ClusterRoot<unknown>[],
  switched: Uint8Array | undefined,
) {
  const selection = rt.run.gpuSelection;
  if (!selection || !rt.gpu.impostors) return;
  for (let rank = 0; rank < roots.length; rank++)
    selection.parkWorld(rank, !!roots[rank].parked || switched?.[rank] === 1);
}
