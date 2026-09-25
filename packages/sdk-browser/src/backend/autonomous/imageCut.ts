import {
  createSelectionResult,
  selectVisiblePages,
  type ClusterRoot,
  type PageRec,
} from '../../page/selection/selection.ts';
import type { EngineCamera } from '../../camera/world.ts';
import type { createGeometryBudget } from './pool.ts';
import { createAutonomousRequests } from './requests.ts';
import { createHeldBytes } from '../../page/cut/held.ts';

/**
 * The cut of a WebGL2 image and what it asks the pool for. The cut is drawn at the host's
 * threshold, each page resident when it holds its index array: the cut rule then draws, for every
 * surface, the finest representation resident (`../../page/cut/rule.ts`). What it asks for is the
 * wanted cut closed over its groups, coarsest first (`requests.ts`), as far as the pool admits it
 * (`pool.ts`): the pool bounds what the image asks for, never the cut.
 */
export function createImageCut(options: {
  roots: ClusterRoot<PageRec>[];
  viewport: [number, number] | undefined;
  shown: PageRec[];
  desired: PageRec[];
  /** What the image asks for, cut to what the pool admits. */
  requested: PageRec[];
  /** Moves when the placements change (`requests.ts`). */
  revision: () => number;
  pool: Pick<ReturnType<typeof createGeometryBudget>, 'admit' | 'fit'> & { readonly held: object };
}) {
  const { roots, shown, desired, requested, pool } = options;
  const requests = createAutonomousRequests(roots, options.revision, requested);
  // The rule's readiness of the placements, a running total counted again each time the requests
  // lay the placements out again (`requests.ts`), so a read between two cuts is exact too.
  const held = createHeldBytes();
  const follow = () => {
    if (requests.follow()) held.track(roots);
  };
  // Cut request and result, allocated once: an image allocates nothing here, and the cut writes
  // `desired` itself instead of being copied into it.
  const selectOptions = {
    pixelError: 0,
    viewport: options.viewport,
    holdResident: true,
    wanted: desired,
    result: createSelectionResult<PageRec>(),
  };
  // The pool the requests were last admitted to: another one — a new budget or root cover — is
  // fitted again before the next trim, so the image that first sees it already holds no more.
  let admittedTo: unknown;
  const cut = (cam: EngineCamera, pixelError: number) => {
    follow();
    selectOptions.pixelError = pixelError;
    const selected = selectVisiblePages(roots, cam, selectOptions, shown);
    requests.of(desired);
    requested.length = pool.admit(requested, pixelError);
    admittedTo = pool.held;
    return selected;
  };
  return Object.assign(cut, {
    /** Bytes of the cut's host tables: the requests' closure and the rule's readiness of each
     *  placement, all sized by what the view asks for and the pool holds, and read without
     *  walking the placements (#483 rule 7). */
    hostBytes: () => (follow(), requests.hostBytes + held.bytes),
    /** Cuts the last requests to the pool drawn since; true when they lost pages, which what the
     *  image keeps must then forget before the pool trims. */
    readmit() {
      if (pool.held === admittedTo) return false;
      admittedTo = pool.held;
      const n = pool.fit(requested);
      if (n === requested.length) return false;
      requested.length = n;
      return true;
    },
  });
}
