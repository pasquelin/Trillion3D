import type { PageRec } from './pageSelection.ts';
import { updateTransparentSpan } from './webgpuTransparentSpans.ts';
import { createWebgpuResidencyMirror } from './webgpuResidencyMirror.ts';
import { createPageRowWriter } from './webgpuPageRow.ts';
import { createWebgpuRowCommit } from './webgpuRowCommit.ts';
import { noteResidenceChange } from './webgpuShadowBounds.ts';
import { createWebgpuRowSync } from './webgpuRowSync.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { createWebgpuResidencySets } from './webgpuResidencySets.ts';
import { createWebgpuPinUpdater } from './webgpuPinUpdater.ts';
import { createWebgpuBootstrap } from './webgpuBootstrap.ts';
import { createWebgpuResidentEnsurer } from './webgpuResidentEnsurer.ts';
import { createWebgpuResidencyQueue } from './webgpuResidencyQueue.ts';
import { createWebgpuCutAdopter } from './webgpuCutAdoption.ts';
import { acceptPage, dropPage } from './webgpuPagesPageApi.ts';
import { markDrawnMirrored } from './webgpuPagesHelpers.ts';
import type { WebgpuPagesCore } from './webgpuPagesRuntime.ts';

export type WebgpuPagesServices = ReturnType<typeof createWebgpuPagesServices>;

/** The residency machinery: the row table sync, the bootstrap cover, the pin updater, the upload
 *  queue and the GPU cut adopter. Each reads the runtime lazily, so none holds a stale frame. */
export function createWebgpuPagesServices(rt: WebgpuPagesCore) {
  const { run, gpu, diag, context } = rt,
    { rows, packedPages, drawSlots, gpuWanted } = rt.layout,
    { tracking, bootstrap, bootstrapUrls, bootstrapKey, slots } = rt.setup,
    { sourceBytes, byUrl } = rt.setup;
  const mirror = createWebgpuResidencyMirror({
    pageIndicesByUrl: rows.pageIndicesByUrl,
    residentOffsetWords: rows.residentOffsetWords,
    tracking,
    engineDiagnostic: diag.engineDiagnostic,
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
    onOffsetChange: (page, offset) => updateTransparentSpan(rt, page, offset),
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
  // Le miroir de résidence est le seul état incrémental de ce chemin : son journal est vérifié
  // contre le cache à chaque vidange, et reconstruit au moindre désaccord plutôt que de dériver.
  const { commitRows, sourceRowOf } = createWebgpuRowCommit(rows, writePageRow);
  const { syncRows, syncRowsFromCut } = createWebgpuRowSync(
    rows,
    mirror,
    packedPages,
    run.drawn,
    drawSlots,
    () => !!gpu.cache,
    { commitRows, sourceRowOf },
    // Origine du changement de ressources : la page entre dans la résidence ou en sort.
    (rec) => (run.gate.resourcesChanged(), noteResidenceChange(rt.lights, rec)),
  );
  const pageSource = {
    read: async (key: string) => {
      const bytes = sourceBytes.get(key);
      if (!bytes) throw new Error('Missing page');
      return bytes;
    },
  };
  const hasBytes = (rec: PageRec) => !!(rec.array || sourceBytes.has(rec.url));
  /**
   * The sets residency is decided with, and the difference the GPU readback is read as. Both outlive
   * the image: an image that moves no page touches neither.
   */
  const residencySets = createWebgpuResidencySets({ tracking, bootstrapKey, packedPages });
  const cutDelta = createCutDelta(packedPages, run.desired);
  const drawnDelta = createCutDelta(packedPages, run.drawnMembers);
  const pinUpdater = createWebgpuPinUpdater({
    tracking,
    sets: residencySets,
    bootstrapUrls,
    deferredDrops: run.deferredDrops,
    byUrl,
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
  });
  const updatePins = () => pinUpdater(gpu.cache, run.shown, run.frame, (key) => dropPage(rt, key));
  const bootstrapState = createWebgpuBootstrap({
    pages: bootstrap,
    urls: bootstrapUrls,
    slots,
    tracking,
    signal: context.signal,
    readPage: context.readPage,
    acceptPage: (key, data) => acceptPage(rt, key, data),
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
    sets: residencySets,
    room: Math.max(0, slots - bootstrapUrls.size),
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
    getShown: () => run.shown,
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
    uniforms: run.selectionUniforms,
    residentOffsetWords: rows.residentOffsetWords,
    delta: cutDelta,
    drawnDelta,
    onDrawnDelta: (delta) => residencySets.applyDrawn(delta),
    onDrawnMirrored: () => markDrawnMirrored(run),
    onCutDelta: (delta) => {
      residencySets.applyCut(delta);
      run.pagesEntered = delta.enteredCount;
      run.pagesExited = delta.exitedCount;
    },
  });
  // Before the first readback the image asks the cache for the pinned cover and nothing else.
  if (!run.desired.length)
    for (let i = 0; i < gpuWanted.length; i++) run.desired.push(gpuWanted[i]);
  /** Adopte le relevé et dit si l'IMAGE en est changée : si les listes affichées ont été réécrites.
   *  Un relevé neuf republiant les mêmes identifiants dans le même ordre n'en réécrit aucune. */
  const adoptGpuCut = () => {
    const adopted = cutAdopter.adopt(),
      metrics = cutAdopter.metrics;
    run.cutHeld = metrics.cutHeld;
    gpu.cutIncomplete = metrics.incomplete;
    // Une adoption qui réécrit les listes les fait changer d'âge, au rendu comme dans la vidange.
    if (metrics.listsRewritten) run.cutEpoch++;
    if (!adopted) return metrics.listsRewritten;
    run.visible = metrics.visible;
    run.selectedTriangles = metrics.selectedTriangles;
    run.uncoveredTriangles = metrics.uncoveredTriangles;
    run.submittedTriangles = metrics.selectedTriangles;
    run.drawnTriangles = metrics.drawnTriangles;
    run.blendPagedTriangles = metrics.transparentTriangles;
    run.frustumRejected = metrics.frustumRejected;
    run.lodLevel = metrics.lodLevel;
    run.gpuMetricsReady = metrics.ready;
    return metrics.listsRewritten;
  };
  /**
   * Answers what the image asks the cache for. One cut covers both passes now, and the readback
   * applied its difference the moment it was adopted, so nothing is re-read here.
   */
  const admitCut = () => {
    residencySets.releaseCpu();
    return residencySets.requestedCount;
  };
  return {
    syncRows,
    syncRowsFromCut,
    pageSource,
    hasBytes,
    residencySets,
    admitCut,
    // La coupe processeur réécrit elle-même ces listes : leur âge change avec elle.
    invalidateCut: () => (run.cutEpoch++, cutAdopter.invalidate()),
    bootstrapState,
    ensureResident,
    residency,
    queueResident: residency.queueResident,
    queueCutResidency: residency.queueCutResidency,
    adoptGpuCut,
  };
}
