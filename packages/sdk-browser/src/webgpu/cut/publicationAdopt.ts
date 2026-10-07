import type { PageRec } from '../../page/selection/selection.ts'
import type { CutDelta, createCutDelta } from './delta.ts'
import type { createCutPending } from './pending.ts'
import type { createWebgpuCutAdopter } from './adoption.ts'
import type { GroupClosure } from '../../page/cut/groupClosure.ts'
import { copyPacked, copyPages, markDrawnMirrored } from '../pages/helpers.ts'
import type { GpuCut } from '../../gpu/core/selection.ts'
import type { WebgpuResidencySets } from '../residency/sets.ts'
import type { WebgpuPagesCore } from '../pages/runtime.ts'
import type { ViewCut } from '../pages/state/view.ts'

/** The lists of a readback without a drawn list, and of a view let go. */
export const NO_IDS: readonly number[] = []

/** What the publication's adoptions share (`publication.ts`): the engine, the sets and the
 *  closure the cuts go to, the main view's differences, the pending pages, the adopter. */
export type Publication = {
  rt: WebgpuPagesCore
  residencySets: WebgpuResidencySets
  closure: GroupClosure
  cutDelta: CutDelta
  drawnDelta: ReturnType<typeof createCutDelta>
  drawnPages: PageRec[]
  cutPending: ReturnType<typeof createCutPending>
  rankOf: (rec: PageRec) => number
}

/** `cut` published: closed over its groups, into the sets, the pending pages following. */
export function publishCut(p: Publication, cut: CutDelta) {
  p.closure.apply(cut)
  p.residencySets.applyCut(p.closure.delta)
  p.cutPending.apply()
}

/** A view publishes `wanted` and `shown`, both as packed ranks. */
export function adoptView(
  p: Publication,
  own: ViewCut,
  wanted: ArrayLike<number>,
  shown: ArrayLike<number>,
) {
  own.asked.apply(wanted, wanted.length)
  publishCut(p, own.asked)
  own.drawn.apply(shown, shown.length)
  p.residencySets.applyDrawn(own.drawn)
}

/** A cut's counts, adopted with it: the image's metrics read them. */
function applyTotals(
  run: WebgpuPagesCore['run'],
  totals: Pick<
    GpuCut['result'],
    'selectedTriangles' | 'drawnTriangles' | 'transparentTriangles' | 'frustumRejected' | 'lodLevel'
  >,
  visible: number,
  ready: boolean,
) {
  run.visible = visible
  run.selectedTriangles = run.submittedTriangles = totals.selectedTriangles
  run.drawnTriangles = totals.drawnTriangles
  run.blendPagedTriangles = totals.transparentTriangles
  run.frustumRejected = totals.frustumRejected
  run.lodLevel = totals.lodLevel
  run.gpuMetricsReady = ready
}

/** Adopts the readback and says whether the IMAGE changed: a readback republishing the same
 *  identifiers in the same order rewrites none. */
export function adoptGpuCut(
  { run, views }: WebgpuPagesCore,
  cutAdopter: ReturnType<typeof createWebgpuCutAdopter>,
) {
  const adopted = cutAdopter.adopt(),
    metrics = cutAdopter.metrics
  run.cutHeld = metrics.cutHeld
  views.main.cut!.adopted = cutAdopter.adopted
  // An adoption that rewrites the lists ages them, at render as in the drain.
  if (metrics.listsRewritten) run.cutEpoch++
  if (adopted) applyTotals(run, metrics, metrics.visible, metrics.ready)
  return metrics.listsRewritten
}

/** A view drawn beside the main one adopts its own readback, once: its requests and drawn
 *  pages through its differences into the union, its `shown`, `drawn` and packed ranks
 *  rewritten. A capture's ranks first under the one budget (#268, `viewReadbacks`). */
export function adoptAsideCut(p: Publication, cut: ViewCut) {
  const { run } = p.rt
  const next = run.asideCut?.peek()
  const held = !!next && next === cut.adopted
  run.cutHeld = held && next?.worldRevision === run.gpuSelection?.worldRevision
  if (!next || held) return false
  cut.adopted = next
  const { pageIds, drawablePageIds = NO_IDS } = next.result
  adoptView(p, cut, pageIds, drawablePageIds)
  copyPacked(run.desiredPacked, cut.asked.ids, cut.asked.count)
  copyPacked(run.shownPacked, cut.drawn.ids, cut.drawn.count)
  copyPacked(run.drawnPacked, cut.drawn.ids, cut.drawn.count)
  copyPages(run.drawn, run.shown)
  markDrawnMirrored(run)
  run.cutEpoch++
  run.pagesEntered = cut.asked.enteredCount
  run.pagesExited = cut.asked.exitedCount
  applyTotals(run, next.result, run.desired.length, true)
  return true
}
