import type { PageRec } from '../../page/selection/selection.ts';
import { updateTransparentSpan } from '../transparent/spans.ts';
import { createWebgpuResidencyMirror } from '../residency/mirror.ts';
import { createPageRowWriter } from '../row/pageRow.ts';
import { createWebgpuRowCommit } from '../row/commit.ts';
import { createWebgpuRowSync } from '../row/sync.ts';
import { createWebgpuResidencySets } from '../residency/sets.ts';
import { createWebgpuPinUpdater } from '../residency/pinUpdater.ts';
import { createWebgpuBootstrap } from '../frame/bootstrap.ts';
import { createWebgpuResidentEnsurer } from '../residency/residentEnsurer.ts';
import { createWebgpuResidencyQueue } from '../residency/queue.ts';
import { createPageParents } from '../../residency/pageParents.ts';
import { createLowerTier } from '../residency/lowerTier.ts';
import { createGroupClosure } from '../../page/cut/groupClosure.ts';
import { createImageRelevance } from '../residency/imageRelevance.ts';
import { createWebgpuCutPublication } from '../cut/publication.ts';
import { acceptPage, dropPage } from './io/pageApi.ts';
import { createPageSource } from './readPage.ts';
import { awaitsPageBytes, pageAddress, readGeometryAhead } from '../row/pageSlots.ts';
import { markWebgpuLost } from './io/lost.ts';
import type { WebgpuPagesCore } from './runtime.ts';
import { noteResidenceChange } from '../shadow/bounds.ts';

export type WebgpuPagesServices = ReturnType<typeof createWebgpuPagesServices>;

/** The residency machinery: the row table sync, the bootstrap cover, the pin updater, the upload
 *  queue and the GPU cut adopter. Each reads the runtime lazily, so none holds a stale frame. */
