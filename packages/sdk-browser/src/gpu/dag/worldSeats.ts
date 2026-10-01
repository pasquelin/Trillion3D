/**
 * THE OBJECTS SEATED ON THE WORLD DAG: EACH PLACED OBJECT'S ROOTS LINKED TO THEIR WORLD RANKS, AND
 * THE RESIDENCY THEY THEN READ (#1333).
 *
 * A placed object's own roots take their world rank's parent (`worldLinks.ts`). Its readiness too,
 * as cluster's one DAG has it: a root reads resident while it is and its world rank is ready — its
 * world group's members all drawable, so its super-root no longer stands for it — or while the world
 * above it is absent (the pinned top not held: nothing there stands for anything). A root whose
 * world rank is not ready reads absent: the super-root that stands for its group draws, and the
 * closure of the root's own readiness (`page/cut/readiness.ts`) holds back every finer cluster of
 * the object with it. The rows' own residency is kept apart (`raw`): a world rank is resident while
 * its object's root cover is (`worldMirror.ts`), whatever it then reads.
 */
import type { PackedDag } from './types.ts';
import { createWorldLinks } from './worldLinks.ts';

/** The ranks of a world DAG grouped by `keys` (one per rank, -1 for none): each key's ranks are
 *  `ranks[first[k]]` to `ranks[first[k + 1]]`, built once in two passes. */
export function rankIndex(keys: ArrayLike<number>) {
  let count = 0;
  for (let rank = 0; rank < keys.length; rank++) count = Math.max(count, keys[rank] + 1);
  const first = new Uint32Array(count + 1),
    ranks = new Uint32Array(keys.length);
  for (let rank = 0; rank < keys.length; rank++) if (keys[rank] >= 0) first[keys[rank] + 1]++;
  for (let k = 0; k < count; k++) first[k + 1] += first[k];
  const filled = first.slice(0, count);
  for (let rank = 0; rank < keys.length; rank++)
    if (keys[rank] >= 0) ranks[filled[keys[rank]]++] = rank;
  return { count, first, ranks };
}

/** The seats of `packed`'s placements on its world DAG, from page `worldBase` on; `ready(page)`,
 *  the cut rule's readiness of a world page as the cut's residency settled it. */
export function createWorldSeats(
  packed: PackedDag,
  worldBase: number,
  ready: (page: number) => boolean,
) {
  const links = createWorldLinks(packed, worldBase);
  /** The rows' residency of each scene page, before any world rank masks it. */
  const raw = new Uint8Array(worldBase);
  /** Each linked root page's world rank and back, each linked placement's root pages. */
  const rankOf = new Map<number, number>(),
    pageOf = new Map<number, number>(),
    linkedOf = new Map<number, number[]>();
  /** The placements whose link words moved since the last `takeMoved`. */
  const moved = new Set<number>();
  /** Whether the world's pinned top is held: without it, no world rank stands for anything. */
  let present = false;
  /** Whether each placement's root cover is resident, read once per hand-over. */
  const covers = new Map<number, boolean>();
  const readCover = (w: number) => {
    const { structure, pageBase: base, pageCount: count } = packed.cutLinks[w];
    if (structure) return structure.roots.every((root) => raw[base + root] !== 0);
    for (let page = base; page < base + count; page++) if (!raw[page]) return false;
    return true;
  };
  const unseat = (w: number) => {
    const pages = linkedOf.get(w);
    if (!pages) return [];
    links.unlink(w);
    moved.add(w);
    linkedOf.delete(w);
    for (const page of pages) {
      pageOf.delete(rankOf.get(page)!);
      rankOf.delete(page);
    }
    return pages;
  };
  return {
    raw,
    covers,
    /** Whether every root of placement `w`'s cover is resident in the rows: a primitive without
     *  its group structure is all roots. */
    coverResident(w: number) {
      let resident = covers.get(w);
      if (resident === undefined) covers.set(w, (resident = readCover(w)));
      return resident;
    },
    /** The residency scene page `page` reads: its own, masked by its world rank's readiness. */
    value(page: number) {
      const rank = rankOf.get(page);
      return raw[page] && (rank === undefined || !present || ready(worldBase + rank)) ? 1 : 0;
    },
    /** Placement `w` draws the object of world ranks `ranks`, posed by `world`: the root pages
     *  whose residency may read otherwise now. */
    seat(w: number, ranks: ArrayLike<number>, world: ArrayLike<number>) {
      const left = unseat(w),
        linked = links.link(w, ranks, world);
      if (!linked) return left;
      moved.add(w);
      const { pageBase, structure } = packed.cutLinks[w],
        pages: number[] = [];
      linked.forEach((rank, k) => {
        if (rank < 0) return;
        const page = pageBase + structure!.roots[k];
        rankOf.set(page, rank);
        pageOf.set(rank, page);
        pages.push(page);
      });
      linkedOf.set(w, pages);
      return [...left, ...pages];
    },
    /** Placement `w` draws no object any more: its root pages, which read their own again. */
    unseat,
    /** The root page linked to world rank `rank`, if any. */
    pageOf: (rank: number) => pageOf.get(rank),
    /** The world's pinned top held or not: the root pages whose residency may read otherwise. */
    present(held: boolean) {
      if (present === held) return [];
      present = held;
      return [...rankOf.keys()];
    },
    /** The placements whose link words moved since the last call. */
    takeMoved() {
      const list = [...moved];
      moved.clear();
      return list;
    },
    links,
    get hostBytes() {
      return raw.byteLength;
    },
  };
}
