import { core } from '../../impostor/borrowed.ts';
import { CARD_VIEW_FLOATS } from './cardWgsl.ts';
import { CARD_FLOATS } from '../../impostor/cards.ts';
import { IMPOSTOR_PASS } from './pipelines.ts';
import type { WebgpuImpostors } from './frame.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

const viewWords = new Float32Array(CARD_VIEW_FLOATS);

/** The image's cards (`frame.ts`), when it has any and the visibility buffer draws. */
const cardsOf = (rt: WebgpuPagesRuntime) => {
  const state = rt.gpu.impostors;
  return state?.count && rt.vis.visEnabled ? state : undefined;
};

/** One instanced draw per mesh atlas, with `pipeline`, on `pass`. */
function drawRuns(
  rt: WebgpuPagesRuntime,
  state: WebgpuImpostors,
  pass: GPURenderPassEncoder,
  pipeline: GPURenderPipeline,
  image = state.pass.imageGroup(state.count),
) {
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, image.group);
  for (let r = 0; r < state.runCount; r++) {
    const run = state.runs[r];
    pass.setBindGroup(1, run.group);
    pass.draw(6, run.count, 0, run.first);
  }
  rt.run.gpuDrawCalls += state.runCount;
}

/**
 * The cards' visibility stage, drawn into the open primary visibility pass `pass` before the Hi-Z
 * pyramid is built: identifier 0, the depth where the mesh's surface would be, and the pyramid's
 * level 0 when `hiz`. It first sends the image's view — its render view-projection, jitter
 * included, and eye — and card records, which the surface stage reads too. True when it drew.
 */
export function drawImpostorVisibility(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  hiz: boolean,
) {
  const state = cardsOf(rt);
  if (!state) return false;
  const eye = rt.run.gate.cam.eye;
  viewWords.set(core.viewProj);
  for (let k = 0; k < 3; k++) viewWords[16 + k] = eye[k];
  viewWords[19] = 1;
  const image = state.pass.imageGroup(state.count);
  device.queue.writeBuffer(state.pass.viewBuffer, 0, viewWords);
  device.queue.writeBuffer(image.buffer, 0, state.records, 0, state.count * CARD_FLOATS);
  drawRuns(rt, state, pass, state.pass.visPipeline(hiz), image);
  return true;
}

/**
 * The visibility stage of an image with no drawable row, whose every root may stand behind its
 * card: one pass clearing the identifiers and the depth, then the cards. True when it drew — the
 * depth then holds them, and the surfaces' pass keeps it.
 */
export function encodeImpostorVisibilityPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { visView } = rt.vis,
    { depthView } = rt.gpu;
  if (!cardsOf(rt) || !visView || !depthView) return false;
  const pass = encoder.beginRenderPass({
    label: `${IMPOSTOR_PASS} visibility`,
    colorAttachments: [
      { view: visView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: core.DEPTH_CLEAR,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  const [width, height] = rt.gpu.targetSize;
  pass.setViewport(0, 0, width, height, 0, 1);
  drawImpostorVisibility(rt, device, pass, false);
  pass.end();
  return true;
}

/**
 * The cards' surface stage, over the opaque surfaces the material passes wrote and before they are
 * lit: each card writes its surface where its depth is the one the visibility stage kept. An image
 * without cards encodes nothing.
 */
export function encodeImpostorCards(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const state = cardsOf(rt),
    { surfaces, depthView } = rt.gpu;
  if (!state || !surfaces || !depthView) return;
  const draw = encoder.beginRenderPass({
    label: IMPOSTOR_PASS,
    colorAttachments: core.surfaceLoadAttachments(surfaces),
    depthStencilAttachment: { view: depthView, depthReadOnly: true },
  });
  const [width, height] = rt.gpu.targetSize;
  draw.setViewport(0, 0, width, height, 0, 1);
  drawRuns(rt, state, draw, state.pass.pipeline);
  draw.end();
}
