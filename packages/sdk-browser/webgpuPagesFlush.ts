import { readGpuImage, readbackBytesPerRow } from './gpuPresentation.ts';
import { collectPendingUrls } from './pageSelection.ts';
import { outputColorDiagnostic } from './webgpuPagesHelpers.ts';
import { checkFrameBudget } from './webgpuPagesTargets.ts';
import { fallbackToCpuCut } from './webgpuPagesDrops.ts';
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
  // Le témoin d'image tenue n'est PAS retiré d'office : un hôte qui vide à chaque image n'aurait
  // alors jamais d'image tenue. Chaque drainage qui change réellement l'image l'annonce lui-même —
  // une texture qui arrive et une page qui entre ou sort de la résidence incrémentent la révision
  // des ressources, une sélection abandonnée retire le témoin. Reste l'adoption d'un relevé, qui se
  // rejoue ici après que l'hôte a pris ses listes : elle est retirée plus bas, et seulement quand
  // elle a changé quelque chose.
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
  // Le budget d'octets engagés est levé ici : une capture de référence doit converger, et une file
  // que le budget refuse ne se viderait jamais. En boucle d'images libre, il s'applique.
  // Chaque passe est attendue par l'appareil avant la suivante. Sans ce garde-fou, la barrière
  // empile la file entière — jusqu'à plusieurs gigaoctets — dans un seul tour de boucle JavaScript :
  // le fil est bloqué, la file de commandes déborde, et l'image qui suit la barrière paie tout le
  // retard d'un coup (200 à 500 ms mesurées sur Emerald). L'attente est ici et nulle part ailleurs :
  // le chemin d'image, lui, pousse une passe par image et ne doit rien attendre.
  while (gpuDevice && vis.textureJobs.length) {
    rt.texturePump.pump(true);
    await gpuDevice.queue.onSubmittedWorkDone();
  }
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
      if (run.gpuSelection.failed()) fallbackToCpuCut(rt, 'relevé de sélection en échec');
      // Origine du changement de ressources : l'adoption d'un relevé a réécrit les listes de coupe.
      else if (run.gpuFrameActive && services.adoptGpuCut()) run.gate.resourcesChanged();
    } catch (error) {
      diag.diagnosticFailure('gpu-selection-flush-failed', error);
      fallbackToCpuCut(rt, 'vidange de la sélection en erreur');
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
