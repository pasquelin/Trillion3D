import {
  createSelectionResult,
  selectVisiblePages,
  type ClusterRoot,
  type PageRec,
} from '../../page/selection/selection.ts';
import type { EngineCamera } from '../../camera/world.ts';
import type { createGeometryBudget } from './pool.ts';
import { createAutonomousRequests } from './requests.ts';
import type { HeldResidency } from '../../page/cut/held.ts';
import type { WebglViewState } from './views.ts';

/**
 * The cut of a WebGL2 image and what it asks the pool for. The cut is drawn at the host's
 * threshold, each page resident when it holds its index array: the cut rule then draws, for every
 * surface, the finest representation resident (`../../page/cut/rule.ts`). What it asks for is the
 * wanted cut closed over its groups, coarsest first (`requests.ts`), as far as the pool admits it
 * (`pool.ts`): the pool bounds what the image asks for, never the cut.
 */
export function createImageCut(options: {
  roots: ClusterRoot<PageRec>[];
  /** The drawn view's lists and size, read at each cut (`views.ts`); what it asks for, `requested`,
   *  is cut to what the pool admits. */
  view: Pick<WebglViewState, 'shown' | 'desired' | 'requested' | 'viewport'>;
  /** Moves when the placements change (`requests.ts`). */
  revision: () => number;
  pool: Pick<ReturnType<typeof createGeometryBudget>, 'admit' | 'fit'> & { readonly held: object };
  /** The rule's readiness of the placements, moved by the pool's loads and releases. */
  held: HeldResidency;
}) {
  const { roots, view, pool, held } = options;
  const requests = createAutonomousRequests(roots, options.revision, held);
  // Cut request and result, allocated once: an image allocates nothing here, and the cut writes
  // the drawn view's `desired` itself instead of being copied into it.
  const selectOptions = {
    pixelError: 0,
    viewport: view.viewport,
    held,
    wanted: view.desired,
    result: createSelectionResult<PageRec>(),
  };
  // The pool the requests were last admitted to: another one — a new budget or root cover — is
  // fitted again before the next trim, so the image that first sees it already holds no more.
  let admittedTo: unknown;
  const cut = (cam: EngineCamera, pixelError: number) => {
    const { desired, requested } = view;
    requests.follow();
    selectOptions.pixelError = pixelError;
    selectOptions.viewport = view.viewport;
    selectOptions.wanted = desired;
    const selected = selectVisiblePages(roots, cam, selectOptions, view.shown);
    requests.of(desired, requested);
    requested.length = pool.admit(requested, pixelError);
    admittedTo = pool.held;
    return selected;
  };
  return Object.assign(cut, {
    /** Bytes of the cut's host tables: the requests' closure and the rule's readiness of each
     *  placement, all sized by what the view asks for and the pool holds, and read without
     *  walking the placements (#483 rule 7). */
    hostBytes: () => (requests.follow(), requests.hostBytes + held.bytes),
    /** Cuts the last requests to the pool drawn since; true when they lost pages, which what the
     *  image keeps must then forget before the pool trims. */
    readmit() {
      if (pool.held === admittedTo) return false;
      admittedTo = pool.held;
      const { requested } = view;
      const n = pool.fit(requested);
      if (n === requested.length) return false;
      requested.length = n;
      return true;
    },
  });
}
