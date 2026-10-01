import type { ClusterRoot } from '../selection/types.ts';
import type { PlacementIndex } from '../selection/placements.ts';
import { createCutReadiness, type CutReadiness } from './readiness.ts';
import { linksFor } from './links.ts';
import { createSparseInts } from './sparseInts.ts';
import type { PageRecord } from './state.ts';

type Root = ClusterRoot<PageRecord>;
/** A primitive: the `pages` its placements share (#1235), the key of its readiness. */
type Primitive = Root['pages'];
type Held = {
  readiness: CutReadiness;
  /** The pages the feed named since the last read (`moved`), by rank in the primitive. */
  moved: ReturnType<typeof createSparseInts>;
  structure: Root['structure'];
  nodes: Float64Array | undefined;
  pages: number;
  /** False when the feed cannot name its moves, its placement holding no packed base: such a
   *  primitive is read whole at every visit, and `unroutedReads` counts it. */
  routed: boolean;
  /** What the running total counts of it. */
  bytes: number;
  /** The image that last visited it. */
  seen: number;
};

export type HeldResidency = ReturnType<typeof createHeldResidency>;

/** What the read walks between two reads: nothing. */
const NO_RECORDS: readonly PageRecord[] = [],
  NO_READINESS = createCutReadiness(undefined, undefined);

/** The packed rank of `pages[0]`, from the layout's table, by the rank `track` gave the root: -1
 *  when the placement could not name it, so the root is then read whole. */
function baseOf(
  rankOfRoot: ReadonlyMap<Root, number>,
  root: Root,
  placement: PlacementIndex | undefined,
) {
  const rank = rankOfRoot.get(root);
  return rank === undefined || !placement ? -1 : (placement.baseOfRoot[rank] ?? -1);
}

/**
 * THE RESIDENCY A POOL'S CUTS HOLD: the cut rule's readiness of each primitive they visit
 * (`./readiness.ts`), kept from one cut to the next and moved by the pool's own residency feed
 * (#483 rule 7). A page is resident when `isResident` says so, or, without one, when it holds its
 * index array. `moved` names a record whose residency may have changed, and the next cut visiting
 * a placement of its primitive reads that page alone: a cut over primitives in which nothing moved
 * reads no page.
 *
 * Residency belongs to the record, which every placement of a primitive shares (#1235): so does
 * the readiness, one state per primitive however many of its placements the view holds, as
 * cluster's streaming state is its resource's and never an instance's (#1232). A primitive is read
 * whole when it enters — first seen, or its DAG or hierarchy changed. A move is routed by the
 * packed base both layouts post on each root (`postPackedBases`, #1235), against the placements
 * `track` last named; a layout that changes calls `track` again, and the primitives that stay keep
 * their state. A primitive entered by a placement whose moves cannot be routed is read whole at
 * every visit, and counted.
 *
 * Bounded by the view (#483 rule 6): each image ends (`endImage`: its cut, or a GPU cut's image)
 * by releasing the states no cut visited since the previous one, so the states held are those of
 * the primitives the image and its lights see. `bytes` is their running total, read without walking.
 */
export function createHeldResidency<T extends PageRecord>(
  rule: { isResident?: (page: T) => boolean } = {},
  placement?: PlacementIndex,
) {
  const isResident = rule.isResident as ((page: PageRecord) => boolean) | undefined;
  const states = new Map<Primitive, Held>();
  let routes: readonly Root[] = [],
    rankOfRoot = new Map<Root, number>(),
    bytes = 0,
    image = 1,
    unroutedReads = 0;
  const weigh = (held: Held) => {
    const now = held.readiness.hostBytes + held.moved.byteLength;
    bytes += now - held.bytes;
    held.bytes = now;
  };
  const release = (pages: Primitive, held: Held) => {
    bytes -= held.bytes;
    states.delete(pages);
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
      routed: baseOf(rankOfRoot, root, placement) >= 0,
      bytes: 0,
      seen: 0,
    };
    states.set(root.pages, held);
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
    /** How many primitives hold a state: one each, whatever the placements of it in view. */
    get primitives() {
      return states.size;
    },
    /** Visits read whole because the layout did not let the feed name their moves. */
    get unroutedReads() {
      return unroutedReads;
    },
    /** Routes the moves of `roots`' records from now on: the placements that left let go. */
    track(roots: readonly Root[]) {
      routes = roots.slice();
      rankOfRoot = new Map(routes.map((root, rank) => [root, rank]));
      // The pending moves are ranks within their primitive: they survive a new layout. A state no
      // move reached, read whole at each visit so far, or no placement of it left, lets go.
      const kept = new Set(routes.map((root) => root.pages));
      for (const [pages, held] of states)
        if (!held.routed || !kept.has(pages)) release(pages, held);
    },
    /** The pool names the packed rank of a record whose residency may have moved. */
    moved(packed: number, rec: PageRecord) {
      if (!placement) return;
      const rank = placement.rootOfPacked[packed],
        root = routes[rank],
        held = root && states.get(root.pages);
      if (!held || !held.routed) return;
      const page = packed - placement.baseOfRoot[rank];
      if (root.pages[page] === rec && held.moved.set(page, 1) === 0) weigh(held);
    },
    /** The readiness of `root`'s primitive, up to date with every move the feed named. */
    readiness(root: Root) {
      let held = states.get(root.pages);
      // A placement whose DAG or hierarchy changed enters again.
      if (
        held &&
        (held.structure !== root.structure ||
          held.nodes !== root.culling?.nodes ||
          held.pages !== root.pages.length)
      ) {
        release(root.pages, held);
        held = undefined;
      }
      const whole = !held || !held.routed;
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
    /** Ends an image's cut: lets go of every state no cut visited since the previous image's. */
    endImage() {
      for (const [pages, held] of states) if (held.seen !== image) release(pages, held);
      image++;
    },
  };
}
