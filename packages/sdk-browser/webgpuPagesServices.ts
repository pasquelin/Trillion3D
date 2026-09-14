import type { PageRec } from './pageSelection.ts';
import { createWebgpuResidencyMirror } from './webgpuResidencyMirror.ts';
import { createPageRowWriter } from './webgpuPageRow.ts';
import { createWebgpuRowCommit } from './webgpuRowCommit.ts';
import { createWebgpuRowSync } from './webgpuRowSync.ts';
import { createBudgetedResidency } from './webgpuBudgetedResidency.ts';
import { createWebgpuPinUpdater } from './webgpuPinUpdater.ts';
import { createWebgpuBootstrap } from './webgpuBootstrap.ts';
import { createWebgpuResidentEnsurer } from './webgpuResidentEnsurer.ts';
import { createWebgpuResidencyQueue } from './webgpuResidencyQueue.ts';
import { createWebgpuCutAdopter } from './webgpuCutAdoption.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

export type WebgpuPagesServices = ReturnType<typeof createWebgpuPagesServices>;

/** The residency machinery: the row table sync, the bootstrap cover, the pin updater, the upload
 *  queue and the GPU cut adopter. Each reads the runtime lazily, so none holds a stale frame. */
export function createWebgpuPagesServices(rt: WebgpuPagesRuntime) {
  const { run, gpu, diag, context } = rt,
    { rows, packedPages, drawSlots, gpuWanted } = rt.layout,
    { tracking, bootstrap, bootstrapUrls, bootstrapKeys, bootstrapKey, slots } = rt.setup,
    { sourceBytes, requestUrlByPage } = rt.setup;
  const mirror = createWebgpuResidencyMirror({
    pageIndicesByUrl: rows.pageIndicesByUrl,
    residentOffsetWords: rows.residentOffsetWords,
    tracking,
    engineDiagnostic: diag.engineDiagnostic,
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
  });
  /**
   * Writes one page-table row. Called when a cluster claims a row, when its GPU slot moves, or when a
   * shared input changes epoch — never once per frame: every field below belongs to the page, its
   * material, its geometry block or its slot, none of them to the image.
   */
  const writePageRow = createPageRowWriter({
    geometryBlocks: rt.vis.geometryBlocks,
    mapLayer: rt.vis.mapLayer,
    dataLayer: rt.vis.dataLayer,
    uvScales: rt.vis.uvScales,
    dataUvScales: rt.vis.dataUvScales,
    markRowDirty: rows.markRowDirty,
  });
  /**
   * Applies the cache's arrivals and departures to the residency mirror. The mirror is the only
   * incremental state on this path, so the journal that feeds it is checked against the cache on every
   * drain: the journal's own resident count — every key it saw, rowed or not — must equal the cache's.
   * A disagreement means an entry moved without a record, and the mirror is rebuilt from the cache
   * instead of being left to drift into a hole.
   */
  const { commitRows, sourceRowOf } = createWebgpuRowCommit(rows, writePageRow);
  const { syncRows, syncRowsFromCut } = createWebgpuRowSync(
    rows,
    mirror,
    packedPages,
    run.drawn,
    drawSlots,
    () => !!gpu.cache,
    { commitRows, sourceRowOf },
  );
  const pageSource = {
    read: async (key: string) => {
      const bytes = sourceBytes.get(key);
      if (!bytes) throw new Error('Missing page');
      return bytes;
    },
  };
  const hasBytes = (rec: PageRec) => !!(rec.array || sourceBytes.has(rec.url));
  const budgetedResidency = createBudgetedResidency(tracking, bootstrapKey, bootstrapUrls, slots);
  const pinUpdater = createWebgpuPinUpdater(
    tracking,
    bootstrapKeys,
    bootstrapUrls,
    run.deferredDrops,
    requestUrlByPage,
    diag.traceEnabled,
    diag.traceDiagnostic,
  );
  const updatePins = () =>
    pinUpdater(gpu.cache, run.shown, run.gpuFrameActive, run.frame, (key) =>
      rt.backend.dropPage!(key),
    );
  const bootstrapState = createWebgpuBootstrap({
    pages: bootstrap,
    urls: bootstrapUrls,
    slots,
    tracking,
    signal: context.signal,
    readPage: context.readPage,
    acceptPage: (key, data) => rt.backend.acceptPage!(key, data),
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
    isLost: () => run.lost,
    hasBytes,
    engineDiagnostic: diag.engineDiagnostic,
    traceDiagnostic: diag.traceDiagnostic,
    diagnosticFailure: diag.diagnosticFailure,
  });
  const ensureResident = createWebgpuResidentEnsurer({
    getCache: () => gpu.cache,
    tracking,
    bootstrapKey,
    signal: context.signal,
    hasBytes,
    isLost: () => run.lost,
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
  });
  const residency = createWebgpuResidencyQueue({
    tracking,
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
    hasBytes,
    updatePins,
    ensureResident,
    markLost: () => {
      run.lost = true;
    },
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
    diagnosticFailure: diag.diagnosticFailure,
  });
  // Readback describes submitted work and future streaming requests. It never
  // decides the cut drawn for a moving camera; the current GPU mask does that.
  const cutAdopter = createWebgpuCutAdopter({
    selection: () => run.gpuSelection,
    packedPages,
    desired: run.desired,
    shown: run.shown,
    drawn: run.drawn,
    wanted: gpuWanted,
    transparentScratch: run.transparentScratch,
    drawableScratch: run.drawableScratch,
    uniforms: run.selectionUniforms,
    residentOffsetWords: rows.residentOffsetWords,
    frame: () => run.frame,
  });
  const adoptGpuCut = () => {
    if (!cutAdopter.adopt()) return;
    const metrics = cutAdopter.metrics;
    run.visible = metrics.visible;
    run.selectedTriangles = metrics.selectedTriangles;
    run.uncoveredTriangles = metrics.uncoveredTriangles;
    run.submittedTriangles = metrics.drawnTriangles + run.blendSubmittedTriangles;
    run.frustumRejected = metrics.frustumRejected;
    run.lodLevel = metrics.lodLevel;
    run.gpuMetricsReady = metrics.ready;
  };
  return {
    syncRows,
    syncRowsFromCut,
    pageSource,
    hasBytes,
    budgetedResidency,
    bootstrapState,
    ensureResident,
    residency,
    queueResident: residency.queueResident,
    adoptGpuCut,
  };
}
