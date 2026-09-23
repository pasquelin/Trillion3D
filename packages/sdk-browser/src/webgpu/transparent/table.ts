import type { PageRec } from '../../page/selection/selection.ts';
import type { ClusterRoot } from '../../page/selection/types.ts';
import type { BlendGpuItem } from '../blend/state.ts';

/** Entries one counting group of the compaction covers. Item ranges are aligned on it, so a group
 *  never spans two items and the per-item prefix is a walk over whole groups. */
export const TRANSPARENT_GROUP = 64;
/** Padding entry: an index no cluster has, never selected, never drawn. */
export const TRANSPARENT_NONE = 0xffffffff;

export type TransparentTable = ReturnType<typeof createTransparentTable>;

/** The draw rank of a transparent cluster: the rank its source recorded, the catalogue rank else. */
const drawRank = (rec: PageRec) => rec.sourceOrder ?? rec.id;

/**
 * The order the cluster cut visits a primitive's pages in, whatever it ends up keeping.
 *
 * Several clusters of one primitive share a source rank — a coarse cluster inherits the earliest
 * source triangle of the group it replaces — so the rank alone does not order them. What separated
 * them was the order the cut emitted them in, and that order is the culling walk's: a stack, so the
 * children of a node are visited last-pushed-first, and a leaf's pages in their own order. The walk
 * is a property of the tree, not of the camera, and the pages any image keeps are a subsequence of
 * it — which is exactly what a stable sort by rank needs to reproduce the draw order it had.
 */
function visitOrder(root: ClusterRoot<PageRec>) {
  const order = new Int32Array(root.pages.length).fill(root.pages.length);
  const culling = root.culling;
  if (!culling) {
    for (let i = 0; i < order.length; i++) order[i] = i;
    return order;
  }
  const { nodes, stride } = culling;
  const stack = [0];
  let rank = 0;
  while (stack.length) {
    const base = stack.pop()! * stride,
      children = nodes[base + 12];
    if (children > 0) {
      const first = nodes[base + 11];
      for (let child = 0; child < children; child++) stack.push(first + child);
      continue;
    }
    const firstPage = nodes[base + 13];
    for (let i = 0; i < nodes[base + 14]; i++) order[firstPage + i] = rank++;
  }
  return order;
}

/**
 * The static draw order of every transparent cluster, item by item.
 *
 * A transparent primitive draws its clusters in the order its source recorded — `sourceOrder`, the
 * rank the compiler wrote on each page — and that order is a property of the scene, not of the
 * image: the set selected changes every frame, the order it must be drawn in never does. So the
 * whole catalogue is sorted once here, and what an image adds is only *which* of those entries it
 * keeps. A compaction that preserves the order of its input therefore preserves the draw order
 * exactly, with no sort and no CPU list per image.
 *
 * Each item owns a range aligned on `TRANSPARENT_GROUP`, and its instance list is written in place
 * inside that range, so an item's base is known before the image starts and never moves.
 */
export function createTransparentTable(
  roots: ReadonlyArray<ClusterRoot<PageRec>>,
  packedPages: readonly PageRec[],
  items: readonly BlendGpuItem[],
) {
  /** Where each root's pages start in the catalogue, and how the cut walks them, by the world its
   *  pages read: a paged item and the root of its placement read the same one. */
  const rootOfPlacement = new Map<object, { base: number; root: ClusterRoot<PageRec> }>();
  let base = 0;
  for (const root of roots) {
    const first = root.pages[0];
    if (first?.transparent) rootOfPlacement.set(first.matrix, { base, root });
    base += root.pages.length;
  }
  const paged = items.filter((item) => item.paged);
  const orders: number[][] = [];
  let length = 0,
    maxVertexWords = 0;
  for (const item of paged) {
    const owner = rootOfPlacement.get(item.matrix);
    const order: number[] = [];
    if (owner) {
      const visited = visitOrder(owner.root);
      const local = owner.root.pages.map((_, index) => index);
      // Source rank first, the cut's own walk to separate the clusters that share one.
      local.sort(
        (a, b) =>
          drawRank(owner.root.pages[a]) - drawRank(owner.root.pages[b]) || visited[a] - visited[b],
      );
      for (const index of local) order.push(owner.base + index);
    }
    orders.push(order);
    length += Math.ceil(order.length / TRANSPARENT_GROUP) * TRANSPARENT_GROUP;
  }
  const capacity = Math.max(TRANSPARENT_GROUP, length);
  const entries = new Uint32Array(capacity).fill(TRANSPARENT_NONE);
  /** Words of the resident page, then the index words it holds: what one instance draws. */
  const spans = new Uint32Array(capacity * 2);
  const pageOfEntry = new Int32Array(capacity).fill(-1);
  const entryOfPage = new Int32Array(Math.max(1, packedPages.length)).fill(-1);
  const itemRanges = new Uint32Array(Math.max(1, paged.length) * 2);
  let at = 0;
  for (let item = 0; item < paged.length; item++) {
    const order = orders[item];
    itemRanges[item * 2] = at;
    itemRanges[item * 2 + 1] = order.length;
    for (let i = 0; i < order.length; i++) {
      const pageIndex = order[i],
        entry = at + i,
        words = packedPages[pageIndex].triangles * 3;
      entries[entry] = pageIndex;
      pageOfEntry[entry] = pageIndex;
      entryOfPage[pageIndex] = entry;
      if (words > maxVertexWords) maxVertexWords = words;
    }
    at += Math.ceil(order.length / TRANSPARENT_GROUP) * TRANSPARENT_GROUP;
  }
  return {
    entries,
    spans,
    pageOfEntry,
    entryOfPage,
    itemRanges,
    /** Items the table describes, in the order the transparent pass draws them. */
    pagedItems: paged,
    /** Entries in use, including alignment padding. */
    length,
    capacity,
    groupCount: Math.max(1, Math.ceil(capacity / TRANSPARENT_GROUP)),
    /** Vertices one instance draws: the longest index run any transparent cluster holds. */
    maxVertexWords,
  };
}
