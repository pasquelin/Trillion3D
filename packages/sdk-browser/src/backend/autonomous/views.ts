import { createEngineCamera, type CameraMotion, type EngineCamera } from '../../camera/world.ts';
import { captureDrawn, tradeCamera, tradeView } from '../../frame/viewTrade.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { WebglFrameGate } from '../../webgl/core/frameGate.ts';

/**
 * What one camera owns on the WebGL2 path: the cut it draws, the cut it wants, what it asks the
 * pool for, its motion and its size. Everything else is the scene's and every view shares it: the
 * gate's revisions, the page store, the geometry pool, which admits the union of the views'
 * requests under its one budget (`pool.ts`), and the residency, which holds the union
 * (`poolOrder.ts`, `residency.ts`).
 */
export type WebglViewState = {
  shown: PageRec[];
  desired: PageRec[];
  requested: PageRec[];
  motion: CameraMotion;
  /** The main view's is the host's own array, which a resize writes. */
  viewport: [number, number] | undefined;
};
export const VIEW_KEYS = [
  'shown',
  'desired',
  'requested',
  'motion',
  'viewport',
] as const satisfies readonly (keyof WebglViewState)[];

/** A view of `viewport` that has drawn nothing yet: no cut, no motion. */
const blankView = (viewport: [number, number] | undefined): WebglViewState => ({
  shown: [],
  desired: [],
  requested: [],
  motion: {},
  viewport,
});

/** One view's record: it always holds its own state, which the live group holds too while it is
 *  drawn; `cam` is the engine camera frame entry writes (`gate.cam`). */
export type WebglView = WebglViewState & { cam: EngineCamera };

/**
 * The views of one WebGL2 backend. The frame reads the drawn view's state in `live`, which it
 * opened on (the main view), and nowhere else; `all` is every view, the main one first, and
 * `others` every view not drawn, rewritten at each switch. `moved` hears that the union changed.
 */
export function createWebglViews(
  viewport: [number, number] | undefined,
  gate: Pick<WebglFrameGate, 'cam' | 'viewReplaced'>,
  moved: () => void,
) {
  const live = blankView(viewport);
  const main: WebglView = { ...live, cam: gate.cam };
  const all = [main],
    others: WebglView[] = [];
  const views = {
    live,
    main,
    active: main,
    all,
    others,
    /** A capture is drawn (`captureAside`): the pool ranks its requests first (`poolUnion.ts`). */
    capturing: false,
    /** Whether the drawn view is a capture, whose cut is ranked first under the one budget. */
    captureDrawn: () => captureDrawn(views, views.capturing),
    /** A view of `width × height` that has drawn nothing yet: no cut, no motion. */
    create(width: number, height: number) {
      const view: WebglView = { ...blankView([width, height]), cam: createEngineCamera() };
      all.push(view);
      others.push(view);
      return view;
    },
    /**
     * The one place a view is switched: the live group and the gate's camera hold `view`'s once
     * this returns. References are traded, nothing is allocated; with one view it never runs.
     * The gate learns the view was replaced, so no view holds on another's image.
     */
    use(view: WebglView) {
      const from = views.active;
      if (from === view) return;
      tradeView(live, from, view, VIEW_KEYS);
      views.active = view;
      others.length = 0;
      for (const other of all) if (other !== view) others.push(other);
      tradeCamera(gate, from, view);
      gate.viewReplaced();
      moved();
    },
    /** `view`, not the main one, leaves: its cut leaves the union, the main view is drawn. */
    release(view: WebglView) {
      const at = all.indexOf(view);
      if (view === main || at < 0) return;
      views.use(main);
      all.splice(at, 1);
      others.splice(others.indexOf(view), 1);
    },
    /** Runs `work` in a view of its own at `size`, released after, whatever `work` did: the main
     *  view keeps its cut and its motion. */
    captureAside<T>(size: { width: number; height: number }, work: () => T) {
      const view = views.create(size.width, size.height);
      views.use(view);
      views.capturing = true;
      try {
        return work();
      } finally {
        views.capturing = false;
        views.release(view);
      }
    },
    /** Every view's lists: a record leaving the scene leaves each of them. */
    lists: () => all.flatMap((view) => [view.shown, view.desired, view.requested]),
  };
  return views;
}
