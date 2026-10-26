import type { PageRec } from '../../geometry/selection/types.ts'
import { updateTransparentSpan } from '../../blend/transparent/spans.ts'
import { createResidencyFollower } from '../../geometry/residency/residencyFollow.ts'
import { createClusterResidency } from '../../geometry/clusters/clusterResidency.ts'
import { createInfoWriter } from '../../geometry/clusters/infoWrite.ts'
import { createClusterMeasure } from '../../geometry/dag/info/measure.ts'
import { placementSource } from '../render/placementTables.ts'
import type { WebgpuResidencySets } from '../../geometry/residency/sets.ts'
import { createWebgpuPinUpdater } from '../../geometry/residency/pinUpdater.ts'
import { createWebgpuBootstrap } from '../loop/bootstrap.ts'
import { createWebgpuResidencyQueue } from '../../geometry/residency/queue.ts'
import { createPageParents } from '../../geometry/selection/pageParents.ts'
import type { GroupClosure } from '../../geometry/cut/groupClosure.ts'
import { acceptPage, dropPage } from '../io/pageApi.ts'
import { geometryFailedAhead, readGeometryAhead } from '../../geometry/rows/page/pageSlots.ts'
import { markWebgpuLost } from '../io/lost.ts'
import type { WebgpuPagesCore } from './runtime.ts'

/** The clusters' residency: the residency follower, the writer of cluster records and the pass
 *  that brings them level with the pool (`../../geometry/clusters/clusterResidency.ts`). */
export function createClusterSyncFor(rt: WebgpuPagesCore) {
  const { run, gpu } = rt,
    { clusters, packedPages } = rt.layout
  const follower = createResidencyFollower({
    table: clusters,
    getCache: () => gpu.cache,
    onOffsetChange: (page, words) => (
      clusters.touchPage(page),
      updateTransparentSpan(rt, page, words)
    ),
    // A ray's record is one per primitive, shared by its placements: followed once.
    onPrimitiveChange: (page) => rt.rays?.moved(page),
  })
  // The placements' records are made from the session, bound now that it exists.
  clusters.placementInfo.bind(placementSource(rt))
  /** Where the records go: the cut's buffers, none before the cut exists. */
  const target = {
    device: undefined as unknown as GPUDevice,
    buffer: undefined as unknown as GPUBuffer,
    infoShift: undefined as unknown as Uint32Array,
    placement: rt.layout.placement,
    /** The clusters never measured are listed for the GPU's measure of their longest edge. */
    measure(records: Uint32Array, count: number) {
      const measure = (rt.vis.clusterMeasure ??= createClusterMeasure(target.device))
      measure.ask()
      measure.queue(records, count)
    },
  }
  // Written where the cut reads them, when its pass flags the page: no cluster waits for a row.
  // Off the visibility state, read at each record: the atlases exist from the textures'
  // preparation on, and it hears there that an as-is surface was written (`asIsShown`).
  return createClusterResidency({
    clusters,
    packedPages,
    follower,
    cacheReady: () => !!gpu.cache,
    target() {
      const cut = run.gpuSelection
      if (!cut || !gpu.device) return undefined
      target.device = gpu.device
      target.buffer = cut.info
      target.infoShift = cut.infoShift
      return target
    },
    write: createInfoWriter(rt.vis),
    classes: rt.vis.presentClasses,
    displacedClasses: rt.vis.displacedClasses,
    // Origin of the resource change: the page enters residency or leaves it. The shadows compare
    // the flag at their next plan (`../../lighting/shadows/casters/residence.ts`).
    onResidenceChange: (_rec, page) => (
      run.gate.resourcesChanged(),
      rt.lights.residence.noteRow(page)
    ),
  })
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

/** How the geometry pages are read ahead of the pool, and which of them failed. */
function pageReaders(
  context: WebgpuPagesCore['context'],
  geometryUrls: WebgpuPagesCore['setup']['geometryUrls'],
) {
  const read = context.readGeometryPage
    ? readGeometryAhead(geometryUrls, context.readGeometryPage)
    : () => undefined
  const invalid = context.geometryPageFailed
    ? geometryFailedAhead(geometryUrls, context.geometryPageFailed)
    : () => false
  return { read, invalid }
}

/** The cover's missing pages in the order their holders' reads are asked: the bundle whose cell
 *  took its turn to load first, first (`../../geometry/hlod/hlodHolds.ts`); a page with no holder
 *  before them, one whose bundle no cell holds after, ties in the cover's own order. Only the order
 *  they start in: each page reads in the pages' own lane (`PRIORITY_VISIBLE`). */
const coverRankOf = (context: WebgpuPagesCore['context']) => (page: PageRec) =>
  page.holder === undefined
    ? 0
    : Math.min(context.worldRoots?.priorityOf(page.holder) ?? 0, Number.MAX_VALUE)

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
    { clusters } = rt.layout,
    { residencySets } = parts
  const parentsOf = createPageParents(
    rt.layout.selectionRoots,
    rt.layout.placement,
    (rec) => clusters.pageIndexOf(rec) ?? -1,
  )
  const pinUpdater = createWebgpuPinUpdater({
    tracking,
    sets: residencySets,
    bootstrapKey: rt.setup.bootstrapKey,
    deferredDrops: run.deferredDrops,
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
  })
  const { read, invalid } = pageReaders(context, geometryUrls)
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
    coverRank: coverRankOf(context),
    signal: context.signal,
    markLost: (error) => markWebgpuLost(rt, { reason: 'residency', message: String(error) }),
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
    diagnosticFailure: diag.diagnosticFailure,
  })
}
