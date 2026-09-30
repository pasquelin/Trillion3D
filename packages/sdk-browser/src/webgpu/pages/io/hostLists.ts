import { collectPendingUrls, type PageRec } from '../../../page/selection/selection.ts';
import { awaitedPages } from '../../row/pageSlots.ts';
import { withClosure } from '../../../page/selection/bundleDependencies.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** The cut the host keeps: the requested one, or past the page budget the part the pool accepted —
 *  the rest is drawn by its nearest resident ancestor and never fetched. */
const retainedCut = (rt: WebgpuPagesRuntime): readonly PageRec[] =>
  rt.run.coverageBudgetLimited ? rt.services.residencySets.wantedPages : rt.run.desired;

/**
 * Addresses the image still waits for. They are a function of the requested cut, the budget flag,
 * bootstrap coverage and the bytes the pages hold — and of nothing else. An image that reread the
 * sample it already held, with no page receiving or losing its bytes, therefore returns exactly the
 * list already yielded.
 */
export function pendingUrls(rt: WebgpuPagesRuntime) {
  const { run } = rt,
    ready = rt.services.bootstrapState.ready,
    held = run.pendingHeld;
  if (
    run.cutHeld &&
    held.cut === run.cutEpoch &&
    held.epoch === run.pageArrayEpoch &&
    held.limited === run.coverageBudgetLimited &&
    held.ready === ready
  )
    return run.hostPendingScratch;
  held.cut = run.cutEpoch;
  held.epoch = run.pageArrayEpoch;
  held.limited = run.coverageBudgetLimited;
  held.ready = ready;
  // Until pinned coverage is there, that is what we wait for. Then the cut itself holds the list of
  // its rows without bytes that the pool accepted: those are the only ones to walk, and a fully
  // arrived cut — the ordinary case — walks none.
  const waiting = !ready
    ? awaitedPages(rt.setup.bootstrap, run.awaitedScratch)
    : rt.services.cutPending.records;
  return collectPendingUrls(waiting, run.hostPendingScratch, rt.setup.requestStamps);
}

/**
 * Addresses the host pins after the render: bootstrap coverage, what the image draws and what the
 * cut asks. The request-key rank is posted once and for all by the catalogue: two pages that share
 * a request share their rank, and dedup splits them by a stamp instead of hashing a hundred thousand
 * strings per image. Same addresses, same order, same length as a string set. And an image that
 * reread the sample already held reads three unchanged lists: it returns the one it yielded rather
 * than remaking it.
 */
export function pageUrls(rt: WebgpuPagesRuntime) {
  const { run } = rt,
    { urlScratch } = run,
    stamps = rt.setup.requestStamps,
    held = run.urlsHeld;
  if (
    run.cutHeld &&
    held.cut === run.cutEpoch &&
    held.epoch === run.pageArrayEpoch &&
    held.limited === run.coverageBudgetLimited
  )
    return urlScratch;
  held.cut = run.cutEpoch;
  held.epoch = run.pageArrayEpoch;
  held.limited = run.coverageBudgetLimited;
  urlScratch.length = 0;
  stamps.begin();
  stamps.mark(rt.setup.bootstrap, urlScratch);
  stamps.mark(run.shown, urlScratch);
  withClosure(retainedCut(rt), (list) => stamps.mark(list, urlScratch));
  return urlScratch;
}

/**
 * The same pins as `pageUrls`, stated as a rank delta: what entered and what left since the previous
 * image. No string, no key set, no allocation — three lists walked as integers, and the cache then
 * touches only what moved. An image that reread the sample already held does not even walk these
 * lists: it returns the empty delta.
 */
export function retainedRanks(rt: WebgpuPagesRuntime) {
  const { run } = rt,
    ranks = rt.setup.hostRanks,
    held = run.ranksHeld;
  if (
    run.cutHeld &&
    held.cut === run.cutEpoch &&
    held.epoch === run.pageArrayEpoch &&
    held.limited === run.coverageBudgetLimited
  )
    return ranks.hold();
  held.cut = run.cutEpoch;
  held.epoch = run.pageArrayEpoch;
  held.limited = run.coverageBudgetLimited;
  ranks.begin();
  ranks.mark(rt.setup.bootstrap);
  ranks.mark(run.shown);
  withClosure(retainedCut(rt), ranks.mark);
  return ranks.finish();
}
