// A page record carries no placement value of its own (#1226): its world, its instance-buffer row
// and its winding are those of its root, the one its `placementIndex` ranks in its engine's roots.
import type { MatrixElements } from '../../math/matrixElements.ts';

/** What a reader takes of the roots a record's `placementIndex` ranks: their worlds. */
export type Placements = readonly { readonly world: MatrixElements }[];

/** The root that places `rec`: the rank its engine's layout posted (`placementIndex`). */
export function rootOf<R>(roots: readonly R[], rec: { readonly placementIndex?: number }): R {
  const root = roots[rec.placementIndex ?? -1];
  if (root === undefined) throw new Error('PAGE_PLACEMENT_MISSING');
  return root;
}

/** Posts each root's rank on its pages, from rank `from` on: what an engine does once its roots
 *  were laid out, grown, mounted or removed, before any reader looks one up. */
export function postPlacements(
  roots: readonly { readonly pages: readonly { placementIndex?: number }[] }[],
  from = 0,
) {
  for (let rank = from; rank < roots.length; rank++)
    for (const page of roots[rank].pages) page.placementIndex = rank;
}
