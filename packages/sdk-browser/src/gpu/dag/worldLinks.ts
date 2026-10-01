/**
 * ONE DAG ACROSS THE WORLD AND ITS OBJECTS: EACH OBJECT ROOT LINKED TO ITS WORLD RANK (#1333).
 *
 * The world DAG (`scene/worldSuperRoots.ts`) continues every placed object's roots into its cell's
 * super-roots, so, as in Nanite's one hierarchy, an object's own root cluster has a parent: the
 * world group that takes its world rank. Its link carries that group's error and sphere, brought
 * into the placement's own frame (so the kernel projects it with the placement's matrix, as any
 * parent), and the world rank whose readiness says whether that parent stands: a cluster then draws
 * when its own error meets the threshold and its parent's does not, across the two DAGs, and the
 * cut draws either a cell's super-root or its objects' roots, never both and never neither.
 *
 * The layout: each hot record of a root cluster names its rank among its primitive's roots
 * (`HOT_ROOT`), the link column one word per placement (`linkBase`), and behind the cold records
 * `LINK_WORDS` per root of each placement — the parent sphere, its error, then the linked world
 * page (`SELECTION_NONE` while unlinked). Written at pack, rewritten when a row seats an object.
 */
import { invertMatrix4, maxStretch } from '../../../../sdk-core/src/index.ts';
import { SELECTION_NONE as NONE } from '../core/selection.ts';
import {
  CLUSTER_WORDS,
  HOT_PARENT_ERROR,
  HOT_PARENT_SPHERE,
  HOT_SPHERE,
  linkBase,
} from './layout.ts';
import type { DagRoot, PackedDag } from './types.ts';

export const LINK_WORDS = 6,
  LINK_ERROR = 4,
  LINK_PAGE = 5;

/** Each page's rank among `structure.roots`, -1 for any other page, once per structure. */
export function rootRanksOf() {
  const known = new Map<DagRoot['structure'], Int32Array>();
  return ({ structure, pages }: DagRoot) => {
    let ranks = known.get(structure);
    if (!ranks) {
      known.set(structure, (ranks = new Int32Array(pages.length).fill(-1)));
      structure?.roots.forEach((page, rank) => (ranks![page] = rank));
    }
    return ranks;
  };
}

/** The roots of placement `w` linked to the world DAG, root `world` (-1 for none). */
const linkedRoots = (root: DagRoot, w: number, world: number) =>
  world >= 0 && w !== world ? (root.structure?.roots.length ?? 0) : 0;

/** The words the links of `roots` take, the world DAG being root `world`. */
export const worldLinkWords = (roots: readonly DagRoot[], world: number) =>
  roots.reduce((words, root, w) => words + linkedRoots(root, w, world) * LINK_WORDS, 0);

/** Lays the link column of `roots` into `ints`: each linked placement's links from word `at` on,
 *  in rank order, unlinked; `SELECTION_NONE` for a placement with none. */
export function layWorldLinks(
  roots: readonly DagRoot[],
  world: number,
  ints: Uint32Array,
  pageCount: number,
  at: number,
) {
  const column = linkBase(pageCount);
  ints[column] = NONE;
  roots.forEach((root, w) => {
    const count = linkedRoots(root, w, world);
    ints[column + w] = count ? at : NONE;
    for (let k = 0; k < count; k++, at += LINK_WORDS) ints[at + LINK_PAGE] = NONE;
  });
}

/** The world links of `packed`, whose world DAG starts at `worldBase`: what a seat writes. */
export function createWorldLinks(packed: PackedDag, worldBase: number) {
  const floats = packed.pageCones,
    ints = new Uint32Array(floats.buffer, floats.byteOffset, floats.length),
    hot = packed.clusters,
    column = linkBase(packed.pageCount);
  const record = (page: number) => ((page + packed.recordShift[ints[page]]) >>> 0) * CLUSTER_WORDS;
  const inverse = new Float64Array(16);
  /** The world point `m · p`, of the local center at `hot[at]`. */
  const transform = (m: ArrayLike<number>, at: number, out: number[]) => {
    for (let a = 0; a < 3; a++)
      out[a] = m[a] * hot[at] + m[4 + a] * hot[at + 1] + m[8 + a] * hot[at + 2] + m[12 + a];
  };
  const center = [0, 0, 0];
  /** The world rank among `ranks`, none of `taken`, whose sphere is nearest `center`. */
  const nearest = (ranks: ArrayLike<number>, taken: Set<number>) => {
    let best = -1,
      bestDistance = Infinity;
    for (let i = 0; i < ranks.length; i++) {
      const at = record(worldBase + ranks[i]) + HOT_SPHERE;
      const d = Math.hypot(hot[at] - center[0], hot[at + 1] - center[1], hot[at + 2] - center[2]);
      if (!taken.has(ranks[i]) && d < bestDistance) [best, bestDistance] = [ranks[i], d];
    }
    taken.add(best);
    return best;
  };
  /** Placement `w`'s roots unlinked: they read no world parent. */
  const unlink = (w: number) => {
    const base = ints[column + w],
      count = packed.cutLinks[w].structure?.roots.length ?? 0;
    if (base !== NONE)
      for (let k = 0; k < count; k++) ints[base + k * LINK_WORDS + LINK_PAGE] = NONE;
  };
  return {
    /** The first word of placement `w`'s links, `SELECTION_NONE` when it has none. */
    base: (w: number) => ints[column + w],
    /**
     * Links each root of placement `w`, posed by `world`, to the world rank among `ranks` (its
     * object's, one per root) its world sphere is nearest, its parent brought into the placement's
     * frame: the linked rank per root, -1 where none, or nothing when the placement takes no link.
     */
    link(w: number, ranks: ArrayLike<number>, world: ArrayLike<number>) {
      const base = ints[column + w],
        structure = packed.cutLinks[w].structure;
      // The cook ranks an object's roots one by one (`docs/FORMAT.md`, World super-roots): another
      // count is another object's, linked to none.
      unlink(w);
      if (base === NONE || !structure || structure.roots.length !== ranks.length) return undefined;
      invertMatrix4(inverse, world);
      const stretch = maxStretch(world),
        linked = new Int32Array(structure.roots.length).fill(-1),
        taken = new Set<number>();
      structure.roots.forEach((root, k) => {
        transform(world, record(packed.cutLinks[w].pageBase + root) + HOT_SPHERE, center);
        const rank = nearest(ranks, taken),
          at = base + k * LINK_WORDS,
          parent = rank < 0 ? -1 : record(worldBase + rank);
        // A world rank nothing groups is a world root: no parent, the root stays unlinked.
        if (parent < 0 || !(hot[parent + HOT_PARENT_ERROR] >= 0)) return;
        transform(inverse, parent + HOT_PARENT_SPHERE, center);
        floats.set(center, at);
        floats[at + 3] = hot[parent + HOT_PARENT_SPHERE + 3] / stretch;
        floats[at + LINK_ERROR] = hot[parent + HOT_PARENT_ERROR] / stretch;
        ints[at + LINK_PAGE] = worldBase + rank;
        linked[k] = rank;
      });
      return linked;
    },
    unlink,
    /** Placement `w`'s link words, from word `base(w)` on. */
    words: (w: number) => (packed.cutLinks[w].structure?.roots.length ?? 0) * LINK_WORDS,
  };
}
