import { copyDrawnFromShown } from './webgpuPagesHelpers.ts';
import type { HostCamera } from './cameraWorld.ts';
import { encodeDraws } from './webgpuPagesEncodeDraws.ts';
import { resetHizHistory } from './webgpuPagesDrops.ts';
import { renderWebgpuPages } from './webgpuPagesRender.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Renders through the backend while the secondary camera is set, which `render` otherwise refuses. */
export function renderForCapture(rt: WebgpuPagesRuntime, camera: HostCamera) {
  rt.capture.surfaceRenderAllowed = true;
  // Une capture rend depuis une autre caméra et rétablit ensuite l'image : rien n'y est tenu.
  rt.run.gate.viewReplaced();
  try {
    renderWebgpuPages(rt, camera);
  } finally {
    rt.capture.surfaceRenderAllowed = false;
  }
}

/**
 * Attend que chaque page de la coupe affichée soit résidente, puis la dessine pour la vue de
 * l'image en cours. Aucune caméra n'entre ici : `renderForCapture` vient de faire entrer la sienne
 * par le contrat, et l'encodage ne lit que la caméra du moteur. Les crochets laissent une capture
 * refuser une coupe que le budget ou l'hôte a abandonnée, avant tout envoi et tout tirage.
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
    diag.engineDiagnostic('surface-main-restored', 'Vue principale restaurée', {
      width: saved.size[0],
      height: saved.size[1],
    });
  } finally {
    capture.secondaryCamera = undefined;
    capture.surfaceRenderAllowed = false;
  }
}
