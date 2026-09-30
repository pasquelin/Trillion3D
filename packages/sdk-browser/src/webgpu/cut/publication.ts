import type { PageRec } from '../../page/selection/selection.ts';
import { createCutDelta, type CutDelta } from './delta.ts';
import { createCutPending } from './pending.ts';
import { coverageWatcher } from './coverage.ts';
import { createWebgpuCutAdopter } from './adoption.ts';
import type { GroupClosure } from '../../page/cut/groupClosure.ts';
import { createHeldResidency } from '../../page/cut/held.ts';
import { livePlacementIndex } from '../../page/selection/placements.ts';
import { copyPacked, markDrawnMirrored } from '../pages/helpers.ts';
import type { WebgpuResidencySets } from '../residency/sets.ts';
import type { WebgpuPagesCore } from '../pages/runtime.ts';
import { createEvictionFeed } from '../residency/evictionFeed.ts';
import type { ViewCut, WebgpuView } from '../pages/state/view.ts';
import { captureDrawn } from '../../frame/viewTrade.ts';

/** The list ahead of a cut that has no view ahead, and the cut of a view let go. */
const NO_IDS: readonly number[] = [];

/**
 * Publication of a cut, whoever decides it.
 *
 * A cut is never handed out as a fresh list: it is published as a DIFFERENCE — what just entered,
 * what just left — and the readers that live off it update their counters without walking anything
 * again. GPU readback arrives there by its identifiers, the CPU cut by its records, and the
 * contract is the same on both sides: that is what lets the GPU, when it takes the image back,
 * diff against what the CPU left rather than ask for everything again.
 */
