import type { PageRec } from '../../page/selection/selection.ts';
import { createCutDelta } from './delta.ts';
import { createCutPending, type CutPending } from './pending.ts';
import { createWebgpuCutAdopter } from './adoption.ts';
import type { GroupClosure } from './groupClosure.ts';
import { markDrawnMirrored } from '../pages/helpers.ts';
import type { WebgpuResidencySets } from '../residency/sets.ts';
import type { WebgpuPagesCore } from '../pages/runtime.ts';

/**
 * What the rank journal notifies when a page changes coverage. Set outside publication so that
 * nothing else is captured besides the set it touches: the journal keeps it as long as the
 * engine, and a closure taken inside publication would hold its whole context there.
 */
const coverageWatcher = (pending: CutPending) => (page: number) => pending.touch(page);

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
) {
  const { run, gpu } = rt,
    { rows, packedPages } = rt.layout;
  const cutDelta = createCutDelta(packedPages, run.desired);
  // The drawable cut writes its records itself, reading its sequence once: `run.shown` is then
  // only a copy of it, and only when the image adopts the readback that produced it.
  const drawnPages: PageRec[] = [];
  const drawnDelta = createCutDelta(packedPages, drawnPages);
  // What the cache is asked for is the cut closed over its groups (`groupClosure.ts`); what the
  // image waits for is the part of it the pool accepted.
  const cutPending = createCutPending(packedPages, closure.delta, residencySets.accepts);
  // The three ways a cluster's coverage flips — bytes received, bytes released, a cache slot taken
  // or given back — all go through the rank journal, which names them one by one.
  rows.watchTouched(coverageWatcher(cutPending));
  const publishCut = () => {
    closure.apply(cutDelta);
    residencySets.applyCut(closure.delta);
    cutPending.apply();
  };
  const publishDrawn = () => residencySets.applyDrawn(drawnDelta);
  // Readback describes submitted work and future streaming requests. It never
  // decides the cut drawn for a moving camera; the current GPU mask does that.
  const cutAdopter = createWebgpuCutAdopter({
    selection: () => run.gpuSelection,
    desired: run.desired,
    shown: run.shown,
    drawn: run.drawn,
    uniforms: run.selectionUniforms,
    delta: cutDelta,
    drawnDelta,
    drawnPages,
    onDrawnDelta: publishDrawn,
    onDrawnMirrored: () => markDrawnMirrored(run),
    onCutDelta: () => {
      publishCut();
      run.pagesEntered = cutDelta.enteredCount;
      run.pagesExited = cutDelta.exitedCount;
    },
  });
  // Before the first readback the image asks the cache for the pinned cover and nothing else.
  // Read here and not retained: this publication's lifetime is that of the engine, and a list that
  // only serves bootstrap has no reason to stay hooked on it.
  cutDelta.adoptRecords(rt.layout.gpuWanted);
  publishCut();
  /** Adopts the readback and says whether the IMAGE changed: whether the displayed lists were
   *  rewritten. A fresh readback republishing the same identifiers in the same order rewrites none. */
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
    run.uncoveredTriangles = metrics.uncoveredTriangles;
    run.submittedTriangles = metrics.selectedTriangles;
    run.drawnTriangles = metrics.drawnTriangles;
    run.blendPagedTriangles = metrics.transparentTriangles;
    run.frustumRejected = metrics.frustumRejected;
    run.lodLevel = metrics.lodLevel;
    run.gpuMetricsReady = metrics.ready;
    return metrics.listsRewritten;
  };
  return {
    /** Pages of the requested cut that are still waiting for their bytes. */
    cutPending,
    adoptGpuCut,
    /**
     * The CPU cut publishes its own through the same differences: `wanted` writes `run.desired`
     * itself, and the same readers follow. Called once per image that draws, and only once its
     * guards have passed: what it sets, the image holds. The caller has already forgotten the
     * readback and aged the lists before choosing — it is the caller that covers an erroneous
     * exit of the cut, as it does for the copy of `drawn` — so none of that is redone here.
     * Republishing it as-is changes nothing: the difference is empty.
     */
    adoptCpuCut(wanted: readonly PageRec[], shown: readonly PageRec[]) {
      cutDelta.adoptRecords(wanted);
      publishCut();
      drawnDelta.adoptRecords(shown);
      publishDrawn();
    },
    /** The held readback no longer describes the image's lists: the next one will re-read it whole. */
    forgetReadback: () => (run.cutEpoch++, cutAdopter.forgetReadback()),
  };
}
