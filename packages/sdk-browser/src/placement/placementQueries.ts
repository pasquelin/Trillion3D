import type { PageRec, ClusterRoot } from '../page/selection/selection.ts';

/** Addresses already counted, reused across calls: nothing is allocated to count a frame. */
const counted = new Set<string>();

type Roots = readonly ClusterRoot<PageRec>[];

/** True when the root of rank `rank`, in `roots`, reads its world from a row. */
export const rowPlacedAt = (roots: Roots, rank: number) => !!roots[rank]?.placement;

/** True when the record of instance `rank` is drawn instanced with the other rows of its page
 *  (`webglPageBatches.ts`). A transparent record placed by a row is drawn on its own, like a
 *  blended copy: the host orders blended by depth, never the instances of one draw. */
export const drawnInstancedAt = (
  roots: Roots,
  rank: number,
  rec: PageRec,
  transparent = rec.transparent,
) => rowPlacedAt(roots, rank) && !transparent && !rec.deformRecord;

/** The host meshes `recs` hang on the WebGL2 path's display graph, which its page ceiling bounds:
 *  one per record drawn on its own, one per PAGE for records drawn instanced — ten thousand opaque
 *  placements of a page are one mesh. `instanced(rec)` says which records are drawn instanced. */
export function attachedPages(recs: readonly PageRec[], instanced: (rec: PageRec) => boolean) {
  counted.clear();
  let own = 0;
  for (const rec of recs)
    if (instanced(rec)) counted.add(rec.url);
    else own++;
  return own + counted.size;
}
