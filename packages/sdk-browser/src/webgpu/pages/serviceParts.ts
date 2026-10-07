import type { PageRec } from '../../page/selection/selection.ts'
import { updateTransparentSpan } from '../transparent/spans.ts'
import { createWebgpuResidencyMirror } from '../residency/mirror.ts'
import { createPageRowWriter } from '../row/pageRowWriter.ts'
import { createWebgpuRowSync } from '../row/sync.ts'
import type { WebgpuResidencySets } from '../residency/sets.ts'
import { createWebgpuPinUpdater } from '../residency/pinUpdater.ts'
import { createWebgpuBootstrap } from '../frame/bootstrap.ts'
import { createWebgpuResidentEnsurer } from '../residency/residentEnsurer.ts'
import { createWebgpuResidencyQueue } from '../residency/queue.ts'
import { createPageParents } from '../../page/selection/pageParents.ts'
import type { LowerList } from '../residency/lowerTier.ts'
import type { GroupClosure } from '../../page/cut/groupClosure.ts'
import { acceptPage, dropPage } from './io/pageApi.ts'
import { readGeometryAhead } from '../row/pageSlots.ts'
import { markWebgpuLost } from './io/lost.ts'
import type { WebgpuPagesCore } from './runtime.ts'
import { noteResidenceChange } from '../shadow/bounds.ts'

/** The row table's sync: the residency mirror, the page-row writer, the row cache. */
export function createRowSyncFor(rt: WebgpuPagesCore, closure: GroupClosure) {
  const { run, gpu, diag, context } = rt,
    { rows, packedPages } = rt.layout
  const mirror = createWebgpuResidencyMirror({
    table: rows,
    tracking: rt.setup.tracking,
    engineDiagnostic: diag.engineDiagnostic,
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
    onOffsetChange: (page, words) => (
      rows.touchPage(page),
      updateTransparentSpan(rt, page, words),
      rowSync.blendCasters.follow(page),
      run.gpuSelection?.notePool(page, words >= 0)
    ),
  })
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
  )
  // The residency mirror is the only incremental state of this path: its journal is checked against
  // the cache on every flush, and rebuilt at the slightest disagreement rather than drifting. The
  // row table is a cache of what the GPU cut draws and asks for (`../row/slots.ts`).
  const rowSync = createWebgpuRowSync(
    rows,
    mirror,
    packedPages,
    () => !!gpu.cache,
    writePageRow,
    // A request's readiness needs its groups' rows, each placement's own (`../row/rowDemand.ts`).
    (ids, visit) => closure.closeOver(ids, visit, undefined, true),
    // Origin of the resource change: the page enters residency or leaves it. The shadows compare
    // the flag at their next plan (`../shadow/residence.ts`).
    (_rec, page) => (
      run.gate.resourcesChanged(),
      rt.lights.residence.noteRow(page, packedPages.length)
    ),
    // A blended caster's opacity moved: the shadow pages under it redraw the slice it is cached
    // in — its placement's mobility decides, as for any caster (the VSM transmission atlas keeps a
    // still blended caster in the static slice).
    (rec, page) => {
      const { selectionRoots, placement } = rt.layout
      noteResidenceChange(rt.lights, selectionRoots, placement.rootOfPacked, page, rec)
    },
    context.frameBudget,
  )
  return rowSync
}

/** The bootstrap cover: the pages read before the first cut. */
export function createBootstrapFor(rt: WebgpuPagesCore, hasBytes: (rec: PageRec) => boolean) {
  const { run, gpu, diag, context } = rt
  return createWebgpuBootstrap({
    pages: rt.setup.bootstrap,
    urls: rt.setup.bootstrapUrls,
    // The pool the device granted, read when said: prepare grants it after the services exist.
    getSlots: () => rt.setup.slots,
    tracking: rt.setup.tracking,
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
  })
}

/** The upload side of residency: the pins, the ensurer over the queue and the lower tiers, the
 *  queue itself. */
export function createResidencyFor(
  rt: WebgpuPagesCore,
  parts: {
    residencySets: WebgpuResidencySets
    closure: GroupClosure
    hasBytes: (rec: PageRec) => boolean
    lowerTiers: readonly LowerList[]
    room: () => number
  },
) {
  const { run, gpu, diag, context } = rt,
    { tracking, bootstrapKey, geometryUrls } = rt.setup,
    { rows } = rt.layout,
    { residencySets, closure, hasBytes, lowerTiers } = parts
  const parentsOf = createPageParents(
    rt.layout.selectionRoots,
    rt.layout.placement,
    (rec) => rows.pageIndexOf(rec) ?? -1,
  )
  const pinUpdater = createWebgpuPinUpdater({
    tracking,
    sets: residencySets,
    bootstrapUrls: rt.setup.bootstrapUrls,
    deferredDrops: run.deferredDrops,
    byUrl: rt.setup.byUrl,
    parentsOf,
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
  })
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
    bytesRevision: rows.touchRevision,
    prefetch: context.readGeometryPage && readGeometryAhead(geometryUrls, context.readGeometryPage),
  })
  const residency = createWebgpuResidencyQueue({
    tracking,
    sets: residencySets,
    recordOf: rt.layout.recordOf,
    room: parts.room,
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
    updatePins: () => pinUpdater(gpu.cache, run.shown, run.frame, (key) => dropPage(rt, key)),
    closure,
    ensureResident,
    markLost: (error) => markWebgpuLost(rt, { reason: 'residency', message: String(error) }),
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
    diagnosticFailure: diag.diagnosticFailure,
  })
  return { ensureResident, residency }
}
