import type { PageRec } from '../../selection/types.ts'
import { createCutDelta } from './delta.ts'
import { createCutPending } from './pending.ts'
import { createWebgpuCutAdopter } from './adoption.ts'
import type { GroupClosure } from '../groupClosure.ts'
import type { GpuCut } from '../../../gpu/core/selection.ts'
import type { WebgpuResidencySets } from '../../residency/sets.ts'
import type { WebgpuPagesCore } from '../../../frame/backend/runtime.ts'
import type { WebgpuView } from '../../../frame/backend/state/view.ts'
import { captureDrawn } from '../../../frame/view/viewTrade.ts'
import {
  NO_IDS,
  adoptAsideCut,
  adoptGpuCut,
  adoptView,
  publishCut,
  type Publication,
} from './publicationAdopt.ts'

/**
 * Publication of the GPU cut, whichever view it cuts (#1483).
 *
 * A cut is never handed out as a fresh list: it is published as a DIFFERENCE — what just entered,
 * what just left — and the readers that live off it update their counters without walking anything
 * again. The main view's readback arrives by its identifiers (`adoption.ts`), as a view drawn beside
 * it does (`../../dag/aside.ts`).
 */
export function createWebgpuCutPublication(
  rt: WebgpuPagesCore,
  residencySets: WebgpuResidencySets,
  closure: GroupClosure,
) {
  const { run, views } = rt
  const p = publicationOf(rt, residencySets, closure)
  const cutAdopter = cutAdopterOf(p)
  // Before the first readback the image asks the cache for the pinned cover and nothing else.
  // Read here and not retained: this publication's lifetime is that of the engine, and a list that
  // only serves bootstrap has no reason to stay hooked on it.
  p.cutDelta.adoptRecords(rt.layout.gpuWanted, p.rankOf)
  publishCut(p, p.cutDelta)
  const adoptMain = () => adoptGpuCut(rt, cutAdopter)
  /** The drawn view's differences; another view's are made at its first cut, on its `desired`
   *  and its `shown`. */
  const adoptAside = () =>
    adoptAsideCut(
      p,
      (views.active.cut ??= {
        asked: createCutDelta(rt.layout.packedPages, run.desired),
        drawn: createCutDelta(rt.layout.packedPages, run.shown),
      }),
    )
  return {
    /** Pages of the requested cut that are still waiting for their bytes. */
    cutPending: p.cutPending,
    hostTableBytes: () => publicationBytes(p),
    adoptGpuCut: adoptMain,
    adoptAsideCut: adoptAside,
    /** The drawn view adopts its readback: the main cut's, or its own beside it. */
    adoptViewCut: () => (views.active === views.main ? adoptMain() : adoptAside()),
    /** Every view's readback last adopted, the drawn capture's apart: what the streaming reads its
     *  requests from (`../../residency/queue.ts`), the capture's first. */
    viewReadbacks: createViewReadbacks(rt),
    /** `view`, not the main one, is released: its cut leaves the union, whatever it held. */
    releaseView(view: WebgpuView) {
      if (view === views.main || !view.cut) return
      adoptView(p, view.cut, NO_IDS, NO_IDS)
      view.cut = undefined
    },
  }
}

