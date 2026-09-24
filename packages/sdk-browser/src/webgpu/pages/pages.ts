import { pendingWebgpuFrame } from '../frame/interactiveFrame.ts';
import { readShadowAtlasDigest } from '../../gpu/shadow/digest.ts';
import { readPartitionAudit } from '../core/partitionAudit.ts';
import { readTransparentOcclusionAudit } from '../transparent/occlusionAudit.ts';
import { disabledStageProfile } from '../../../../sdk-core/src/index.ts';
import type { BackendFactory } from '../../backend/types.ts';
import { createWebgpuPagesRuntime, type WebgpuPagesBackend } from './runtime.ts';
import { prepareGpuTiming } from './prepare/timing.ts';
import { prepareWebgpuPages } from './prepare/prepare.ts';
import { setWebgpuBounce } from './prepare/bounce.ts';
import { reserveRootBoxes } from '../../math/batchBoxes.ts';
import { renderWebgpuPages } from './render/render.ts';
import { flushWebgpuPages } from './render/flush.ts';
import { captureSurfaceView } from './io/surfaceCapture.ts';
import { captureColorView } from './io/colorCapture.ts';
import {
  captureImage,
  pageUrls,
  pendingUrls,
  rasterRgba,
  refreshSceneLights,
  retainedRanks,
  syncResident,
  visibilityIds,
} from './io/hostApi.ts';
import { acceptPage, dropPage } from './io/pageApi.ts';
import { createArrivalSpecs } from '../../page/integration/arrivalSpecs.ts';
import { endCpuFrame, hostCpuStep } from './render/cpuSteps.ts';
import { setWebgpuTransform } from './render/transform.ts';
import { updateWebgpuPlacements } from '../../placement/webgpuPlacements.ts';
import { disposeWebgpuPages, metricsOf } from './io/metrics.ts';
import { setWebgpuMemoryBudgets } from './io/memory.ts';
import { installGpuDeviceLedger } from '../../gpu/core/deviceLedger.ts';
import { claimWebgpuDevice } from './io/lost.ts';
import type { GpuDeviceClaim } from '../../gpu/core/deviceOwners.ts';
export { outputColorDiagnostic } from './helpers.ts';

/** WebGPU raster of cluster pages. GPU frustum + per-cluster error band when compute is available;
 *  `selectVisiblePages` remains the CPU oracle and the silent fallback. The state lives in the
 *  runtime; each method hands it to the module that owns that responsibility. */
export const webgpuPagesBackend: BackendFactory = (context) => {
  const rt = createWebgpuPagesRuntime(context);
  const { run, setup, diag } = rt;
  // Integer record of a request, set once per address: that is all off-thread integration
  // receives from an arrival.
  const pageSpecs = createArrivalSpecs(setup.byUrl, rt.layout.rows.pageIndexOf);
  // The device this session holds, until it is disposed: the errors it raises reach it alone.
  let claim: GpuDeviceClaim | undefined, closing: Promise<void> | undefined;
  const backend: WebgpuPagesBackend = {
    id: 'webgpu-page-raster',
    capabilities: rt.capabilities,
    scene: setup.scene,
    get presentedSurface() {
      // The host canvas needs no composition: the engine already presented into it. A lost or
      // disposed device has no presenter left: nothing stale is published (`markWebgpuLost`).
      return context.gpuCanvas ? undefined : rt.gpu.presenter?.canvas;
    },
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
    setBounce(on) {
      setWebgpuBounce(rt, on);
    },
    updatePlacements(rows, from, to) {
      updateWebgpuPlacements(rt, rows, from, to);
    },
    refreshMaterials() {
      // Every row is written again at the next frame, and the writer rereads each surface whose
      // version moved (`row/pageRowConstants.ts`); only values changed, so no resolve class did.
      rt.layout.rows.tableEpoch++;
      run.gate.sceneMoved();
    },
    setMemoryBudgets: (budgets) => setWebgpuMemoryBudgets(rt, budgets),
    async prepare() {
      context.signal?.throwIfAborted();
      const { gpuDevice } = context;
      if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE');
      // Disposed before it prepared: nothing failed, and a claim now would never be released.
      if (run.lost)
        throw new DOMException('The backend was disposed before it prepared', 'AbortError');
      // The allocation ledger, once per device: everything that follows is counted in it.
      installGpuDeviceLedger(gpuDevice);
      // The session creates through its own handle, whose labels name it.
      claim = claimWebgpuDevice(rt, gpuDevice);
      try {
        // A device already lost is announced by the claim: nothing is built on it.
        if (run.lost) throw new Error('WEBGPU_LOST');
        prepareGpuTiming(rt, claim.device);
        await prepareWebgpuPages(rt, claim.device);
        // The batch of root world boxes is reserved last: the module's linear memory will no
        // longer grow behind it, and a node move will allocate nothing more.
        context.preparationStep?.('root boxes');
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
    pendingFrame: () => pendingWebgpuFrame(rt),
    flush() {
      return flushWebgpuPages(rt);
    },
    captureSurfaceView(camera, options) {
      return captureSurfaceView(rt, camera, options);
    },
    captureColorView(camera, size) {
      return captureColorView(rt, camera, size);
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
      rt.timing.cpuWindow.reset();
    },
    cpuSteps() {
      return rt.timing.cpuWindow.summary();
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
      const device = rt.gpu.device;
      if (!device || !rt.lights.shadows) return Promise.resolve(null);
      return readShadowAtlasDigest(device, rt.lights.shadows);
    },
    dispose() {
      // Once: a backend closed before it prepared is closed again by whoever prepared it.
      return (closing ??= disposeWebgpuPages(rt, claim));
    },
  };
  return backend;
};
