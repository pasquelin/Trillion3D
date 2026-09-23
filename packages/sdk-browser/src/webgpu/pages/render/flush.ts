import { readGpuImage } from '../../../gpu/core/presentation.ts';
import { collectPendingUrls } from '../../../page/selection/selection.ts';
import { awaitedPages } from '../../row/pageSlots.ts';
import { outputColorDiagnostic } from '../helpers.ts';
import { fallbackToCpuCut } from '../io/drops.ts';
import { bounceState, directLightingState } from './encodeLights.ts';
import { wantsContractLighting } from '../prepare/lightResources.ts';
import { sunFarState } from '../prepare/sunFar.ts';
import { renderWebgpuPages } from './render.ts';
import { settlePose } from '../../tile/converge.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

function reportProgress(rt: WebgpuPagesRuntime) {
  const { run, gpu, blendState, diag, services, context } = rt;
  if (performance.now() - run.lastProgressMs < 2000) return;
  run.lastProgressMs = performance.now();
  diag.engineDiagnostic('render-progress', 'GPU render progress', {
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
    pendingPages: collectPendingUrls(
      awaitedPages(run.desired, run.awaitedScratch),
      run.pendingScratch,
    ).length,
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
    capture.capturePending = readGpuImage(gpuDevice, texture, width, height, context.signal)
      .then((pixels) => {
        if (run.lost || revision !== run.imageRevision) return;
        capture.capturedPixels = pixels;
        capture.capturedRevision = revision;
        if (run.outputDiagnosticLogged) return;
        run.outputDiagnosticLogged = true;
        const colors = outputColorDiagnostic(pixels, width, height, clearColor, 'bottom-left');
        diag.engineDiagnostic('first-readback', 'First explicit readback of the WebGPU target', {
          width,
          height,
          origin: 'bottom-left',
          ...colors,
        });
        diag.engineDiagnostic('presentation-capture', 'Explicit capture of the WebGPU render', {
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
      'Streaming update deferred to the next render during capture',
      {
        imageRevision: capture.capturedRevision,
        deferredUpdates: capture.captureStreamingDeferrals,
        pagesRetained: true,
      },
    );
  }
}

/** Settles everything the last render left in flight: texture tiles, residency, timing, the GPU
 *  selection readback and the explicit image readback. */
export async function flushWebgpuPages(rt: WebgpuPagesRuntime) {
  const { run, gpu, capture, timing, diag, services } = rt,
    { gpuDevice } = rt.setup;
  // The held-image witness is NOT removed by default: a host that drains every image would then
  // never have a held image. Every drain that actually changes the image announces it itself — a
  // texture that arrives and a page that enters or leaves residency increment the resource
  // revision, an abandoned selection removes the witness. What remains is adoption of a readback,
  // which is replayed here after the host has taken its lists: it is removed below, and only when
  // it has changed something.
  await Promise.resolve();
  // The lighting-contract program compiles outside the image. If a lamp was waiting for it, the
  // pose is redrawn with it before any read: a drained pose is a lit pose.
  if (gpu.deferred && wantsContractLighting(rt) && !gpu.deferred.usesContract) {
    await gpu.deferred.settle();
    if (run.lastCamera && !capture.capturing && !run.lost) renderWebgpuPages(rt, run.lastCamera);
  }
  // Texture tiles are part of preparing a pose, not of a per-image decoration: a surface read at
  // a coarse level will change when its tile arrives. `render` only admits a byte budget per
  // image; the barrier converges the rest here, outside the measured loop, then drains the shadow
  // maps, and starts again as long as a drain redrew something (`settlePose`): a drained pose is
  // a pose served as well as the pool can give, whose shadow describes the image.
  await settlePose(rt, gpuDevice);
  await services.bootstrapState.ensure();
  await services.residency.pending;
  if (run.coverageBudgetEvent) {
    diag.engineDiagnostic(
      'coverage-budget',
      'Admission of the requested cut',
      run.coverageBudgetEvent,
    );
    run.coverageBudgetEvent = undefined;
  }
  await timing.gpuTiming?.flush();
  reportProgress(rt);
  if (run.gpuSelection) {
    try {
      await run.gpuSelection.flush();
      if (run.gpuSelection.failed()) fallbackToCpuCut(rt, 'selection readback failed');
      // Origin of the resource change: adoption of a readback rewrote the cut lists.
      else if (run.gpuFrameActive && services.adoptGpuCut()) run.gate.resourcesChanged();
    } catch (error) {
      diag.diagnosticFailure('gpu-selection-flush-failed', error);
      fallbackToCpuCut(rt, 'selection drain failed');
    }
  }
  if (
    gpuDevice &&
    gpu.colorTexture &&
    !capture.capturing &&
    run.imageRevision > 0 &&
    capture.capturedRevision !== run.imageRevision
  )
    await readBackImage(rt, gpuDevice);
  await Promise.resolve();
}
