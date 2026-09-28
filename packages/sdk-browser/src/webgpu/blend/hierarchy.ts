import {
  BOX_VALUES,
  boxEmpty,
  boxUnion,
  buildCentreTree,
  centreTreeNodes,
} from '../../../../sdk-core/src/index.ts';
import { refreshBlendWorlds } from './worlds.ts';
import type { createWebgpuBlendState } from './state.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/**
 * BOX TREE OF THE TRANSPARENT ITEMS, which the frustum verdict walks node by node
 * (`hierarchyCull.ts`, #981). Its shape is the engine's median split (`buildCentreTree`, the one
 * the collision triangle tree uses); its boxes are double precision, the items' own. It is BUILT
 * with each item list (`buildBlendStatics`) and REFIT where boxes are rewritten
 * (`refreshBlendBoxes`), never per frame.
 *
 * INVARIANT: the kept set, the mask, the reject and water counts are exactly those of the item by
 * item walk. A node is rejected only when `frustumExcludesBox` rejects its box, and then it rejects
 * every box inside it, bit for bit: the chosen corner of a child is never beyond its parent's
 * (`Math.min`/`Math.max` unions), a product and a rounded sum are monotonic, and a NaN never
 * rejects. The one hole — a zero plane coefficient times an infinite bound, NaN in the child but
 * not in the parent — is closed by giving a leaf holding an item with a non-finite bound, or
 * without a box, a NaN box: NaN climbs every union above it, those nodes never reject, and their
 * items are judged one by one. An item the tree does not hold (no box at build) is judged alone
 * every frame.
 */
const LEAF_ITEMS = 8;

export function createBlendHierarchy() {
  return {
    /** Items the tree was built for: another count is another list, built again. */
    count: -1,
    /** Ranks of the boxed items in tree order: a node covers a contiguous span of them. */
    leaves: new Uint32Array(0),
    /** Ranks of the items without a box at build: never rejected by a node. */
    loose: new Uint32Array(0),
    nodes: 0,
    /** Per node, its span's first entry in `leaves`; one more slot ends the last span. */
    first: new Uint32Array(0),
    /** Per node, the right child of an inner node (the left follows it) and a leaf's entry count,
     *  zero for an inner node (`buildCentreTree`). */
    links: new Int32Array(0),
    counts: new Int32Array(0),
    /** Node after this one's subtree: the walk passes a whole subtree in one step. */
    skip: new Uint32Array(0),
    boxes: new Float64Array(0),
    /** The frame's mask, composed here then copied word by word where it changed. */
    mask: new Uint32Array(0),
    /** Boxes tested last frame, nodes and items: what a rejected node spares shows here. */
    tested: 0,
  };
}

/** Builds the tree over the scene's items as they stand, then fits its boxes. */
export function buildBlendHierarchy(blendState: BlendState) {
  const tree = blendState.hierarchy,
    items = blendState.blendGpu;
  const boxed: number[] = [],
    loose: number[] = [];
  for (let i = 0; i < items.length; i++) (items[i].bounds ? boxed : loose).push(i);
  const centres = new Float64Array(items.length * 3);
  for (const rank of boxed)
    for (let a = 0; a < 3; a++) {
      const box = items[rank].bounds!;
      centres[rank * 3 + a] = (box[a] + box[a + 3]) / 2;
    }
  const capacity = centreTreeNodes(boxed.length, LEAF_ITEMS);
  tree.leaves = Uint32Array.from(boxed);
  tree.loose = Uint32Array.from(loose);
  tree.first = new Uint32Array(capacity + 1);
  tree.links = new Int32Array(capacity);
  tree.counts = new Int32Array(capacity);
  tree.skip = new Uint32Array(capacity);
  tree.boxes = new Float64Array(capacity * BOX_VALUES);
  tree.mask = new Uint32Array((items.length + 31) >>> 5);
  const first = tree.first;
  tree.nodes = boxed.length
    ? buildCentreTree(
        centres,
        tree.leaves,
        boxed.length,
        LEAF_ITEMS,
        tree.links,
        tree.counts,
        (node, start) => {
          first[node] = start;
        },
      )
    : 0;
  first[tree.nodes] = boxed.length;
  // A leaf's subtree ends at the next node, an inner node's where its right child's does.
  for (let node = tree.nodes - 1; node >= 0; node--)
    tree.skip[node] = tree.counts[node] ? node + 1 : tree.skip[tree.links[node]];
  tree.count = items.length;
  refitNodes(blendState);
}

/** Fits every node box to its items' boxes, children first: pre-order read backwards. */
function refitNodes(blendState: BlendState) {
  const items = blendState.blendGpu,
    { boxes, first, links, counts, leaves, nodes } = blendState.hierarchy;
  for (let node = nodes - 1; node >= 0; node--) {
    const o = node * BOX_VALUES;
    if (!counts[node]) {
      const l = (node + 1) * BOX_VALUES,
        r = links[node] * BOX_VALUES;
      for (let v = 0; v < 3; v++) {
        boxes[o + v] = Math.min(boxes[l + v], boxes[r + v]);
        boxes[o + v + 3] = Math.max(boxes[l + v + 3], boxes[r + v + 3]);
      }
      continue;
    }
    boxEmpty(boxes, o);
    // Each item's own bounds are checked: a union would hide an infinite one behind a finite one.
    let finite = true;
    for (let k = first[node]; k < first[node] + counts[node] && finite; k++) {
      const box = items[leaves[k]].bounds;
      finite = !!box && box.every(Number.isFinite);
      if (finite) boxUnion(boxes, o, box![0], box![1], box![2], box![3], box![4], box![5]);
    }
    if (!finite) boxes.fill(NaN, o, o + BOX_VALUES);
  }
}

/**
 * The transparent items' world boxes rebuilt after a matrix move (`refreshBlendWorlds`), and the
 * tree refit to them: the only box writes after prepare, so the tree never lags a box.
 */
export function refreshBlendBoxes(blendState: BlendState) {
  refreshBlendWorlds(blendState.blendGpu);
  if (blendState.hierarchy.count === blendState.blendGpu.length) refitNodes(blendState);
}

/** The tree of the scene's items, built first when the list changed without `buildBlendStatics`. */
export function currentBlendHierarchy(blendState: BlendState) {
  if (blendState.hierarchy.count !== blendState.blendGpu.length) buildBlendHierarchy(blendState);
  return blendState.hierarchy;
}
