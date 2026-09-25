import {
  catalogueIndexOf,
  type ClusterRoot,
  type PageRec,
} from '../../page/selection/selection.ts';
import { createGroupClosure, type GroupClosure } from '../../page/cut/groupClosure.ts';

/**
 * What the WebGL2 pool is asked for: the wanted cut closed over its groups (`groupClosure.ts`),
 * one record per page, coarsest level first.
 *
 * The cut rule reads residency by group (`../../page/cut/readiness.ts`): a group-mate the view
 * never keeps — past the frustum — would leave its group unready, and its surface drawn one level
 * coarser for good. So each page the cut wants brings its group and the groups above it. Coarsest
 * first, a page never comes before the pages it depends on, and what the pool cannot hold is the
 * finest detail: the cut draws its nearest resident ancestor meanwhile.
 *
 * The closure indexes the placements' pages as one catalogue; it is laid out again when the
 * placements change (`revision`: an instance added or removed, rows grown).
 */
export function createAutonomousRequests(
  roots: readonly ClusterRoot<PageRec>[],
  revision: () => number,
  /** Where the requests are written, rewritten at each `of`. */
  requested: PageRec[],
) {
  let closure: GroupClosure | undefined,
    packed: PageRec[] = [],
    laidOut = -1,
    placements = -1;
  const ids: number[] = [],
    seen = new Set<string>();
  const layOut = () => {
    packed = [];
    roots.forEach((root, placement) => {
      for (const page of root.pages) {
        page.placementIndex = placement;
        page.packedIndex = packed.length;
        packed.push(page);
      }
    });
    closure = createGroupClosure(roots, packed);
    laidOut = revision();
    placements = roots.length;
  };
  const visit = (id: number) => {
    const rec = packed[id];
    if (seen.has(rec.url)) return;
    seen.add(rec.url);
    requested.push(rec);
  };
  const coarsestFirst = (a: PageRec, b: PageRec) => (b.level ?? 0) - (a.level ?? 0);
  return {
    /** Writes the pages `wanted` closes over into `requested`, one per URL, coarsest first. */
    of(wanted: readonly PageRec[]) {
      if (!closure || laidOut !== revision() || placements !== roots.length) layOut();
      ids.length = 0;
      for (const rec of wanted) {
        const id = catalogueIndexOf(packed, rec);
        if (id !== undefined) ids.push(id);
      }
      requested.length = 0;
      seen.clear();
      closure!.closeOver(ids, visit);
      return requested.sort(coarsestFirst);
    },
  };
}