/** The main view's differences and the pending pages, watching the rank journal. */
function publicationOf(
  rt: WebgpuPagesCore,
  residencySets: WebgpuResidencySets,
  closure: GroupClosure,
): Publication {
  const { run, views } = rt,
    { clusters, packedPages } = rt.layout
  const cutDelta = createCutDelta(packedPages, run.desired)
  // The drawable cut writes its records itself; `run.shown` is only a copy of it, when adopted.
  const drawnPages: PageRec[] = []
  const drawnDelta = createCutDelta(packedPages, drawnPages)
  // The cache is asked for the cut closed over its groups, in the order the streaming started what
  // it waits on; the image waits for what the pool took.
  const rankOf = (rec: PageRec) => clusters.pageIndexOf(rec) ?? -1
  const cutPending = createCutPending(
    packedPages,
    closure.delta,
    residencySets.accepts,
    () => residencySets.acceptedRevision + residencySets.rankRevision,
    rankOf,
    residencySets.queueRank,
  )
  // Every coverage flip — bytes in or out, a slot taken or given — goes through the rank journal.
  clusters.watchTouched((page) => cutPending.touch(page))
  // Every view publishes its cut into the same sets, which count each page per placement: the budget
  // ranks the union of the views' cuts. The main view's are the two above; with one view, no more.
  views.main.cut = { asked: cutDelta, drawn: drawnDelta }
  return { rt, residencySets, closure, cutDelta, drawnDelta, drawnPages, cutPending, rankOf }
}

/** The main view's adopter: readback describes submitted work; the current GPU mask decides what
 *  a moving camera draws. */
function cutAdopterOf(p: Publication) {
  const { run } = p.rt,
    { cutDelta, drawnDelta, residencySets } = p
  return createWebgpuCutAdopter({
    selection: () => run.gpuSelection,
    desired: run.desired,
    desiredPacked: run.desiredPacked,
    shown: run.shown,
    shownPacked: run.shownPacked,
    uniforms: run.selectionUniforms,
    delta: cutDelta,
    drawnDelta,
    drawnPages: p.drawnPages,
    onDrawnDelta: () => residencySets.applyDrawn(drawnDelta),
    onCutDelta: () => {
      if (cutDelta.changed) publishCut(p, cutDelta)
      run.pagesEntered = cutDelta.enteredCount
      run.pagesExited = cutDelta.exitedCount
    },
  })
}

/** Bytes of the cut's host tables, another view's differences included. */
function publicationBytes(p: Publication) {
  const { run, views } = p.rt
  return (
    p.closure.hostBytes +
    (run.gpuSelection?.hostBytes ?? 0) +
    p.residencySets.hostBytes +
    p.cutDelta.hostBytes +
    p.drawnDelta.hostBytes +
    p.cutPending.hostBytes +
    // Another view's differences, counted while it is drawn: a capture's live only for its call.
    (views.active === views.main
      ? 0
      : (views.active.cut?.asked.hostBytes ?? 0) + (views.active.cut?.drawn.hostBytes ?? 0))
  )
}

/**
 * Every view's readback last adopted, the drawn capture's apart (`viewReadbacks`): handed out in
 * one object made once, rebuilt only when a view adopted another readback or the capture changed —
 * an image that adopted nothing new walks nor makes anything.
 */
function createViewReadbacks({ views, capture }: Pick<WebgpuPagesCore, 'views' | 'capture'>) {
  /** The readback `view` adds to the union: none for a parked view, whose cut counts for no one. */
  const counted = (view: WebgpuView) => (view.parked ? undefined : view.cut?.adopted)
  const readbacks: GpuCut[] = [],
    handed = { cuts: readbacks, first: null as GpuCut | null },
    /** Each view's adoption `handed` was made of: the main view's, then the persistent ones'. */
    madeOf: (GpuCut | undefined)[] = []
  const sameAdoptions = () => {
    if (madeOf.length !== views.persistent.length + 1) return false
    if (madeOf[0] !== views.main.cut?.adopted) return false
    for (let v = 0; v < views.persistent.length; v++)
      if (madeOf[v + 1] !== counted(views.persistent[v])) return false
    return true
  }
  return () => {
    const first = captureDrawn(views, capture) ? (views.active.cut?.adopted ?? null) : null
    if (first === handed.first && sameAdoptions()) return handed
    handed.first = first
    readbacks.length = madeOf.length = 0
    for (const view of [views.main, ...views.persistent]) {
      const adopted = counted(view)
      madeOf.push(adopted)
      if (adopted && adopted !== first) readbacks.push(adopted)
    }
    return handed
  }
}
