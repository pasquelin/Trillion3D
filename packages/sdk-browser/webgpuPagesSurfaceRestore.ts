import { copyDrawnFromShown } from './webgpuPagesHelpers.ts';
import type { HostCamera } from './cameraWorld.ts';
import { encodeDraws } from './webgpuPagesEncodeDraws.ts';
import { resetHizHistory } from './webgpuPagesDrops.ts';
import { renderWebgpuPages } from './webgpuPagesRender.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Renders through the backend while the secondary camera is set, which `render` otherwise refuses. */
export function renderForCapture(rt: WebgpuPagesRuntime, camera: HostCamera) {
  rt.capture.surfaceRenderAllowed = true;
  // A capture renders from another camera and then restores the image: nothing is held there.
  rt.run.gate.viewReplaced();
  try {
    renderWebgpuPages(rt, camera);
  } finally {
    rt.capture.surfaceRenderAllowed = false;
  }
}

/**
 * Waits until every page of the displayed cut is resident, then draws it for the current image's
 * view. No camera enters here: `renderForCapture` has just entered its own through the contract, and
 * encode reads only the engine camera. The hooks let a capture refuse a cut the budget or the host
 * has dropped, before any send and any draw.
 */
export async function drawResidentCut(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  hooks: { admitted?: () => void; beforeEncode?: () => void } = {},
) {
  const { run, gpu, services } = rt;
  await services.residency.pending;
  hooks.admitted?.();
  await services.ensureResident(run.shown, run.frame, services.residency.nextJobId());
  if (run.shown.some((page) => !gpu.cache?.get(page.url)))
    throw new Error('SURFACE_GPU_COVERAGE_INCOMPLETE');
  copyDrawnFromShown(run);
  hooks.beforeEncode?.();
  run.submittedTriangles = encodeDraws(rt, gpuDevice, run.gate.cam);
}

export type SavedView = {
  main: HostCamera;
  size: [number, number];
  diagnostic: WebgpuPagesRuntime['run']['diagnostic'];
  motion: WebgpuPagesRuntime['run']['motion'];
};

/** Puts the main view back after a surface capture, presenting it again when the host shows one. */
export async function restoreMainView(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  saved: SavedView,
) {
  const { run, gpu, capture, context, diag } = rt,
    { viewport } = rt.setup;
  viewport[0] = saved.size[0];
  viewport[1] = saved.size[1];
  run.diagnostic = saved.diagnostic;
  resetHizHistory(run);
  Object.assign(run.motion, saved.motion);
  try {
    if (run.lost || context.signal?.aborted) return;
    renderForCapture(rt, saved.main);
    await drawResidentCut(rt, gpuDevice);
    if (gpu.presenter && gpu.colorTexture) {
      const encoder = gpuDevice.createCommandEncoder();
      gpu.presenter.present(encoder, gpu.colorTexture, ...gpu.targetSize);
      gpuDevice.queue.submit([encoder.finish()]);
    }
    if (gpu.canvasTexture) gpu.canvasTexture.needsUpdate = true;
    diag.engineDiagnostic('surface-main-restored', 'Main view restored', {
      width: saved.size[0],
      height: saved.size[1],
    });
  } finally {
    capture.secondaryCamera = undefined;
    capture.surfaceRenderAllowed = false;
  }
}
