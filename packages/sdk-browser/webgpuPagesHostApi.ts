import * as THREE from 'three';
import { createSynchronousCanvasCapture } from './gpuPresentation.ts';
import { collectPendingUrls, pageRequestUrl } from './pageSelection.ts';
import { rasterVisibilityIds, shadeVisibility } from './visibilityBuffer.ts';
import { renderWebgpuPages } from './webgpuPagesRender.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Le magasin de lampes du contrat a changé. Rien n'est recalculé ici : l'image suivante relit le
 * magasin, repousse le tampon si sa révision a bougé, et l'ordonnanceur d'ombres reprend la main.
 * La capture en cache est invalidée pour que l'hôte ne relise pas l'image d'avant la lampe.
 */
export function refreshSceneLights(rt: WebgpuPagesRuntime) {
  const { lights } = rt;
  rt.capture.capturedRevision = -1;
  rt.diag.engineDiagnostic('direct-lighting-changed', 'Lampes du contrat actualisées', {
    version: 1,
    lights: lights.store.count,
    view: lights.store.lightingView,
    unlit: lights.store.unlit,
    exposure: lights.store.environment?.exposure ?? 1,
    shadowsPending: lights.plan.pending,
  });
}

/** Re-renders the last camera once new pages arrived, unless a readback is holding the image. */
export function syncResident(rt: WebgpuPagesRuntime) {
  const { run, gpu, capture } = rt;
  if (capture.secondaryCamera) return;
  if (run.lost || !rt.setup.gpuDevice || !gpu.cache || !run.lastCamera) return;
  // Page bytes are already accepted. Keep the submitted image stable until its
  // explicit readback completes; the next render selects/uploads those bytes.
  if (capture.capturePending) {
    capture.captureStreamingDeferrals++;
    return;
  }
  // A complete cut is reselected for the latest camera; CPU arrival alone
  // never authorizes replacing any region's GPU fallback.
  renderWebgpuPages(rt, run.lastCamera);
}

/** The current image, read synchronously through the presenter's canvas when no flush settled it. */
export function captureImage(rt: WebgpuPagesRuntime) {
  const { run, gpu, capture, diag } = rt,
    { gpuDevice } = rt.setup;
  if (run.lost) throw new Error('WEBGPU_LOST');
  if (capture.capturedPixels && capture.capturedRevision === run.imageRevision)
    return capture.capturedPixels;
  if (!gpu.presenter || !gpuDevice || !gpu.colorTexture || capture.secondaryCamera)
    throw new Error('CAPTURE_NOT_READY: render then await flush before capture');
  const encoder = gpuDevice.createCommandEncoder();
  gpu.presenter.present(encoder, gpu.colorTexture, ...gpu.targetSize);
  gpuDevice.queue.submit([encoder.finish()]);
  if (!gpu.synchronousCapture) {
    gpu.synchronousCapture = createSynchronousCanvasCapture();
    diag.engineDiagnostic('capture-synchronous', 'Lecture synchrone demandée par l’hôte', {
      outsideBeauty: true,
      prefer: 'await flush(); capture()',
    });
  }
  capture.capturedPixels = gpu.synchronousCapture.read(gpu.presenter.canvas);
  capture.capturedRevision = run.imageRevision;
  return capture.capturedPixels;
}

/** The drawn opaque pages with their bytes, as the CPU raster oracle reads them. */
function drawnOpaquePages(rt: WebgpuPagesRuntime) {
  return rt.run.drawn
    .filter((rec) => rec.array && !rec.transparent)
    .map((rec) => ({ ...rec, array: rec.array! }));
}

export function visibilityIds(rt: WebgpuPagesRuntime) {
  const size = rt.setup.viewport ?? rt.gpu.targetSize;
  return rasterVisibilityIds(
    drawnOpaquePages(rt),
    rt.run.lastCamera ?? new THREE.PerspectiveCamera(),
    size,
  );
}

export function rasterRgba(rt: WebgpuPagesRuntime) {
  const size = rt.setup.viewport ?? rt.gpu.targetSize,
    pages = drawnOpaquePages(rt),
    cam = rt.run.lastCamera ?? new THREE.PerspectiveCamera();
  return shadeVisibility(
    rasterVisibilityIds(pages, cam, size),
    pages,
    cam,
    size,
    rt.setup.clearColor,
  );
}

export function pendingUrls(rt: WebgpuPagesRuntime) {
  const { run } = rt;
  return collectPendingUrls(
    !rt.services.bootstrapState.ready
      ? rt.setup.bootstrap
      : run.coverageBudgetLimited
        ? []
        : run.desired,
    run.pendingScratch,
  );
}

export function pageUrls(rt: WebgpuPagesRuntime) {
  const { run } = rt,
    { urlScratch } = run;
  urlScratch.length = 0;
  const seen = new Set<string>();
  for (const list of [rt.setup.bootstrap, run.shown, run.coverageBudgetLimited ? [] : run.desired])
    for (let i = 0; i < list.length; i++) {
      const url = pageRequestUrl(list[i]);
      if (seen.has(url)) continue;
      seen.add(url);
      urlScratch.push(url);
    }
  return urlScratch;
}
