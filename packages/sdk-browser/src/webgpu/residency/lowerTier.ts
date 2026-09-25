import type { PageRec } from '../../page/selection/selection.ts';
import { createSparseInts } from '../../page/cut/sparseInts.ts';

/**
 * A lower residency tier: pages a cut asked for below the camera's own — the casters the light cuts
 * want, or the pages ahead of the camera (#488) —, in their order — highest replacement error first
 * — each with the groups it closes over (`../../page/cut/groupClosure.ts`), without repeats, and no longer
 * than the pool. The camera's tier is served first and pinned; a lower one only fills what the
 * camera leaves (`residentEnsurer.ts`).
 *
 * The list is replaced whole each time its source reports: a frame whose light cuts redraw no page
 * reports nothing, and the last list stands — a still scene asks for nothing new. The view ahead
 * reports with every readback, an empty list once the camera stops.
 */
export type LowerTier = ReturnType<typeof createLowerTier>;

export function createLowerTier(options: {
  keyOf: (page: PageRec) => number;
  room: () => number;
  closeOver: (ids: ArrayLike<number>, visit: (id: number, rec: PageRec) => void) => void;
}) {
  const { keyOf, room, closeOver } = options;
  const pages: PageRec[] = [];
  /** The CPU light cuts' packed ids, reused from one report to the next. */
  const ids: number[] = [];
  /** The keys of the last report: as many as it names, never the catalogue. */
  const named = createSparseInts();
  const begin = () => {
    pages.length = 0;
    named.clear();
  };
  const push = (_id: number, rec: PageRec) => {
    if (pages.length >= room()) return;
    const key = keyOf(rec);
    if (named.set(key, 1)) return;
    pages.push(rec);
  };
  return {
    pages,
    /** True when the last report names this key: a page this tier still wants. */
    has: (key: number) => named.has(key),
    /** A GPU cut's requests: page indices of the packed catalogue. */
    offerIds(requested: ArrayLike<number>) {
      begin();
      closeOver(requested, push);
    },
    /** The CPU light cuts' wanted pages, one list per redrawn face. */
    offerPages(lists: ReadonlyArray<readonly PageRec[]>, count: number) {
      begin();
      ids.length = 0;
      for (let run = 0; run < count; run++)
        for (const rec of lists[run]) {
          const id = rec.packedIndex ?? -1;
          if (id >= 0) ids.push(id);
        }
      closeOver(ids, push);
    },
  };
}
