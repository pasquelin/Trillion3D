import { viewProj } from './webgpuPagesHelpers.ts';
import { enginePose } from './cameraWorld.ts';
import type { WebgpuPagesCore } from './webgpuPagesRuntime.ts';

const newEncoder = (rt: WebgpuPagesCore, device: GPUDevice) =>
  rt.timing.gpuTiming && !rt.capture.secondaryCamera
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
  if (!presented && gpu.presenter && gpu.colorTexture && !capture.secondaryCamera) {
    gpu.presenter.present(encoder, gpu.colorTexture, width, height);
    run.gpuDrawCalls++;
  }
  const owned = encoder === timing.frameEncoder;
  // La soumission est chronométrée seule : l'encodage qui la précède ne la porte plus.
  const submitStart = performance.now();
  const command = encoder.finish();
  device.queue.submit([command]);
  timing.lastQueueSubmitMs = performance.now() - submitStart;
  // The verdicts of a sampled image can only be mapped once the image that copied them is submitted.
  rt.vis.gpuHiz?.countsSubmitted();
  // Idem pour les compteurs de l'ombre lointaine : leur copie ne se mappe qu'une fois soumise.
  rt.sunFar.gpu?.submitted();
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
    drawnTriangles:
      run.gpuFrameActive && !run.gpuMetricsReady
        ? null
        : run.drawn.reduce((sum, page) => sum + page.triangles, 0),
    transparent: { drawCalls: run.blendDrawCalls, submittedTriangles: run.blendSubmittedTriangles },
    presentation: capture.secondaryCamera
      ? 'surface-capture'
      : context.gpuCanvas
        ? 'direct'
        : 'composed',
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
  if (gpu.canvasTexture && !capture.secondaryCamera) gpu.canvasTexture.needsUpdate = true;
}

export function clearValueOf(clearColor: number) {
  return {
    r: (clearColor >> 16) / 255,
    g: ((clearColor >> 8) & 255) / 255,
    b: (clearColor & 255) / 255,
    a: 1,
  };
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
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  pass.end();
}
