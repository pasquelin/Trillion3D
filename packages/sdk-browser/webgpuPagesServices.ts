import type { PageRec } from './pageSelection.ts';
import { updateTransparentSpan } from './webgpuTransparentSpans.ts';
import { createWebgpuResidencyMirror } from './webgpuResidencyMirror.ts';
import { createPageRowWriter } from './webgpuPageRow.ts';
import { createWebgpuRowCommit } from './webgpuRowCommit.ts';
import { noteResidenceChange } from './webgpuShadowBounds.ts';
import { createWebgpuRowSync } from './webgpuRowSync.ts';
import { createWebgpuResidencySets } from './webgpuResidencySets.ts';
import { createWebgpuPinUpdater } from './webgpuPinUpdater.ts';
import { createWebgpuBootstrap } from './webgpuBootstrap.ts';
import { createWebgpuResidentEnsurer } from './webgpuResidentEnsurer.ts';
import { createWebgpuResidencyQueue } from './webgpuResidencyQueue.ts';
import { createWebgpuCutPublication } from './webgpuCutPublication.ts';
import { acceptPage, dropPage } from './webgpuPagesPageApi.ts';
import type { WebgpuPagesCore } from './webgpuPagesRuntime.ts';

export type WebgpuPagesServices = ReturnType<typeof createWebgpuPagesServices>;

/** The residency machinery: the row table sync, the bootstrap cover, the pin updater, the upload
 *  queue and the GPU cut adopter. Each reads the runtime lazily, so none holds a stale frame. */
export function createWebgpuPagesServices(rt: WebgpuPagesCore) {
  const { run, gpu, diag, context } = rt,
    { rows, packedPages, drawSlots } = rt.layout,
    { tracking, bootstrap, bootstrapUrls, bootstrapKey, slots } = rt.setup,
    { sourceBytes, byUrl } = rt.setup;
  const mirror = createWebgpuResidencyMirror({
    pageIndicesByUrl: rows.pageIndicesByUrl,
    residentOffsetWords: rows.residentOffsetWords,
    tracking,
    engineDiagnostic: diag.engineDiagnostic,
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
    onOffsetChange: (page, words) => (rows.touchPage(page), updateTransparentSpan(rt, page, words)),
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
    markRowDirty: rows.markRowDirty,
  });
  // Le miroir de résidence est le seul état incrémental de ce chemin : son journal est vérifié
  // contre le cache à chaque vidange, et reconstruit au moindre désaccord plutôt que de dériver.
  const commit = createWebgpuRowCommit(rows, writePageRow);
  const { syncRows, syncRowsFromCut } = createWebgpuRowSync(
    rows,
    mirror,
    packedPages,
    run.drawn,
    drawSlots,
    () => !!gpu.cache,
    commit,
    // Origine du changement de ressources : la page entre dans la résidence ou en sort.
    (rec) => (run.gate.resourcesChanged(), noteResidenceChange(rt.lights, rec)),
  );
  const read = async (key: string) =>
    sourceBytes.get(key) ?? Promise.reject(new Error('Missing page'));
  const pageSource = { read };
  const hasBytes = (rec: PageRec) => !!(rec.array || sourceBytes.has(rec.url));
  /** The sets residency is decided with, and the difference the GPU readback is read as. Both
   *  outlive the image: an image that moves no page touches neither. */
  const residencySets = createWebgpuResidencySets({ tracking, bootstrapKey, packedPages });
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
    updatePins,
    ensureResident,
    markLost: () => {
      run.lost = true;
    },
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
    diagnosticFailure: diag.diagnosticFailure,
  });
  const publication = createWebgpuCutPublication(rt, residencySets);
  return {
    syncRows,
    syncRowsFromCut,
    pageSource,
    hasBytes,
    residencySets,
    bootstrapState,
    ensureResident,
    residency,
    queueCutResidency: residency.queueCutResidency,
    ...publication,
  };
}
