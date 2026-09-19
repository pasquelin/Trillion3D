import { readShadowAtlasDigest } from './gpuShadowDigest.ts';
import { readPartitionAudit } from './webgpuPartitionAudit.ts';
import { readTransparentOcclusionAudit } from './webgpuTransparentOcclusionAudit.ts';
import { disabledStageProfile } from '../sdk-core/index.ts';
import type { BackendFactory } from './backendTypes.ts';
import { createWebgpuPagesRuntime, type WebgpuPagesBackend } from './webgpuPagesRuntime.ts';
import { prepareGpuTiming, watchGpuDevice } from './webgpuPagesPrepareTiming.ts';
import { prepareWebgpuPages } from './webgpuPagesPrepare.ts';
import { reserveRootBoxes } from './mathBatchBoxes.ts';
import { renderWebgpuPages } from './webgpuPagesRender.ts';
import { flushWebgpuPages } from './webgpuPagesFlush.ts';
import { captureSurfaceView } from './webgpuPagesSurfaceCapture.ts';
import {
  captureImage,
  pageUrls,
  pendingUrls,
  rasterRgba,
  refreshSceneLights,
  retainedRanks,
  syncResident,
  visibilityIds,
} from './webgpuPagesHostApi.ts';
import { acceptPage, dropPage } from './webgpuPagesPageApi.ts';
import { createArrivalSpecs } from './pageArrivalSpecs.ts';
import { endCpuFrame, hostCpuStep } from './webgpuPagesCpuSteps.ts';
import { setWebgpuTransform } from './webgpuPagesTransform.ts';
import { disposeWebgpuPages, metricsOf } from './webgpuPagesMetrics.ts';
import { setWebgpuMemoryBudgets } from './webgpuPagesMemory.ts';
import { installGpuDeviceLedger } from './gpuDeviceLedger.ts';
export { outputColorDiagnostic } from './webgpuPagesHelpers.ts';

/** WebGPU raster of cluster pages. GPU frustum + per-cluster error band when compute is available;
 *  `selectVisiblePages` remains the CPU oracle and the silent fallback. The state lives in the
 *  runtime; each method hands it to the module that owns that responsibility. */
export const webgpuPagesBackend: BackendFactory = (context) => {
  const rt = createWebgpuPagesRuntime(context);
  const { run, setup, diag } = rt;
  // Integer record of a request, set once per address: that is all off-thread integration
  // receives from an arrival.
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
      // The diagnostic view changes the table rows and the shading: the scene must be rebuilt.
      run.gate.sceneChanged();
    },
    refreshSceneLights() {
      refreshSceneLights(rt);
    },
    /** The only engine that carries the contract's shadow atlas: everything else is read in its methods. */
    lighting: { shadows: true },
    setTransform(nodeName, matrix) {
      setWebgpuTransform(rt, nodeName, matrix);
    },
    setMemoryBudgets: (budgets) => setWebgpuMemoryBudgets(rt, budgets),
    async prepare() {
      context.signal?.throwIfAborted();
      const { gpuDevice } = setup;
      if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE');
      // The allocation ledger is installed before the first one: everything that follows is counted in it.
      installGpuDeviceLedger(gpuDevice);
      prepareGpuTiming(rt, gpuDevice);
      watchGpuDevice(rt, gpuDevice, onGpuError);
      try {
        await prepareWebgpuPages(rt, gpuDevice);
        // The batch of root world boxes is reserved last: the module's linear memory will no
        // longer grow behind it, and a node move will allocate nothing more.
        rt.layout.rootBoxes = await reserveRootBoxes(rt.layout.selectionRoots);
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
    retainedRanks() {
      return retainedRanks(rt);
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
        disabledStageProfile('webgpu-page-raster', 'per-step profile not requested by the host')
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
