import type { ClusterRoot } from '../selection/types.ts';
import { createCutReadiness, type CutReadiness } from './readiness.ts';
import { linksFor } from './links.ts';
import { createSparseInts } from './sparseInts.ts';
import type { PageRecord } from './state.ts';

type Root = ClusterRoot<PageRecord>;
type Held = {
  readiness: CutReadiness;
  /** The pages the feed named since the last read (`moved`), by rank in the placement. */
  moved: ReturnType<typeof createSparseInts>;
  structure: Root['structure'];
  nodes: Float64Array | undefined;
  pages: number;
  /** The packed rank of its first page, or -1 when the feed cannot name its moves: such a
   *  placement is read whole at every visit, and `unroutedReads` counts it. */
  base: number;
  /** What the running total counts of it. */
  bytes: number;
  /** The image that last visited it. */
  seen: number;
};

export type HeldResidency = ReturnType<typeof createHeldResidency>;

/** What the read walks between two reads: nothing. */
const NO_RECORDS: readonly PageRecord[] = [],
  NO_READINESS = createCutReadiness(undefined, undefined);

/** The packed rank of `pages[0]` when `pages` lie contiguously at placement `at`, -1 otherwise. */
function baseOf(routes: readonly Root[], root: Root) {
  const { pages } = root,
    first = pages[0],
    last = pages[pages.length - 1],
    at = first?.placementIndex ?? -1,
    base = first?.packedIndex ?? -1;
  const laidOut = routes[at] === root && last.placementIndex === at;
  return laidOut && base >= 0 && last.packedIndex === base + pages.length - 1 ? base : -1;
}

/**
 * THE RESIDENCY A POOL'S CUTS HOLD: the cut rule's readiness of each placement they visit
 * (`./readiness.ts`), kept from one cut to the next and moved by the pool's own residency feed
 * (#483 rule 7). A page is resident when `isResident` says so, or, without one, when it holds its
 * index array. `moved` names a record whose residency may have changed, and the next cut visiting
 * its placement reads that page alone: a cut over placements in which nothing moved reads no page.
 *
 * A placement is read whole when it enters — first seen, or its DAG or hierarchy changed. A move
 * is routed by the `placementIndex` and contiguous `packedIndex` both layouts post on a record,
 * against the placements `track` last named; a layout that changes calls `track` again, and the
 * placements that stay keep their state. A placement whose moves cannot be routed is read whole
 * at every visit, and counted.
 *
 * Bounded by the view (#483 rule 6): the cut of an image — a cut that is not a light's — releases
 * the states no cut visited since the previous image's, so the states held are those of the
 * placements the image and its lights see. `bytes` is their running total, read without walking.
 */
export function createHeldResidency<T extends PageRecord>(
  rule: { isResident?: (page: T) => boolean } = {},
) {
  const isResident = rule.isResident as ((page: PageRecord) => boolean) | undefined;
  const states = new Map<Root, Held>();
  let routes: readonly Root[] = [],
    bytes = 0,
    image = 1,
    unroutedReads = 0;
  const weigh = (held: Held) => {
    const now = held.readiness.hostBytes + held.moved.byteLength;
    bytes += now - held.bytes;
    held.bytes = now;
  };
  const release = (root: Root, held: Held) => {
    bytes -= held.bytes;
    states.delete(root);
  };
  const enter = (root: Root): Held => {
    const { culling } = root,
      count = root.pages.length;
    const held = {
      readiness: createCutReadiness(root.structure, culling && linksFor(culling, count)),
      moved: createSparseInts(),
      structure: root.structure,
      nodes: culling?.nodes,
      pages: count,
      base: baseOf(routes, root),
      bytes: 0,
      seen: 0,
    };
    states.set(root, held);
    return held;
  };
  // What one read walks, set for its duration: the walk allocates nothing.
  let records = NO_RECORDS,
    target = NO_READINESS;
  const read = (page: number) => {
    const rec = records[page];
    target.set(page, isResident ? isResident(rec) : !!rec.array);
  };
  return {
    /** Bytes of every state held, read in constant time. */
    get bytes() {
      return bytes;
    },
    /** How many placements hold a state. */
    get placements() {
      return states.size;
    },
    /** Visits read whole because the layout did not let the feed name their moves. */
    get unroutedReads() {
      return unroutedReads;
    },
    /** Routes the moves of `roots`' records from now on: the placements that left let go. */
    track(roots: readonly Root[]) {
      routes = roots.slice();
      const kept = new Set(routes);
      // The pending moves are ranks within their placement: they survive a new layout. A state
      // no move reached, read whole at each visit so far, is read whole once more.
      for (const [root, held] of states) {
        const base = kept.has(root) ? baseOf(routes, root) : -1;
        if (base < 0 || held.base < 0) release(root, held);
        else held.base = base;
      }
    },
    /** The pool names a record whose residency may have moved. */
    moved(rec: PageRecord) {
      const root = routes[rec.placementIndex ?? -1],
        held = root && states.get(root);
      if (!held || held.base < 0) return;
      const page = (rec.packedIndex ?? -1) - held.base;
      if (root.pages[page] === rec && held.moved.set(page, 1) === 0) weigh(held);
    },
    /** The readiness of `root`, up to date with every move the feed named. */
    readiness(root: Root) {
      let held = states.get(root);
      // A placement whose DAG or hierarchy changed enters again.
      if (
        held &&
        (held.structure !== root.structure ||
          held.nodes !== root.culling?.nodes ||
          held.pages !== root.pages.length)
      ) {
        release(root, held);
        held = undefined;
      }
      const whole = !held || held.base < 0;
      if (held && whole) unroutedReads++;
      held ??= enter(root);
      held.seen = image;
      if (!whole && !held.moved.size) return held.readiness;
      records = root.pages;
      target = held.readiness;
      if (whole) for (let page = 0; page < records.length; page++) read(page);
      else held.moved.forEach(read);
      records = NO_RECORDS;
      target = NO_READINESS;
      held.moved.clear();
      held.readiness.settle();
      weigh(held);
      return held.readiness;
    },
    /** Ends a cut: an image's lets go of every state no cut visited since the previous image's. */
    end(imageCut: boolean) {
      if (!imageCut) return;
      for (const [root, held] of states) if (held.seen !== image) release(root, held);
      image++;
    },
  };
}
