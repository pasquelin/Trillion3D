import type { PageRec } from '../../geometry/selection/types.ts'
import { updateTransparentSpan } from '../../blend/transparent/spans.ts'
import { createResidencyFollower } from '../../geometry/residency/residencyFollow.ts'
import { createPageRowWriter } from '../../geometry/rows/page/pageRowWriter.ts'
import { createWebgpuRowSync } from '../../geometry/rows/sync.ts'
import type { WebgpuResidencySets } from '../../geometry/residency/sets.ts'
import { createWebgpuPinUpdater } from '../../geometry/residency/pinUpdater.ts'
import { createWebgpuBootstrap } from '../loop/bootstrap.ts'
import { createWebgpuResidencyQueue } from '../../geometry/residency/queue.ts'
import { createPageParents } from '../../geometry/selection/pageParents.ts'
import { createGroupClosure, type GroupClosure } from '../../geometry/cut/groupClosure.ts'
import { acceptPage, dropPage } from '../io/pageApi.ts'
import { geometryFailedAhead, readGeometryAhead } from '../../geometry/rows/page/pageSlots.ts'
import { markWebgpuLost } from '../io/lost.ts'
import type { WebgpuPagesCore } from './runtime.ts'
import { noteResidenceChange } from '../../lighting/shadows/casters/bounds.ts'
import { rootOfPacked } from '../../geometry/selection/placements.ts'
import { rowWrittenAs } from '../prepare/worldRoot.ts'

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
      rowSync.blendCasters.follow(page)
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
    (rank) => rowWrittenAs(rt.layout.selectionRoots, rank),
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
    () => run.gpuSelection?.recut(),
  )
  return rowSync
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

/** The streaming of the geometry pool: the root cover's pins, and the update each frame runs over
 *  the views' readbacks (`../../geometry/residency/queue.ts`). */
export function createResidencyFor(
  rt: WebgpuPagesCore,
  parts: {
    residencySets: WebgpuResidencySets
    closure: GroupClosure
    hasBytes: (rec: PageRec) => boolean
    streamingSlots: () => number
  },
) {
  const { run, gpu, diag, context } = rt,
    { tracking, geometryUrls } = rt.setup,
    { rows } = rt.layout,
    { residencySets } = parts
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
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
  })
  const read = context.readGeometryPage
    ? readGeometryAhead(geometryUrls, context.readGeometryPage)
    : () => undefined
  const invalid = context.geometryPageFailed
    ? geometryFailedAhead(geometryUrls, context.geometryPageFailed)
    : () => false
  return createWebgpuResidencyQueue({
    tracking,
    sets: residencySets,
    closure: parts.closure,
    packedPages: rt.layout.packedPages,
    settings: context,
    streamingSlots: parts.streamingSlots,
    getCache: () => gpu.cache,
    getFrame: () => run.frame,
    isLost: () => run.lost,
    updatePins: () => pinUpdater(gpu.cache, run.shown, run.frame, (key) => dropPage(rt, key, true)),
    parentsOf,
    hasBytes: parts.hasBytes,
    read,
    invalid,
    // The cover's missing pages in the order their holders' reads are asked: the bundle whose cell
    // took its turn to load first, first (`../../geometry/hlod/hlodHolds.ts`); a page with no
    // holder before them, one whose bundle no cell holds after, ties in the cover's own order.
    // Only the order they start in: each page reads in the pages' own lane (`PRIORITY_VISIBLE`).
    coverRank: (page) =>
      page.holder === undefined
        ? 0
        : Math.min(context.worldRoots?.priorityOf(page.holder) ?? 0, Number.MAX_VALUE),
    signal: context.signal,
    markLost: (error) => markWebgpuLost(rt, { reason: 'residency', message: String(error) }),
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
    diagnosticFailure: diag.diagnosticFailure,
  })
}
