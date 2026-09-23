import type { PageRec } from '../../page/selection/selection.ts';
import { updateTransparentSpan } from '../transparent/spans.ts';
import { createWebgpuResidencyMirror } from '../residency/mirror.ts';
import { createPageRowWriter } from '../row/pageRow.ts';
import { followSurfaceSampling } from './prepare/textureSampling.ts';
import { createWebgpuRowCommit } from '../row/commit.ts';
import { noteResidenceChange } from '../shadow/bounds.ts';
import { createWebgpuRowSync } from '../row/sync.ts';
import { createWebgpuResidencySets } from '../residency/sets.ts';
import { createWebgpuPinUpdater } from '../residency/pinUpdater.ts';
import { createWebgpuBootstrap } from '../frame/bootstrap.ts';
import { createWebgpuResidentEnsurer } from '../residency/residentEnsurer.ts';
import { createWebgpuResidencyQueue } from '../residency/queue.ts';
import { createWebgpuCutPublication } from '../cut/publication.ts';
import { acceptPage, dropPage } from './io/pageApi.ts';
import { readGeometryPageHeader } from '../../page/decode/geometryPageHeader.ts';
import { awaitsPageBytes, pageAddress } from '../row/pageSlots.ts';
import { markWebgpuLost } from './io/lost.ts';
import type { WebgpuPagesCore } from './runtime.ts';

export type WebgpuPagesServices = ReturnType<typeof createWebgpuPagesServices>;

/** The residency machinery: the row table sync, the bootstrap cover, the pin updater, the upload
 *  queue and the GPU cut adopter. Each reads the runtime lazily, so none holds a stale frame. */
export function createWebgpuPagesServices(rt: WebgpuPagesCore) {
  const { run, gpu, diag, context } = rt,
    { rows, packedPages, drawSlots } = rt.layout,
    { tracking, bootstrap, bootstrapUrls, bootstrapKey, slots } = rt.setup,
    { sourceBytes, byUrl, geometryUrls } = rt.setup;
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
    surfaceChanged: (surface) => followSurfaceSampling(rt, surface),
  });
  // The residency mirror is the only incremental state of this path: its journal is checked against
  // the cache on every flush, and rebuilt at the slightest disagreement rather than drifting.
  const commit = createWebgpuRowCommit(rows, writePageRow);
  const { syncRows, syncRowsFromCut } = createWebgpuRowSync(
    rows,
    mirror,
    packedPages,
    run.drawn,
    drawSlots,
    () => !!gpu.cache,
    commit,
    // Origin of the resource change: the page enters residency or leaves it.
    (rec) => (run.gate.resourcesChanged(), noteResidenceChange(rt.lights, rec)),
  );
  /**
   * The bytes one pool slot holds for a cluster: its quantized geometry page, read from the
   * host's page reader at the address the manifest gives it, or — for a transparent cluster and
   * for a cache that carries no geometry page — the index page the arrival already left in
   * memory. The slot is written from one of the two, never from both.
   */
  const read = async (key: string) => {
    const geometryUrl = geometryUrls.get(key);
    if (geometryUrl === undefined)
      return sourceBytes.get(key) ?? Promise.reject(new Error('Missing page'));
    if (!context.readGeometryPage) throw new Error('Missing geometry page reader');
    const bytes = await context.readGeometryPage(geometryUrl);
    // The pool uploads these words as they are and the shaders decode them in place, so nothing
    // downstream would ever notice a forged or truncated page. The format's own gate is read
    // here, once per admission: magic, version, grids, and counts that measure exactly this many
    // bytes. A page that fails it is refused through the loader's error path, never uploaded.
    readGeometryPageHeader(bytes);
    return bytes;
  };
  const pageSource = { read };
  // A cluster drawn from its quantized page needs no index page: its slot is filled from the page
  // reader above. Only a cluster that still draws from an index buffer waits for one.
  const hasBytes = (rec: PageRec) => !awaitsPageBytes(rec) || sourceBytes.has(pageAddress(rec));
  /** True while the pool holds the slot this cluster draws from, at its own address. */
  const poolHolds = (rec: PageRec) => !!gpu.cache?.get(pageAddress(rec));
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
    room: () => Math.max(0, rt.setup.slots - bootstrapUrls.size),
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
    updatePins,
    ensureResident,
    markLost: (error) => markWebgpuLost(rt, { reason: 'residency', message: String(error) }),
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
    poolHolds,
    residencySets,
    bootstrapState,
    ensureResident,
    residency,
    queueCutResidency: residency.queueCutResidency,
    ...publication,
  };
}
