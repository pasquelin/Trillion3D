import { readGpuImage, readbackBytesPerRow } from './gpuPresentation.ts';
import { collectPendingUrls } from './pageSelection.ts';
import { outputColorDiagnostic } from './webgpuPagesHelpers.ts';
import { checkFrameBudget } from './webgpuPagesTargets.ts';
import { dropGpuSelection } from './webgpuPagesDrops.ts';
import { bounceState, directLightingState } from './webgpuPagesEncodeLights.ts';
import { wantsContractLighting } from './webgpuPagesLightResources.ts';
import { sunFarState } from './webgpuPagesPrepareSunFar.ts';
import { renderWebgpuPages } from './webgpuPagesRender.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

function reportProgress(rt: WebgpuPagesRuntime) {
  const { run, gpu, blendState, diag, services, context } = rt;
  if (performance.now() - run.lastProgressMs < 2000) return;
  run.lastProgressMs = performance.now();
  diag.engineDiagnostic('render-progress', 'Suivi du rendu GPU', {
    frame: run.frame,
    coverage: {
      version: 1,
      ready: services.bootstrapState.ready,
      bootstrapPages: rt.setup.bootstrap.length,
      budgetLimited: run.coverageBudgetLimited,
    },
    directLighting: { version: 1, ...directLightingState(rt) },
    bounce: { version: 1, ...bounceState(rt) },
    sunFarShadows: { version: 1, ...sunFarState(rt) },
    selectedPages: run.shown.length,
    residentPages: run.drawn.length,
    selectedTriangles: run.selectedTriangles,
    submittedTriangles: run.submittedTriangles,
    transparent: {
      version: 1,
      candidates: blendState.blendGpu.length,
      visibleMeshes: blendState.visibleBlend.length,
      frustumRejected: run.blendFrustumRejected,
      drawCalls: run.blendDrawCalls,
      submittedTriangles: run.blendSubmittedTriangles,
      gpuMs: null,
    },
    pendingPages: collectPendingUrls(run.desired, run.pendingScratch).length,
    surfaceVersion: gpu.surfaces?.version ?? null,
    presentation: context.gpuCanvas ? 'direct' : 'composed',
    imageReadbackDuringRender: false,
  });
}

/** Reads the settled image back once per submission, logging the first readback's colours. */
async function readBackImage(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { run, gpu, capture, diag, context } = rt,
    { clearColor } = rt.setup;
  if (!capture.capturePending) {
    const revision = run.imageRevision,
      [width, height] = gpu.targetSize,
      texture = gpu.colorTexture!;
    checkFrameBudget(
      rt,
      width,
      height,
      capture.captureAllocationBytes + readbackBytesPerRow(width) * height,
    );
    capture.capturePending = readGpuImage(gpuDevice, texture, width, height, context.signal)
      .then((pixels) => {
        if (run.lost || revision !== run.imageRevision) return;
        capture.capturedPixels = pixels;
        capture.capturedRevision = revision;
        if (run.outputDiagnosticLogged) return;
        run.outputDiagnosticLogged = true;
        const colors = outputColorDiagnostic(pixels, width, height, clearColor, 'bottom-left');
        diag.engineDiagnostic('first-readback', 'Premier relevé explicite de la cible WebGPU', {
          width,
          height,
          origin: 'bottom-left',
          ...colors,
        });
        diag.engineDiagnostic('presentation-capture', 'Capture explicite du rendu WebGPU', {
          width,
          height,
          origin: 'bottom-left',
          imageRevision: revision,
          surface: 'webgpu-color-target',
          ...colors,
        });
      })
      .finally(() => {
        capture.capturePending = undefined;
      });
  }
  await capture.capturePending;
  if (run.lost) throw new Error('WEBGPU_LOST');
  if (capture.capturedRevision !== run.imageRevision)
    throw new Error('CAPTURE_CHANGED_DURING_FLUSH');
  if (capture.captureStreamingDeferrals && !capture.captureDeferralLogged) {
    capture.captureDeferralLogged = true;
    diag.engineDiagnostic(
      'capture-streaming-deferred',
      'Mise à jour du streaming reportée au rendu suivant pendant la capture',
      {
        imageRevision: capture.capturedRevision,
        deferredUpdates: capture.captureStreamingDeferrals,
        pagesRetained: true,
      },
    );
  }
}

/** Settles everything the last render left in flight: texture layers, residency, timing, the GPU
 *  selection readback and the explicit image readback. */
export async function flushWebgpuPages(rt: WebgpuPagesRuntime) {
  const { run, gpu, vis, capture, timing, diag, services } = rt,
    { gpuDevice } = rt.setup;
  await Promise.resolve();
  // Le programme du contrat d'éclairage se compile hors de l'image. Si une lampe l'attendait, la
  // pose est redessinée avec lui avant toute lecture : une pose vidée est une pose éclairée.
  if (gpu.deferred && wantsContractLighting(rt) && !gpu.deferred.usesContract) {
    await gpu.deferred.settle();
    if (run.lastCamera && !capture.secondaryCamera && !run.lost)
      renderWebgpuPages(rt, run.lastCamera);
  }
  // Material texture layers are part of readiness, not a per-frame decoration: a page drawn before
  // its layer lands is shaded from layer 0, so the image of one camera keeps changing while the
  // queue drains. `render` still admits at most `textureBudget` bytes per frame; the explicit
  // barrier drains the rest here, outside the measured loop, so a flushed pose is settled.
  while (gpuDevice && vis.textureJobs.length) await rt.texturePump.pump();
  await rt.texturePump.pending;
  await services.bootstrapState.ensure();
  await services.residency.pending;
  if (run.coverageBudgetEvent) {
    diag.engineDiagnostic(
      'coverage-budget',
      'Admission de la coupe demandée',
      run.coverageBudgetEvent,
    );
    run.coverageBudgetEvent = undefined;
  }
  await timing.gpuTiming?.flush();
  reportProgress(rt);
  if (run.gpuSelection) {
    try {
      await run.gpuSelection.flush();
      if (run.gpuSelection.failed()) dropGpuSelection(rt);
      else if (run.gpuFrameActive) services.adoptGpuCut();
    } catch (error) {
      diag.diagnosticFailure('gpu-selection-fallback', error);
      dropGpuSelection(rt);
    }
  }
  if (
    gpuDevice &&
    gpu.colorTexture &&
    !capture.secondaryCamera &&
    run.imageRevision > 0 &&
    capture.capturedRevision !== run.imageRevision
  )
    await readBackImage(rt, gpuDevice);
  await Promise.resolve();
}
