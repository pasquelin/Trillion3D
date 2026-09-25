import { createSynchronousCanvasCapture } from '../../../gpu/core/presentation.ts';
import { collectPendingUrls, type PageRec } from '../../../page/selection/selection.ts';
import { awaitedPages } from '../../row/pageSlots.ts';
import { withClosure } from '../../../page/selection/bundleDependencies.ts';
import { rasterVisibilityIds, shadeVisibility } from '../../../visibility/buffer.ts';
import { renderWebgpuPages } from '../render/render.ts';
import { defaultEngineCamera } from '../../../camera/world.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** What the image waits for when the budget has taken its cut: nothing, and always the same nothing. */
const EMPTY_CUT: readonly PageRec[] = [];

/**
 * The contract's light store has changed. Nothing is recomputed here: the next image rereads the
 * store, pushes the buffer again if its revision moved, and the shadow scheduler takes over. The
 * cached capture is invalidated so the host does not reread the image from before the light.
 */
export function refreshSceneLights(rt: WebgpuPagesRuntime) {
  const { lights } = rt;
  rt.capture.capturedRevision = -1;
  // Origin of the scene change: a declared light was added, set or removed.
  rt.run.gate.sceneChanged();
  rt.diag.engineDiagnostic('direct-lighting-changed', 'Contract lights updated', {
    version: 1,
    lights: lights.store.count,
    view: lights.store.lightingView,
    unlit: lights.store.unlit,
    exposure: lights.store.environment?.exposure ?? 1,
    shadowPagesPending: lights.plan.counts.pendingPages,
  });
}

/** Re-renders the last camera once new pages arrived, unless a readback is holding the image. */
export function syncResident(rt: WebgpuPagesRuntime) {
  const { run, gpu, capture } = rt;
  if (capture.capturing) return;
  if (run.lost || !gpu.device || !gpu.cache || !run.lastCamera) return;
  // Page bytes are already accepted. Keep the submitted image stable until its
  // explicit readback completes; the next render selects/uploads those bytes.
  if (capture.capturePending) {
    capture.captureStreamingDeferrals++;
    return;
  }
  // A complete cut is reselected for the latest camera; CPU arrival alone
  // never authorizes replacing any region's GPU fallback.
  // Origin of the resource change: residency just moved under the held image.
  run.gate.resourcesChanged();
  renderWebgpuPages(rt, run.lastCamera);
}