export function createWebgpuCutPublication(
  rt: WebgpuPagesCore,
  residencySets: WebgpuResidencySets,
  closure: GroupClosure,
  /** The lower tiers in order (`../residency/lowerTier.ts`), each counted in the host tables; the
   *  view ahead's requests go to `ahead`, below the camera's. */
  tiers: {
    all: readonly { readonly hostBytes: number }[];
    ahead: { offerIds(ids: ArrayLike<number>): void };
  },
  /** Whether the pool holds a cluster's slot: the CPU cut's residency rule. */
  poolHolds: (rec: PageRec) => boolean,
) {
  const { run, gpu, views, capture } = rt,
    { rows, packedPages, recordOf } = rt.layout,
    { ahead } = tiers;
  const cutDelta = createCutDelta(packedPages, run.desired);
  // The drawable cut writes its records itself; `run.shown` is only a copy of it, when adopted.
  const drawnPages: PageRec[] = [];
  const drawnDelta = createCutDelta(packedPages, drawnPages);
  // The cache is asked for the cut closed over its groups; the image waits for what the pool took.
  const rankOf = (rec: PageRec) => rows.pageIndexOf(rec) ?? -1;
  const cutPending = createCutPending(
    packedPages,
    closure.delta,
    residencySets.accepts,
    () => residencySets.acceptedRevision,
    rankOf,
  );
  // The CPU cut's residency: the pool's slots, moved by the rank journal; the tables follow a grow.
  const held = createHeldResidency(
    { isResident: poolHolds },
    livePlacementIndex(() => rt.layout.placement),
  );
  held.track(rt.layout.selectionRoots);
  // Every coverage flip — bytes in or out, a slot taken or given — goes through the rank journal.
  rows.watchTouched(coverageWatcher(cutPending, held, recordOf));
  const publishCut = (cut: CutDelta) => {
    closure.apply(cut);
    residencySets.applyCut(closure.delta);
    cutPending.apply();
  };
  // Every view publishes its cut into the same sets, which count each page per placement: the budget
  // ranks the union of the views' cuts. The main view's are the two above; with one view, no more.
  views.main.cut = { asked: cutDelta, drawn: drawnDelta };
  /** The drawn view's differences; another view's are made at its first cut, on its `desired`. */
  const activeCut = () =>
    (views.active.cut ??= {
      asked: createCutDelta(packedPages, run.desired),
      drawn: createCutDelta(packedPages),
    });
  /** A view publishes `wanted` and `shown`, both as the packed ranks the CPU cut names them by. */
  const adopt = (
    own: ViewCut,
    wanted: ArrayLike<number>,
    shown: ArrayLike<number>,
    wantedCount = wanted.length,
    shownCount = shown.length,
  ) => {
    own.asked.apply(wanted, wantedCount);
    publishCut(own.asked);
    own.drawn.apply(shown, shownCount);
    residencySets.applyDrawn(own.drawn);
  };
  // Readback describes submitted work; the current GPU mask decides what a moving camera draws.
  const cutAdopter = createWebgpuCutAdopter({
    selection: () => run.gpuSelection,
    desired: run.desired,
    desiredPacked: run.desiredPacked,
    shown: run.shown,
    shownPacked: run.shownPacked,
    drawn: run.drawn,
    drawnPacked: run.drawnPacked,
    uniforms: run.selectionUniforms,
    delta: cutDelta,
    drawnDelta,
    drawnPages,
    onDrawnDelta: () => residencySets.applyDrawn(drawnDelta),
    onDrawnMirrored: () => markDrawnMirrored(run),
    onAhead: ahead.offerIds,
    onCutDelta: () => {
      publishCut(cutDelta);
      run.pagesEntered = cutDelta.enteredCount;
      run.pagesExited = cutDelta.exitedCount;
    },
  });
  // Before the first readback the image asks the cache for the pinned cover and nothing else.
  // Read here and not retained: this publication's lifetime is that of the engine, and a list that
  // only serves bootstrap has no reason to stay hooked on it.
  cutDelta.adoptRecords(rt.layout.gpuWanted, rankOf);
  publishCut(cutDelta);
  /** Adopts the readback and says whether the IMAGE changed: a readback republishing the same
   *  identifiers in the same order rewrites none. */
  const adoptGpuCut = () => {
    const adopted = cutAdopter.adopt(),
      metrics = cutAdopter.metrics;
    run.cutHeld = metrics.cutHeld;
    gpu.cutTruncated = metrics.truncated;
    // An adoption that rewrites the lists ages them, at render as in the drain.
    if (metrics.listsRewritten) run.cutEpoch++;
    if (!adopted) return metrics.listsRewritten;
    run.visible = metrics.visible;
    run.selectedTriangles = metrics.selectedTriangles;
    run.submittedTriangles = metrics.selectedTriangles;
    run.drawnTriangles = metrics.drawnTriangles;
    run.blendPagedTriangles = metrics.transparentTriangles;
    run.frustumRejected = metrics.frustumRejected;
    run.lodLevel = metrics.lodLevel;
    run.gpuMetricsReady = metrics.ready;
    return metrics.listsRewritten;
  };
  return {
    followEvictions: createEvictionFeed(packedPages, () => gpu.cache),
    /** Pages of the requested cut that are still waiting for their bytes. */
    cutPending,
    /** The CPU cut's residency, moved by the rank journal: the cache's changes reach it once the
     *  mirror is synced (`../residency/mirror.ts`). */
    heldResidency: held,
    /** Bytes of the cut's host tables, each sized by what the view asks for and the pool holds,
     *  never by the catalogue (#483 rule 6), each read in constant time (#483 rule 7). */
    hostTableBytes: () =>
      closure.hostBytes +
      (run.gpuSelection?.hostBytes ?? 0) +
      held.bytes +
      residencySets.hostBytes +
      cutDelta.hostBytes +
      drawnDelta.hostBytes +
      cutPending.hostBytes +
      tiers.all.reduce((bytes, tier) => bytes + tier.hostBytes, 0) +
      // Another view's differences, counted while it is drawn: a capture's live only for its call.
      (views.active === views.main
        ? 0
        : (views.active.cut?.asked.hostBytes ?? 0) + (views.active.cut?.drawn.hostBytes ?? 0)),
    adoptGpuCut,
    /** The CPU cut publishes its own through the same differences: `wanted` writes `run.desired`,
     *  called once per drawing image after its guards. Republishing as-is changes nothing. */
    adoptCpuCut(
      wanted: ArrayLike<number>,
      shown: ArrayLike<number>,
      wantedCount = wanted.length,
      shownCount = shown.length,
    ) {
      // The CPU cut evaluates no view ahead: what the main view's last readback asked for ahead is
      // let go. The view ahead is the main view's own, so another view's cut leaves it.
      if (views.active === views.main) ahead.offerIds(NO_IDS);
      const cut = activeCut();
      adopt(cut, wanted, shown, wantedCount, shownCount);
      // The packed ranks of the wanted cut, rank by rank beside `run.desired` (#1235): the delta's
      // own buffer is swapped at each difference and longer than its live ranks, never handed out.
      copyPacked(run.desiredPacked, cut.asked.ids, cut.asked.count);
      // A capture is drawn alone, the others wait for it: its cut is ranked first under the one
      // budget, as when it replaced the main view's, so it keeps the detail pages it kept then
      // (#268). A persistent view and the main one rank the union, the same queue whichever is
      // drawn, so views drawn every frame never trade slots.
      residencySets.drawnFirst = captureDrawn(views, capture) ? run.desiredPacked : null;
    },
    /** `view`, not the main one, is released: its cut leaves the union, whatever it held. */
    releaseView(view: WebgpuView) {
      if (view === views.main || !view.cut) return;
      adopt(view.cut, NO_IDS, NO_IDS);
      view.cut = undefined;
      if (residencySets.drawnFirst === view.run.desiredPacked) residencySets.drawnFirst = null;
    },
    /** The held readback no longer describes the image's lists: the next one will re-read it whole. */
    forgetReadback: () => (run.cutEpoch++, cutAdopter.forgetReadback()),
  };
}