export function createWebgpuPagesServices(rt: WebgpuPagesCore) {
  const { run, gpu, diag, context } = rt,
    { rows, packedPages } = rt.layout,
    { tracking, bootstrap, bootstrapUrls, bootstrapKey } = rt.setup,
    { sourceBytes, byUrl, geometryUrls } = rt.setup;
  const mirror = createWebgpuResidencyMirror({
    table: rows,
    tracking,
    engineDiagnostic: diag.engineDiagnostic,
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
    // The CPU cut reads residency from the pool: its shadows compare the slot at their next plan.
    onOffsetChange: (page, words) => (
      rows.touchPage(page),
      updateTransparentSpan(rt, page, words),
      blendCasters.follow(page),
      rt.lights.residence.notePool(page, packedPages.length),
      run.gpuSelection?.notePool(page, words >= 0)
    ),
  });
  /** Writes one page-table row: when a cluster claims a row, when its GPU slot moves, or when a
   *  shared input changes epoch — never once per frame: every field below belongs to the page, its
   *  material, its geometry block or its slot, none of them to the image. */
  // Off the visibility state, read at each row: the atlases exist from the textures' preparation
  // on, and it hears there that an as-is surface took a row (`asIsShown`).
  const writePageRow = createPageRowWriter(
    rt.vis,
    rows.markRowDirty,
    rt.layout.selectionRoots,
    (packed) => rt.layout.placement.rootOfPacked[packed],
  );
  // The residency mirror is the only incremental state of this path: its journal is checked against
  // the cache on every flush, and rebuilt at the slightest disagreement rather than drifting.
  const commit = createWebgpuRowCommit(rows, writePageRow);
  const { syncRows, syncRowsFromCut, rowsOwed, blendCasters } = createWebgpuRowSync(
    rows,
    mirror,
    packedPages,
    run,
    () => !!gpu.cache,
    commit,
    // Origin of the resource change: the page enters residency or leaves it. The shadows compare
    // the flag at their next plan (`../shadow/residence.ts`).
    (rec, page) => (
      run.gate.resourcesChanged(),
      rt.lights.residence.noteRow(page, packedPages.length)
    ),
    // A blended caster's opacity moved: the shadow pages under it redraw their moving casters, as
    // the static layer never holds a blended caster (#993).
    (rec, page) =>
      noteResidenceChange(
        rt.lights,
        rt.layout.selectionRoots,
        rt.layout.placement.rootOfPacked,
        page,
        rec,
        true,
      ),
    context.frameBudget,
  );
  const pageSource = createPageSource(rt);
  // A cluster drawn from its quantized page needs no index page: its slot is filled from the page
  // reader above. Only a cluster that still draws from an index buffer waits for one.
  const hasBytes = (rec: PageRec) => !awaitsPageBytes(rec) || sourceBytes.has(pageAddress(rec));
  /** True while the pool holds the slot this cluster draws from, at its own address. */
  const poolHolds = (rec: PageRec) => !!gpu.cache?.get(pageAddress(rec));
  /** The groups a cut's pages close over: what the cache must hold for the cut rule to draw them. */
  // The layout's one table object: a growth in place rewrites it (`webgpuGrowth.ts`), never replaces.
  const placement = rt.layout.placement;
  const closure = createGroupClosure(rt.layout.selectionRoots, placement, packedPages);
  /** The residency sets and the page dependencies: an image that moves no page touches neither. */
  const residencySets = createWebgpuResidencySets({ tracking, bootstrapKey, packedPages }),
    parentsOf = createPageParents(
      rt.layout.selectionRoots,
      placement,
      (rec) => rows.pageIndexOf(rec) ?? -1,
    );
  const pinUpdater = createWebgpuPinUpdater({
    tracking,
    sets: residencySets,
    bootstrapUrls,
    deferredDrops: run.deferredDrops,
    byUrl,
    parentsOf,
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
  });
  const bootstrapState = createWebgpuBootstrap({
    pages: bootstrap,
    urls: bootstrapUrls,
    // The pool the device granted, read when said: prepare grants it after the services exist.
    getSlots: () => rt.setup.slots,
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
  const room = () => Math.max(0, rt.setup.slots - bootstrapUrls.size);
  // The two lower tiers: the casters the light cuts want, then the pages ahead of the camera.
  const tier = { keyOf: tracking.keyOf, room, closeOver: closure.closeOver };
  const shadowTier = createLowerTier(tier),
    aheadTier = createLowerTier(tier),
    lowerTiers = [shadowTier, aheadTier];
  /** Whether an arrival can change the image; the held frame survives one that cannot. */
  const affectsImage = createImageRelevance({
    tracking,
    bootstrapKey,
    requests: residencySets.requests,
    casts: shadowTier.has,
  });
  const ensureResident = createWebgpuResidentEnsurer({
    getCache: () => gpu.cache,
    tracking,
    bootstrapKey,
    signal: context.signal,
    hasBytes,
    parentsOf,
    isLost: () => run.lost,
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
    lowerTiers: () => lowerTiers,
    prefetch: context.readGeometryPage && readGeometryAhead(geometryUrls, context.readGeometryPage),
    // The plan holds when the camera's view is the last one's: at rest the caster tier settles on
    // its list's first pages, while a moving camera keeps every page the list still names (#1016).
    still: () => rt.lights.plan.resting,
  });
  const residency = createWebgpuResidencyQueue({
    tracking,
    sets: residencySets,
    room,
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
    updatePins: () => pinUpdater(gpu.cache, run.shown, run.frame, (key) => dropPage(rt, key)),
    closure,
    ensureResident,
    markLost: (error) => markWebgpuLost(rt, { reason: 'residency', message: String(error) }),
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
    diagnosticFailure: diag.diagnosticFailure,
  });
  const tiers = { all: lowerTiers, ahead: aheadTier };
  const publication = createWebgpuCutPublication(rt, residencySets, closure, tiers, poolHolds);
  return {
    syncRows,
    syncRowsFromCut,
    rowsOwed,
    blendCasters,
    pageSource,
    hasBytes,
    poolHolds,
    /** Hands the cache's residency changes to the rank journal: a CPU cut reads what it holds. */
    syncResidency: mirror.sync,
    residencySets,
    bootstrapState,
    ensureResident,
    residency,
    shadowTier,
    affectsImage,
    ...publication,
    hostTableBytes: () => publication.hostTableBytes() + residency.hostBytes, // + GPU admission
  };
}
