import { copyDrawnFromShown } from '../helpers.ts';
import type { HostCamera } from '../../../camera/world.ts';
import { encodeDraws } from '../render/encodeDraws.ts';
import { resetHizHistory } from './drops.ts';
import { renderWebgpuPages } from '../render/render.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** Renders through the backend while a capture holds it, which `render` otherwise refuses.
 *  `aspect` is the shape of the surface written into, when it is not the camera's own. */
export function renderForCapture(rt: WebgpuPagesRuntime, camera: HostCamera, aspect?: number) {
  rt.capture.surfaceRenderAllowed = true;
  // A capture renders from another camera and then restores the image: nothing is held there.
  rt.run.gate.viewReplaced();
  try {
    renderWebgpuPages(rt, camera, aspect);
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
  const { run, services } = rt;
  await services.residency.pending;
  hooks.admitted?.();
  await services.ensureResident(run.shown, run.frame, services.residency.nextJobId());
  if (!run.shown.every(services.poolHolds)) throw new Error('SURFACE_GPU_COVERAGE_INCOMPLETE');
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
    diag.engineDiagnostic('surface-main-restored', 'Main view restored', {
      width: saved.size[0],
      height: saved.size[1],
    });
  } finally {
    capture.capturing = false;
    capture.surfaceRenderAllowed = false;
  }
}
