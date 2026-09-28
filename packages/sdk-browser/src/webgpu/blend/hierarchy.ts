import { BOX_VALUES, boxEmpty, boxUnion } from '../../../../sdk-core/src/index.ts';
import type { BlendGpuItem, createWebgpuBlendState } from './state.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/**
 * BOX TREE OF THE TRANSPARENT ITEMS, which the frustum verdict walks node by node
 * (`hierarchyCull.ts`, #981).
 *
 * The engine has no scene-item tree to borrow — the cluster DAG is per geometry and compiled —,
 * so this one is minimal: a binary tree split at the median centre, leaves of a few items, laid
 * out in pre-order with a skip link, so the walk is a loop, not a recursion. It is BUILT when the
 * item list changes and REFIT when boxes move (`refitBlendHierarchy`), never per frame.
 *
 * INVARIANT: the kept set, the mask, the reject and water counts are exactly those of the item by
 * item walk. A node is rejected only when `frustumExcludesBox` rejects its box, and then it rejects
 * every box inside it, bit for bit: the chosen corner of a child is never beyond its parent's
 * (`Math.min`/`Math.max` unions), a product and a rounded sum are monotonic, and a NaN never
 * rejects. The one hole — a zero plane coefficient times an infinite bound, NaN in the child but
 * not in the parent — is closed by giving a leaf node holding an item with a non-finite bound, or
 * without a box, a NaN box: NaN climbs every union above it, those nodes never reject, and their
 * items are judged one by one. An item the tree does not hold (no box at build) is judged alone
 * every frame. The tree is only as current as its last refit: every box write
 * (`refreshBlendWorlds`) is followed by one (`render.ts`).
 */
const LEAF_ITEMS = 8;

export function createBlendHierarchy() {
  return {
    /** The mask and item count the tree was built for: `buildBlendStatics` gives every new item
     *  list a new mask, so either one differing rebuilds. */
    builtFor: undefined as Uint32Array | undefined,
    count: -1,
    /** Ranks of the boxed items in tree order: a node covers a contiguous span of them. */
    leaves: new Uint32Array(0),
    /** Ranks of the items without a box at build: never rejected by a node. */
    loose: new Uint32Array(0),
    nodes: 0,
    first: new Uint32Array(0),
    end: new Uint32Array(0),
    /** Node after this one's subtree; `n + 1` marks a leaf node. */
    skip: new Uint32Array(0),
    boxes: new Float64Array(0),
    /** The frame's mask, composed here then copied word by word where it changed. */
    mask: new Uint32Array(0),
    /** Boxes tested last frame, nodes and items: what a rejected node spares shows here. */
    tested: 0,
  };
}
export type BlendHierarchy = ReturnType<typeof createBlendHierarchy>;

/** Splits `leaves[from, to)` at the median centre on its widest axis, pre-order from `node`. */
function split(tree: BlendHierarchy, centres: Float64Array, from: number, to: number) {
  const node = tree.nodes++;
  tree.first[node] = from;
  tree.end[node] = to;
  if (to - from > LEAF_ITEMS) {
    const span = tree.leaves.subarray(from, to);
    let axis = 0,
      widest = -1;
    for (let a = 0; a < 3; a++) {
      let lo = Infinity,
        hi = -Infinity;
      for (const rank of span) {
        lo = Math.min(lo, centres[rank * 3 + a]);
        hi = Math.max(hi, centres[rank * 3 + a]);
      }
      if (hi - lo > widest) {
        axis = a;
        widest = hi - lo;
      }
    }
    // A NaN centre compares as equal: the tree gets looser, never wrong.
    span.sort((p, q) => centres[p * 3 + axis] - centres[q * 3 + axis] || p - q);
    const mid = (from + to) >>> 1;
    split(tree, centres, from, mid);
    split(tree, centres, mid, to);
  }
  tree.skip[node] = tree.nodes;
}

/** Builds the tree over `items` as they stand, then fits its boxes. */
function buildBlendHierarchy(tree: BlendHierarchy, items: readonly BlendGpuItem[]) {
  const boxed: number[] = [],
    loose: number[] = [];
  for (let i = 0; i < items.length; i++) (items[i].bounds ? boxed : loose).push(i);
  const centres = new Float64Array(items.length * 3);
  for (const rank of boxed)
    for (let a = 0; a < 3; a++) {
      const box = items[rank].bounds!;
      centres[rank * 3 + a] = (box[a] + box[a + 3]) / 2;
    }
  // Halves of a span past `LEAF_ITEMS` hold at least half of it: a leaf holds four items or more.
  const capacity = 2 * Math.max(1, Math.ceil(boxed.length / (LEAF_ITEMS / 2)));
  tree.leaves = Uint32Array.from(boxed);
  tree.loose = Uint32Array.from(loose);
  tree.first = new Uint32Array(capacity);
  tree.end = new Uint32Array(capacity);
  tree.skip = new Uint32Array(capacity);
  tree.boxes = new Float64Array(capacity * BOX_VALUES);
  tree.mask = new Uint32Array((items.length + 31) >>> 5);
  tree.nodes = 0;
  if (boxed.length) split(tree, centres, 0, boxed.length);
  tree.count = items.length;
  refitNodes(tree, items);
}

/** Widens the box at `o` by node `child`'s box. */
function unionNode(boxes: Float64Array, o: number, child: number) {
  const c = child * BOX_VALUES;
  boxUnion(
    boxes,
    o,
    boxes[c],
    boxes[c + 1],
    boxes[c + 2],
    boxes[c + 3],
    boxes[c + 4],
    boxes[c + 5],
  );
}

/** Fits every node box to its items' boxes, children first: pre-order read backwards. */
function refitNodes(tree: BlendHierarchy, items: readonly BlendGpuItem[]) {
  const { boxes, first, end, skip, leaves } = tree;
  for (let node = tree.nodes - 1; node >= 0; node--) {
    const o = node * BOX_VALUES;
    boxEmpty(boxes, o);
    if (skip[node] !== node + 1) {
      unionNode(boxes, o, node + 1);
      unionNode(boxes, o, skip[node + 1]);
      continue;
    }
    // Each item's own bounds are checked: a union would hide an infinite one behind a finite one.
    let finite = true;
    for (let k = first[node]; k < end[node] && finite; k++) {
      const box = items[leaves[k]].bounds;
      finite = !!box;
      for (let v = 0; v < BOX_VALUES && finite; v++) finite = Number.isFinite(box![v]);
      if (finite) boxUnion(boxes, o, box![0], box![1], box![2], box![3], box![4], box![5]);
    }
    if (!finite) boxes.fill(NaN, o, o + BOX_VALUES);
  }
}

/** True when the tree was built for the scene's current item list. */
const builtForList = (blendState: BlendState) =>
  blendState.hierarchy.builtFor === blendState.keepPacked &&
  blendState.hierarchy.count === blendState.blendGpu.length;

/**
 * Refits the tree to boxes that moved: called where they are refreshed (`refreshBlendWorlds`'s
 * caller). A tree not yet built for this list is left for the next frame to build.
 */
export function refitBlendHierarchy(blendState: BlendState) {
  if (builtForList(blendState)) refitNodes(blendState.hierarchy, blendState.blendGpu);
}

/** The tree of the scene's current item list, built first when the list changed. */
export function currentBlendHierarchy(blendState: BlendState) {
  const tree = blendState.hierarchy;
  if (!builtForList(blendState)) {
    buildBlendHierarchy(tree, blendState.blendGpu);
    tree.builtFor = blendState.keepPacked;
  }
  return tree;
}
