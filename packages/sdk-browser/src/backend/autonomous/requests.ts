import type { ClusterRoot, PageRec } from '../../page/selection/selection.ts';
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
 * The closure reads each page by its placement and its rank among the placements' pages, written
 * on the record and laid out again when the placements change (`revision`: an instance added or
 * removed, rows grown). Its tables hold what the cut closes over, never the catalogue.
 */
export function createAutonomousRequests(
  roots: readonly ClusterRoot<PageRec>[],
  revision: () => number,
  /** Where the requests are written, rewritten at each `of`. */
  requested: PageRec[],
) {
  let closure: GroupClosure | undefined,
    laidOut = -1,
    placements = -1;
  const seen = new Set<string>();
  const layOut = () => {
    let packed = 0;
    roots.forEach((root, placement) => {
      for (const page of root.pages) {
        page.placementIndex = placement;
        page.packedIndex = packed++;
      }
    });
    closure = createGroupClosure(roots);
    laidOut = revision();
    placements = roots.length;
  };
  const visit = (_id: number, rec: PageRec) => {
    if (seen.has(rec.url)) return;
    seen.add(rec.url);
    requested.push(rec);
  };
  /** Lays the placements out again when they changed since the last layout; true when it did. */
  const follow = () => {
    if (closure && laidOut === revision() && placements === roots.length) return false;
    layOut();
    return true;
  };
  const coarsestFirst = (a: PageRec, b: PageRec) => (b.level ?? 0) - (a.level ?? 0);
  return {
    /** Bytes of the closure's tables, sized by what the last cuts closed over. */
    get hostBytes() {
      return closure?.hostBytes ?? 0;
    },
    follow,
    /** Writes the pages `wanted` closes over into `requested`, one per URL, coarsest first. */
    of(wanted: readonly PageRec[]) {
      follow();
      requested.length = 0;
      seen.clear();
      closure!.closeOverRecords(wanted, visit);
      return requested.sort(coarsestFirst);
    },
  };
}
