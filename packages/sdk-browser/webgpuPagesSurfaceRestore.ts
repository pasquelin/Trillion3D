import { copyDrawnFromShown } from './webgpuPagesHelpers.ts';
import { readCameraWorld, type HostCamera } from './cameraWorld.ts';
import { encodeDraws } from './webgpuPagesEncodeDraws.ts';
import { resetHizHistory } from './webgpuPagesDrops.ts';
import { renderWebgpuPages } from './webgpuPagesRender.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Renders through the backend while the secondary camera is set, which `render` otherwise refuses. */
export function renderForCapture(rt: WebgpuPagesRuntime, camera: HostCamera) {
  rt.capture.surfaceRenderAllowed = true;
  // Une capture rend depuis une autre caméra et rétablit ensuite l'image : rien n'y est tenu.
  rt.run.frameHold.invalidate();
  try {
    renderWebgpuPages(rt, camera);
  } finally {
    rt.capture.surfaceRenderAllowed = false;
  }
}

/** Waits until every page the current cut shows is resident, then draws it for `camera`. The hooks
 *  let a capture refuse a cut the budget or the host aborted before any upload or draw. */
export async function drawResidentCut(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  camera: HostCamera,
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
  // La caméra hôte repasse par le contrat : l'encodage ne lit que la caméra du moteur.
  run.submittedTriangles = encodeDraws(rt, gpuDevice, readCameraWorld(run.cam, camera));
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
    await drawResidentCut(rt, gpuDevice, saved.main);
    if (gpu.presenter && gpu.colorTexture) {
      const encoder = gpuDevice.createCommandEncoder();
      gpu.presenter.present(encoder, gpu.colorTexture, ...gpu.targetSize);
      gpuDevice.queue.submit([encoder.finish()]);
    }
    if (gpu.canvasTexture) gpu.canvasTexture.needsUpdate = true;
    diag.engineDiagnostic('surface-main-restored', 'Vue principale restaurée', {
      width: saved.size[0],
      height: saved.size[1],
    });
  } finally {
    capture.secondaryCamera = undefined;
    capture.surfaceRenderAllowed = false;
  }
}
