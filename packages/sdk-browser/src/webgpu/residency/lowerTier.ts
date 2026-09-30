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
export function createLowerTier(options: {
  keyOf: (page: PageRec) => number;
  room: () => number;
  closeOver: (
    ids: ArrayLike<number>,
    visit: (id: number, rec: PageRec) => void,
    full?: () => boolean,
  ) => void;
}) {
  const { keyOf, room, closeOver } = options;
  const pages: PageRec[] = [];
  /** The CPU light cuts' packed ids, reused from one report to the next. */
  const ids: number[] = [];
  /** The keys of the last report: as many as it names, never the catalogue. */
  const named = createSparseInts();
  let revision = 0;
  const begin = () => {
    pages.length = 0;
    named.clear();
    revision++;
  };
  /** The list holds the pool: the rest of a report is not walked (a view ahead names up to half
   *  the sample each readback). */
  const full = () => pages.length >= room();
  const push = (_id: number, rec: PageRec) => {
    if (full()) return;
    const key = keyOf(rec);
    if (named.set(key, 1)) return;
    pages.push(rec);
  };
  return {
    pages,
    /** Advanced by every report: the merge of the tiers is remade only then (`createLowerMerge`). */
    get revision() {
      return revision;
    },
    /** True when the last report names this key: a page this tier still wants. */
    has: (key: number) => named.has(key),
    /** Bytes of the tier's tables, read in constant time: its keys, and one 8-byte slot per entry
     *  of its two lists — bounded by the pool, never the catalogue (#483 rule 6). */
    get hostBytes() {
      return named.byteLength + (pages.length + ids.length) * 8;
    },
    /** A GPU cut's requests: page indices of the packed catalogue. */
    offerIds(requested: ArrayLike<number>) {
      begin();
      closeOver(requested, push, full);
    },
    /** The CPU light cuts' wanted pages as packed ranks, one list per redrawn face (`cpuCasters.ts`). */
    offerPages(lists: ReadonlyArray<readonly number[]>, count: number) {
      begin();
      ids.length = 0;
      for (let run = 0; run < count; run++) for (const id of lists[run]) if (id >= 0) ids.push(id);
      closeOver(ids, push, full);
    },
  };
}

/** A tier as the residency ensurer reads it: its pages, the keys it names — true when its last
 *  report names the key, a page it still wants —, and a revision each report advances. */
export type LowerList = {
  pages: readonly PageRec[];
  has: (key: number) => boolean;
  revision: number;
};

/**
 * One job's lower tiers in order, each page once: a page an earlier tier names — a caster also
 * ahead of the camera — is counted and loaded once. A copy: a tier's list is rewritten in place by
 * every report taken while a job loads, and a loop resumed on another list keeps neither its order
 * nor its count of free slots. One list, made anew only when a tier reported since: the jobs that
 * follow one another between two reports read it as it is, and a job still walking the one before
 * — a capture's `ensureResident` runs beside the queue — keeps it whole.
 */
export function createLowerMerge(keyOf: (page: PageRec) => number) {
  let list: PageRec[] = [];
  let seen: (readonly [LowerList, number])[] = [];
  const current = (tiers: readonly LowerList[]) =>
    seen.length === tiers.length &&
    tiers.every((tier, t) => seen[t][0] === tier && seen[t][1] === tier.revision);
  return (tiers: readonly LowerList[]): readonly PageRec[] => {
    if (current(tiers)) return list;
    seen = tiers.map((tier) => [tier, tier.revision] as const);
    list = [];
    for (let t = 0; t < tiers.length; t++)
      for (const rec of tiers[t].pages) {
        const key = keyOf(rec);
        let named = false;
        for (let earlier = 0; earlier < t && !named; earlier++) named = tiers[earlier].has(key);
        if (!named) list.push(rec);
      }
    return list;
  };
}
