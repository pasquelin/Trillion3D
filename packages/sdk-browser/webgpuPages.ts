import { readShadowAtlasDigest } from './gpuShadowDigest.ts';
import { readPartitionAudit } from './webgpuPartitionAudit.ts';
import { readTransparentOcclusionAudit } from './webgpuTransparentOcclusionAudit.ts';
import { disabledStageProfile } from '../sdk-core/index.ts';
import type { BackendFactory } from './backendTypes.ts';
import { createWebgpuPagesRuntime, type WebgpuPagesBackend } from './webgpuPagesRuntime.ts';
import { prepareGpuTiming, watchGpuDevice } from './webgpuPagesPrepareTiming.ts';
import { prepareWebgpuPages } from './webgpuPagesPrepare.ts';
import { renderWebgpuPages } from './webgpuPagesRender.ts';
import { flushWebgpuPages } from './webgpuPagesFlush.ts';
import { captureSurfaceView } from './webgpuPagesSurfaceCapture.ts';
import {
  captureImage,
  pageUrls,
  pendingUrls,
  rasterRgba,
  refreshSceneLights,
  syncResident,
  visibilityIds,
} from './webgpuPagesHostApi.ts';
import { acceptPage, dropPage } from './webgpuPagesPageApi.ts';
import { createArrivalSpecs } from './pageArrivalSpecs.ts';
import { endCpuFrame, hostCpuStep } from './webgpuPagesCpuSteps.ts';
import { setWebgpuTransform } from './webgpuPagesTransform.ts';
import { disposeWebgpuPages, metricsOf } from './webgpuPagesMetrics.ts';
export { outputColorDiagnostic } from './webgpuPagesHelpers.ts';

/** WebGPU raster of cluster pages. GPU frustum + per-cluster error band when compute is available;
 *  `selectVisiblePages` remains the CPU oracle and the silent fallback. The state lives in the
 *  runtime; each method hands it to the module that owns that responsibility. */
export const webgpuPagesBackend: BackendFactory = (context) => {
  const rt = createWebgpuPagesRuntime(context);
  const { run, setup, diag } = rt;
  // La fiche d'entiers d'une requête, posée une fois par adresse : c'est tout ce que l'intégration
  // hors fil reçoit d'une arrivée.
  const pageSpecs = createArrivalSpecs(setup.byUrl, rt.layout.rows.pageIndexOf);
  const onGpuError = (event: GPUUncapturedErrorEvent) => {
    diag.diagnosticFailure('gpu-uncaptured-error', event.error);
    run.lost = true;
  };
  const backend: WebgpuPagesBackend = {
    id: 'webgpu-page-raster',
    capabilities: rt.capabilities,
    scene: setup.scene,
    get overBudget() {
      return run.overBudget;
    },
    setDiagnostic(mode) {
      run.diagnostic = mode;
      // La vue de diagnostic change les lignes de la table et l'ombrage : la scène est à refaire.
      run.gate.sceneChanged();
    },
    refreshSceneLights() {
      refreshSceneLights(rt);
    },
    /** Le seul moteur qui porte l'atlas d'ombres du contrat : tout le reste se lit dans ses méthodes. */
    lighting: { shadows: true },
    setTransform(nodeName, matrix) {
      setWebgpuTransform(rt, nodeName, matrix);
    },
    async prepare() {
      context.signal?.throwIfAborted();
      const { gpuDevice, bootstrap, slots } = setup;
      if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE');
      if (bootstrap.length > slots)
        throw new Error(
          `INITIAL_COVERAGE_BUDGET: ${bootstrap.length} pages required, ${slots} slots`,
        );
      prepareGpuTiming(rt, gpuDevice);
      watchGpuDevice(rt, gpuDevice, onGpuError);
      try {
        await prepareWebgpuPages(rt, gpuDevice);
      } catch (error) {
        diag.diagnosticFailure('webgpu-prepare-failed', error);
        throw error;
      }
    },
    render(camera) {
      renderWebgpuPages(rt, camera);
    },
    syncResident() {
      syncResident(rt);
    },
    flush() {
      return flushWebgpuPages(rt);
    },
    captureSurfaceView(camera, options) {
      return captureSurfaceView(rt, camera, options);
    },
    capture() {
      return captureImage(rt);
    },
    selectedPageIds() {
      return run.shown.map((rec) => rec.url);
    },
    visibilityIds() {
      return visibilityIds(rt);
    },
    rasterRgba() {
      return rasterRgba(rt);
    },
    pendingUrls() {
      return pendingUrls(rt);
    },
    pageUrls() {
      return pageUrls(rt);
    },
    pageSpecs(url) {
      return pageSpecs(url);
    },
    acceptPage(url, array, plan) {
      acceptPage(rt, url, array, plan);
    },
    dropPage(url) {
      dropPage(rt, url);
    },
    metrics() {
      return metricsOf(rt);
    },
    resetStageProfile() {
      rt.timing.stages?.reset();
    },
    cpuStep(step, ms) {
      hostCpuStep(rt, step, ms);
    },
    cpuFrameEnd() {
      endCpuFrame(rt);
    },
    stageProfile() {
      return (
        rt.timing.stages?.profile() ??
        disabledStageProfile('webgpu-page-raster', 'profil par étape non demandé par l’hôte')
      );
    },
    partitionAudit() {
      return readPartitionAudit(rt);
    },
    transparentOcclusionAudit() {
      return readTransparentOcclusionAudit(rt);
    },
    shadowAtlasDigest() {
      const device = rt.setup.gpuDevice;
      if (!device || !rt.lights.shadows) return Promise.resolve(null);
      return readShadowAtlasDigest(device, rt.lights.shadows);
    },
    dispose() {
      return disposeWebgpuPages(rt, onGpuError);
    },
  };
  return backend;
};
