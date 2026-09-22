import { viewProj } from './webgpuPagesHelpers.ts';
import { clearValueOf } from './clearColour.ts';
import { enginePose } from './cameraWorld.ts';
import { composesOffscreen } from './diagnosticGpuVariant.ts';
import type { WebgpuPagesCore } from './webgpuPagesRuntime.ts';
import { DEPTH_CLEAR } from './depthConvention.ts';

const newEncoder = (rt: WebgpuPagesCore, device: GPUDevice) =>
  rt.timing.gpuTiming && !rt.capture.capturing
    ? rt.timing.gpuTiming.createEncoder(rt.run.frame)
    : device.createCommandEncoder();

/** The image's own command buffer when one is open, a fresh one otherwise. */
export const createRenderEncoder = (rt: WebgpuPagesCore, device: GPUDevice) =>
  rt.timing.frameEncoder ?? newEncoder(rt, device);

export const openFrameEncoder = (rt: WebgpuPagesCore, device: GPUDevice) =>
  (rt.timing.frameEncoder = newEncoder(rt, device));

/** Drops the open command buffer and settles the selection whose readback would have ridden in it. */
export function abandonFrameEncoder(rt: WebgpuPagesCore) {
  const { timing } = rt;
  if (!timing.frameEncoder) return;
  timing.frameEncoder = undefined;
  const settle = timing.frameSelection;
  timing.frameSelection = undefined;
  settle?.(false);
  timing.gpuTiming?.cancelUnsubmitted();
}

export function submitColorCopy(
  rt: WebgpuPagesCore,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  height: number,
  width: number,
  presented = false,
) {
  const { run, gpu, timing, capture, context } = rt;
  // The off-screen variant does not touch the swap chain in any way: neither a composition target
  // nor a separate presentation pass. That is what isolates what Presentation actually contains.
  const offscreen = composesOffscreen(context.diagnosticGpuVariant);
  if (!presented && !offscreen && gpu.presenter && gpu.colorTexture && !capture.capturing) {
    gpu.presenter.present(encoder, gpu.colorTexture, width, height);
    run.gpuDrawCalls++;
  }
  const owned = encoder === timing.frameEncoder;
  // Texture image feedback leaves with the image: the target where pixels posted their requests is
  // reduced to counts, copied to their readback then zeroed.
  if (!capture.capturing && gpu.feedbackView)
    rt.vis.textures?.publishRequests(
      encoder,
      run.feedbackWritten ? gpu.feedbackView : undefined,
      gpu.targetSize,
      run.textureConverging,
    );
  // Submit is timed alone: the encode that precedes it no longer carries it.
  const submitStart = performance.now();
  const command = encoder.finish();
  device.queue.submit([command]);
  timing.lastQueueSubmitMs = performance.now() - submitStart;
  // Counts of a sampled image are mapped only once the image that copied them is submitted.
  rt.vis.gpuPartition?.countsSubmitted();
  if (!capture.capturing) rt.vis.textures?.feedback.submitted();
  // Same for the far-shadow counts: their copy is mapped only once submitted.
  rt.sunFar.gpu?.submitted();
  rt.lights.cull?.counts.submitted();
  run.imageRevision++;
  if (owned) {
    timing.frameEncoder = undefined;
    const settle = timing.frameSelection;
    timing.frameSelection = undefined;
    settle?.(true);
  }
  rt.diag.traceDiagnostic('encoding-submit', 'Commandes WebGPU soumises', () => ({
    frame: run.frame,
    submission: run.imageRevision,
    pose: run.lastCamera ? enginePose(run.gate.cam) : null,
    width,
    height,
    drawCalls: run.gpuDrawCalls,
    // Synchronous cut count, held where the hole is: nothing here waits for the GPU count readback,
    // so the guard that hid it covered nothing.
    drawnTriangles: run.drawnTriangles,
    transparent: { drawCalls: run.blendDrawCalls, submittedTriangles: run.blendSubmittedTriangles },
    presentation: capture.capturing ? 'surface-capture' : context.gpuCanvas ? 'direct' : 'composed',
  }));
  if (timing.gpuTiming?.isSampled(encoder))
    timing.gpuTiming.submitted(encoder, {
      submission: run.imageRevision,
      viewport: [width, height],
      cameraWorld: run.lastCamera && [...run.gate.cam.eye],
      viewProjection: [...viewProj],
      scope: 'selection-and-render-passes',
      excludes: ['uploads and copies', 'CPU work', 'presentation latency'],
      drawCalls: run.gpuDrawCalls,
      transparentDrawCalls: run.blendDrawCalls,
      transparentSubmittedTriangles: run.blendSubmittedTriangles,
    });
}

export function encodeClear(rt: WebgpuPagesCore, encoder: GPUCommandEncoder) {
  const pass = encoder.beginRenderPass({
    label: 'WG clear',
    colorAttachments: [
      {
        view: rt.gpu.colorView!,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: clearValueOf(rt.setup.clearColor),
      },
    ],
    depthStencilAttachment: {
      view: rt.gpu.depthView!,
      depthClearValue: DEPTH_CLEAR,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  pass.end();
}
