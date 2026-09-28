import type { PageRec } from '../../page/selection/selection.ts';
import { createCutDelta, type CutDelta } from './delta.ts';
import type { WebgpuView, WebgpuViews } from '../pages/state/view.ts';

/** One view's published cut: what it asks the cache for, and what it draws. */
export type ViewCut = { cut: CutDelta; drawn: CutDelta };

/**
 * The difference each view publishes its cut by. The residency sets count every page per
 * placement, so when every view publishes into them by a difference of its own, what they ask for,
 * keep and rank under the one page budget is the union of the views' cuts, a page two views share
 * ranked at its coarsest level (`../residency/budgetRanking.ts`). The main view's is `main`, which
 * the GPU cut adopts too: with one view, nothing else is ever made.
 */
export function createViewCuts(
  packedPages: readonly PageRec[],
  run: { readonly desired: PageRec[] },
  views: WebgpuViews,
  main: ViewCut,
) {
  const others = new Map<WebgpuView, ViewCut>();
  return {
    /** The drawn view's, made at its first cut: its `desired` is the one the groups hold then. */
    active() {
      const view = views.active;
      if (view === views.main) return main;
      let own = others.get(view);
      if (!own) {
        own = { cut: createCutDelta(packedPages, run.desired), drawn: createCutDelta(packedPages) };
        others.set(view, own);
      }
      return own;
    },
    /** Forgets `view`'s and hands it back, to be emptied; none for a view that never drew. */
    release(view: WebgpuView) {
      const own = others.get(view);
      others.delete(view);
      return own;
    },
    /** Bytes of the other views' differences, each sized by that view's cut. */
    get hostBytes() {
      let bytes = 0;
      for (const own of others.values()) bytes += own.cut.hostBytes + own.drawn.hostBytes;
      return bytes;
    },
  };
}