/** The current image, read synchronously through the presenter's canvas when no flush settled it. */
export function captureImage(rt: WebgpuPagesRuntime) {
  const { run, gpu, capture, diag } = rt,
    gpuDevice = gpu.device;
  if (run.lost) throw new Error('WEBGPU_LOST');
  if (capture.capturedPixels && capture.capturedRevision === run.imageRevision)
    return capture.capturedPixels;
  if (!gpu.presenter || !gpuDevice || !gpu.colorTexture || capture.capturing)
    throw new Error('CAPTURE_NOT_READY: render then await flush before capture');
  const encoder = gpuDevice.createCommandEncoder();
  gpu.presenter.present(encoder, gpu.colorTexture, ...gpu.targetSize);
  gpuDevice.queue.submit([encoder.finish()]);
  if (!gpu.synchronousCapture) {
    gpu.synchronousCapture = createSynchronousCanvasCapture();
    diag.engineDiagnostic('capture-synchronous', 'Synchronous read requested by the host', {
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

/** Camera the oracles read: the last image's, or a fresh host camera's while no image has been
 *  rendered. */
function engineCameraOf(rt: WebgpuPagesRuntime) {
  return rt.run.lastCamera ? rt.run.gate.cam : defaultEngineCamera();
}

export function visibilityIds(rt: WebgpuPagesRuntime) {
  const size = rt.setup.viewport ?? rt.gpu.targetSize;
  return rasterVisibilityIds(drawnOpaquePages(rt), engineCameraOf(rt), size, rt.setup.pixelRatio());
}

export function rasterRgba(rt: WebgpuPagesRuntime) {
  const size = rt.setup.viewport ?? rt.gpu.targetSize,
    pages = drawnOpaquePages(rt),
    cam = engineCameraOf(rt),
    pixelRatio = rt.setup.pixelRatio();
  return shadeVisibility(
    rasterVisibilityIds(pages, cam, size, pixelRatio),
    pages,
    cam,
    size,
    rt.run.clearColor,
    pixelRatio,
  );
}

/**
 * Addresses the image still waits for. They are a function of the requested cut, the budget flag,
 * bootstrap coverage and the bytes the pages hold — and of nothing else. An image that reread the
 * sample it already held, with no page receiving or losing its bytes, therefore returns exactly the
 * list already yielded.
 */
export function pendingUrls(rt: WebgpuPagesRuntime) {
  const { run } = rt,
    ready = rt.services.bootstrapState.ready,
    held = run.pendingHeld;
  if (
    run.cutHeld &&
    held.cut === run.cutEpoch &&
    held.epoch === run.pageArrayEpoch &&
    held.limited === run.coverageBudgetLimited &&
    held.ready === ready
  )
    return run.hostPendingScratch;
  held.cut = run.cutEpoch;
  held.epoch = run.pageArrayEpoch;
  held.limited = run.coverageBudgetLimited;
  held.ready = ready;
  // Until pinned coverage is there, that is what we wait for. Then the cut itself holds the list of
  // its rows without bytes: those are the only ones to walk, and a fully arrived cut — the ordinary
  // case — walks none.
  const waiting = !ready
    ? awaitedPages(rt.setup.bootstrap, run.awaitedScratch)
    : run.coverageBudgetLimited
      ? EMPTY_CUT
      : rt.services.cutPending.records;
  return collectPendingUrls(waiting, run.hostPendingScratch, rt.setup.requestStamps);
}

/**
 * Addresses the host pins after the render: bootstrap coverage, what the image draws and what the
 * cut asks. The request-key rank is posted once and for all by the catalogue: two pages that share
 * a request share their rank, and dedup splits them by a stamp instead of hashing a hundred thousand
 * strings per image. Same addresses, same order, same length as a string set. And an image that
 * reread the sample already held reads three unchanged lists: it returns the one it yielded rather
 * than remaking it.
 */
export function pageUrls(rt: WebgpuPagesRuntime) {
  const { run } = rt,
    { urlScratch } = run,
    stamps = rt.setup.requestStamps,
    held = run.urlsHeld;
  if (
    run.cutHeld &&
    held.cut === run.cutEpoch &&
    held.epoch === run.pageArrayEpoch &&
    held.limited === run.coverageBudgetLimited
  )
    return urlScratch;
  held.cut = run.cutEpoch;
  held.epoch = run.pageArrayEpoch;
  held.limited = run.coverageBudgetLimited;
  urlScratch.length = 0;
  stamps.begin();
  stamps.mark(rt.setup.bootstrap, urlScratch);
  stamps.mark(run.shown, urlScratch);
  if (!run.coverageBudgetLimited) withClosure(run.desired, (list) => stamps.mark(list, urlScratch));
  return urlScratch;
}

/**
 * The same pins as `pageUrls`, stated as a rank delta: what entered and what left since the previous
 * image. No string, no key set, no allocation — three lists walked as integers, and the cache then
 * touches only what moved. An image that reread the sample already held does not even walk these
 * lists: it returns the empty delta.
 */
export function retainedRanks(rt: WebgpuPagesRuntime) {
  const { run } = rt,
    ranks = rt.setup.hostRanks,
    held = run.ranksHeld;
  if (
    run.cutHeld &&
    held.cut === run.cutEpoch &&
    held.epoch === run.pageArrayEpoch &&
    held.limited === run.coverageBudgetLimited
  )
    return ranks.hold();
  held.cut = run.cutEpoch;
  held.epoch = run.pageArrayEpoch;
  held.limited = run.coverageBudgetLimited;
  ranks.begin();
  ranks.mark(rt.setup.bootstrap);
  ranks.mark(run.shown);
  if (!run.coverageBudgetLimited) withClosure(run.desired, ranks.mark);
  return ranks.finish();
}
