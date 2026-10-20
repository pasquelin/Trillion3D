import type { PageRec } from '../../geometry/selection/types.ts'
import { updateTransparentSpan } from '../../blend/transparent/spans.ts'
import { createResidencyFollower } from '../../geometry/residency/residencyFollow.ts'
import { createPageRowWriter } from '../../geometry/rows/page/pageRowWriter.ts'
import { createWebgpuRowSync } from '../../geometry/rows/sync.ts'
import type { WebgpuResidencySets } from '../../geometry/residency/sets.ts'
import { createWebgpuPinUpdater } from '../../geometry/residency/pinUpdater.ts'
import { createWebgpuBootstrap } from '../loop/bootstrap.ts'
import { createWebgpuResidentEnsurer } from '../../geometry/residency/residentEnsurer.ts'
import { createWebgpuResidencyQueue } from '../../geometry/residency/queue.ts'
import { createPageParents } from '../../geometry/selection/pageParents.ts'
import type { LowerList } from '../../geometry/residency/lowerTier.ts'
import { createGroupClosure, type GroupClosure } from '../../geometry/cut/groupClosure.ts'
import { acceptPage, dropPage } from '../io/pageApi.ts'
import { pageAddress, readGeometryAhead } from '../../geometry/rows/page/pageSlots.ts'
import { markWebgpuLost } from '../io/lost.ts'
import type { WebgpuPagesCore } from './runtime.ts'
import { noteResidenceChange } from '../../lighting/shadows/casters/bounds.ts'
import { rootOfPacked } from '../../geometry/selection/placements.ts'
import { rowWrittenAsProxy } from '../prepare/worldRoot.ts'

/** The row table's sync: the residency follower, the page-row writer, the row cache. */
export function createRowSyncFor(rt: WebgpuPagesCore) {
  const { run, gpu } = rt,
    { rows, packedPages } = rt.layout
  const follower = createResidencyFollower({
    table: rows,
    getCache: () => gpu.cache,
    onOffsetChange: (page, words) => (
      rows.touchPage(page),
      updateTransparentSpan(rt, page, words),
      rowSync.blendCasters.follow(page),
      notePool(rt, page, words >= 0)
    ),
    // A ray's record is one per primitive, shared by its placements: followed once.
    onPrimitiveChange: (page) => rt.rays?.moved(page),
  })
  /** Writes one page-table row: when a cluster claims a row, when its GPU slot moves, or when a
   *  shared input changes epoch — never once per frame: every field below belongs to the page, its
   *  material, its geometry block or its slot, none of them to the image. */
  // Off the visibility state, read at each row: the atlases exist from the textures' preparation
  // on, and it hears there that an as-is surface took a row (`asIsShown`).
  const writePageRow = createPageRowWriter(
    rt.vis,
    rows.markRowDirty,
    (packed) => rootOfPacked(rt.layout.placement, packed),
    rt.layout.deformationOutputOf,
    (rank) => rowWrittenAsProxy(rt.layout.selectionRoots, rank),
  )
  // The residency log names the instances whose slot moved; the slot is read on the cache itself
  // (`../../geometry/rows/page/pageState.ts`). The row table is a cache of what the GPU cut draws and asks for
  // (`../../geometry/rows/slots.ts`).
  const rowSync = createWebgpuRowSync(
    rows,
    follower,
    packedPages,
    () => !!gpu.cache,
    writePageRow,
    // A request's readiness needs its groups' rows, each placement's own: counted closures that
    // follow the readbacks' differences alone (`../../geometry/rows/demand/rowDemand.ts`).
    () => createGroupClosure(rt.layout.selectionRoots, rt.layout.placement, packedPages, true),
    // Origin of the resource change: the page enters residency or leaves it. The shadows compare
    // the flag at their next plan (`../../lighting/shadows/casters/residence.ts`).
    (_rec, page) => (run.gate.resourcesChanged(), rt.lights.residence.noteRow(page)),
    // A blended caster's opacity moved: the shadow pages under it redraw the slice it is cached
    // in — its placement's mobility decides, as for any caster (the VSM transmission atlas keeps a
    // still blended caster in the static slice).
    (rec, page) => {
      const { selectionRoots, placement } = rt.layout
      noteResidenceChange(rt.lights, selectionRoots, placement, page, rec)
    },
    rt.clock,
    // The host's frame: the clock every cut stamps with, the rows' use words too.
    () => run.frame,
    // A request waiting for the rows' queue asks the cut to cut again and rank one.
    () => run.gpuSelection?.askEvictions(),
  )
  return rowSync
}

/** Packed page `page`'s place in the GPU's pool list (`../../geometry/dag/poolList.ts`): listed while
 *  the pool holds it and does not pin it — the GPU never ranks a page the cache would refuse. */
function notePool(rt: WebgpuPagesCore, page: number, held: boolean) {
  const { run, gpu } = rt,
    rec = rt.layout.recordOf(page)
  run.gpuSelection?.notePool(page, held && !!rec && !gpu.cache?.isPinned(pageAddress(rec)))
}

/** The bootstrap cover: the pages read before the first cut. */
export function createBootstrapFor(rt: WebgpuPagesCore, hasBytes: (rec: PageRec) => boolean) {
  const { run, gpu, diag, context } = rt
  return createWebgpuBootstrap({
    pages: rt.setup.bootstrap,
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

/** The upload side of residency: the pins, the ensurer over the queue and the lower tier, the
 *  queue itself. */
export function createResidencyFor(
  rt: WebgpuPagesCore,
  parts: {
    residencySets: WebgpuResidencySets
    closure: GroupClosure
    hasBytes: (rec: PageRec) => boolean
    lowerTier: LowerList
    room: () => number
  },
) {
  const { run, gpu, diag, context } = rt,
    { tracking, bootstrapKey, geometryUrls } = rt.setup,
    { rows } = rt.layout,
    { residencySets, closure, hasBytes, lowerTier } = parts
  const parentsOf = createPageParents(
    rt.layout.selectionRoots,
    rt.layout.placement,
    (rec) => rows.pageIndexOf(rec) ?? -1,
  )
  const pinUpdater = createWebgpuPinUpdater({
    tracking,
    sets: residencySets,
    bootstrapKey: rt.setup.bootstrapKey,
    deferredDrops: run.deferredDrops,
    relist: (address) =>
      rows.instances.each(address, (page) => notePool(rt, page, !!gpu.cache?.get(address))),
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
    lowerTier: () => lowerTier,
    bytesRevision: rows.touchRevision,
    // The cover's missing pages in the order their cells' holds are read: the top layer and the
    // nearest first (`../../geometry/hlod/hlodCells.ts`).
    coverMissing: (holds, limit) =>
      residencySets.coverMissing(holds, limit, (page) =>
        page.holder === undefined
          ? 0
          : Math.min(context.worldRoots?.priorityOf(page.holder) ?? 0, Number.MAX_VALUE),
      ),
    coverLacking: residencySets.coverLacking,
    prefetch: context.readGeometryPage && readGeometryAhead(geometryUrls, context.readGeometryPage),
    clock: rt.clock,
  })
  const residency = createWebgpuResidencyQueue({
    tracking,
    sets: residencySets,
    room: parts.room,
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
    updatePins: () => pinUpdater(gpu.cache, run.shown, run.frame, (key) => dropPage(rt, key, true)),
    closure,
    ensureResident,
    markLost: (error) => markWebgpuLost(rt, { reason: 'residency', message: String(error) }),
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
    diagnosticFailure: diag.diagnosticFailure,
  })
  return { ensureResident, residency }
}
