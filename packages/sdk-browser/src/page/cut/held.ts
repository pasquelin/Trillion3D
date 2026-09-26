import type { ClusterRoot } from '../selection/types.ts';
import { createCutReadiness, type CutReadiness } from './readiness.ts';
import { linksFor } from './links.ts';
import { createSparseInts } from './sparseInts.ts';
import { residentUnder, type PageRecord, type SelectionState } from './state.ts';

/** Where a record sits among the placements: what both layouts post on it, once. */
type Placed = { placementIndex?: number; packedIndex?: number };

type Held = {
  readiness: CutReadiness;
  /** The pages the feed named since the last read (`moved`). */
  moved: ReturnType<typeof createSparseInts>;
  structure: ClusterRoot<unknown>['structure'];
  nodes: Float64Array | undefined;
  pages: number;
  /** The packed rank of its first page, or -1 when the feed cannot name its moves: such a
   *  placement is read whole at every visit. */
  base: number;
  /** What the running total counts of it. */
  bytes: number;
  /** The image that last visited it. */
  seen: number;
};

export type HeldResidency = ReturnType<typeof createHeldResidency>;

/** What a feed reads between two cuts: nothing. */
const NO_RECORDS: readonly PageRecord[] = [];

/**
 * The cut rule's residency of the placements a pool's cuts visit (`./readiness.ts`), kept from one
 * cut to the next and moved by the pool's own residency feed (#483 rule 7): `moved` names a record
 * whose residency may have changed, and the next cut visiting its placement reads that page alone,
 * with the cut's residency rule. A cut over placements in which nothing moved reads no page.
 *
 * A placement is read whole when it enters — first seen, or its DAG or hierarchy changed — and at
 * every visit when no move of it can be routed: `track` names the placements, and a record is
 * routed by the `placementIndex` and contiguous `packedIndex` both layouts post on it. A layout
 * that changes calls `track` again, and every placement enters again.
 *
 * Bounded by the view (#483 rule 6): the cut of an image — a cut that is not a light's — releases
 * the states no cut visited since the previous image's, so the states held are those of the
 * placements the image and its lights see. `bytes` is their running total, read without walking.
 *
 * One feed, one residency rule: every cut given it answers residency alike. `follow`, when given,
 * runs before each cut reads: the pool hands over there what moved since.
 */
export function createHeldResidency(follow?: () => void) {
  const states = new Map<object, Held>();
  let routes: readonly ClusterRoot<Placed>[] = [],
    bytes = 0,
    image = 1,
    /** States the current image visited. */
    visited = 0;
  const weigh = (held: Held) => {
    const now = held.readiness.hostBytes + held.moved.byteLength;
    bytes += now - held.bytes;
    held.bytes = now;
  };
  const release = (root: object, held: Held) => {
    bytes -= held.bytes;
    if (held.seen === image) visited--;
    states.delete(root);
  };
  /** The packed rank of `root`'s first page when every move of it can be routed, -1 otherwise. */
  const baseOf = (root: ClusterRoot<Placed>) => {
    const pages = root.pages,
      at = pages[0]?.placementIndex ?? -1,
      base = pages[0]?.packedIndex ?? -1,
      last = pages[pages.length - 1];
    const laidOut = routes[at] === root && last?.placementIndex === at;
    return laidOut && base >= 0 && last.packedIndex === base + pages.length - 1 ? base : -1;
  };
  // What one read walks, set for its duration: the walk allocates nothing.
  let cut = undefined as SelectionState<PageRecord> | undefined,
    records: readonly PageRecord[] = NO_RECORDS,
    target = undefined as CutReadiness | undefined;
  const read = (page: number) =>
    void target!.set(page, residentUnder(cut!, records[page], cut!.residentMode));
  return {
    /** Bytes of every state held, read in constant time. */
    get bytes() {
      return bytes;
    },
    /** How many placements hold a state. */
    get placements() {
      return states.size;
    },
    /** Routes the moves of `roots`' records from now on: every state held is let go. */
    track(roots: readonly ClusterRoot<Placed>[]) {
      routes = roots;
      states.clear();
      bytes = visited = 0;
    },
    /** The pool names a record whose residency may have moved. */
    moved(rec: Placed) {
      const root = routes[rec.placementIndex ?? -1],
        held = root && states.get(root);
      if (!held || held.base < 0) return;
      const page = (rec.packedIndex ?? -1) - held.base;
      if (root.pages[page] !== rec) return;
      held.moved.set(page, 1);
      weigh(held);
    },
    /** Before a cut reads: the pool hands over what moved. */
    follow: () => follow?.(),
    /** The readiness of `root` for cut `s`, up to date with every move the feed named. */
    readiness<T extends PageRecord>(s: SelectionState<T>, root: ClusterRoot<T>) {
      const culling = root.culling,
        count = root.pages.length;
      let held = states.get(root);
      // A placement whose DAG or hierarchy changed enters again.
      const changed =
        held &&
        (held.structure !== root.structure ||
          held.nodes !== culling?.nodes ||
          held.pages !== count);
      if (changed) release(root, held!);
      const entering = !held || changed;
      if (entering) {
        held = {
          readiness: createCutReadiness(root.structure, culling && linksFor(culling, count)),
          moved: createSparseInts(),
          structure: root.structure,
          nodes: culling?.nodes,
          pages: count,
          base: baseOf(root as unknown as ClusterRoot<Placed>),
          bytes: 0,
          seen: 0,
        };
        states.set(root, held);
      }
      const state = held!;
      if (state.seen !== image) ((state.seen = image), visited++);
      const whole = entering || state.base < 0;
      if (!whole && !state.moved.size) return state.readiness;
      cut = s as unknown as SelectionState<PageRecord>;
      records = root.pages;
      target = state.readiness;
      if (whole) for (let page = 0; page < count; page++) read(page);
      else state.moved.forEach(read);
      cut = target = undefined;
      records = NO_RECORDS;
      state.moved.clear();
      state.readiness.settle();
      weigh(state);
      return state.readiness;
    },
    /** Ends a cut: an image's lets go of every state no cut visited since the previous image's. */
    end(imageCut: boolean) {
      if (!imageCut) return;
      if (visited < states.size)
        for (const [root, held] of states) if (held.seen !== image) release(root, held);
      image++;
      visited = 0;
    },
  };
}
