import type { TransformTree } from './transformTree.ts';

/** A typed array of `length` entries holding `old`'s, which it outgrows: the one growth rule of
 *  the transform tree and the scene light store. */
export function grown<
  T extends Int32Array | Uint8Array | Uint32Array | Float32Array | Float64Array,
>(old: T | undefined, make: new (length: number) => T, length: number) {
  const next = new make(length);
  if (old) next.set(old);
  return next;
}

/** Sixteen-number views of one fresh block for nodes `from` to `to`, appended to `list`. */
function appendViews(list: Float64Array[], from: number, to: number) {
  const block = new Float64Array((to - from) * 16);
  for (let i = from; i < to; i++) list.push(block.subarray((i - from) * 16, (i - from) * 16 + 16));
}

/**
 * Grows capacity to `capacity` nodes, content kept. The local and world matrices of the new nodes
 * live in a block of their own, appended: a matrix view, once handed out, is its node's storage for
 * as long as its slot lives, whatever the tree grows by later. The other stores are replaced, and
 * the owner of views on the pose stores hears it (`TransformTree.grew`).
 */
export function reserve(tree: TransformTree, capacity: number) {
  const { position, quaternion, scale } = tree,
    from = tree.capacity;
  tree.capacity = capacity;
  tree.parent = grown(tree.parent, Int32Array, capacity);
  tree.flags = grown(tree.flags, Uint8Array, capacity);
  tree.position = grown(tree.position, Float64Array, capacity * 3);
  tree.quaternion = grown(tree.quaternion, Float64Array, capacity * 4);
  tree.scale = grown(tree.scale, Float64Array, capacity * 3);
  appendViews(tree.localViews, from, capacity);
  appendViews(tree.worldViews, from, capacity);
  tree.version = grown(tree.version, Uint32Array, capacity);
  tree.seen = grown(tree.seen, Uint32Array, capacity);
  tree.free = grown(tree.free, Int32Array, capacity);
  tree.firstChild = grown(tree.firstChild, Int32Array, capacity);
  tree.lastChild = grown(tree.lastChild, Int32Array, capacity);
  tree.nextSibling = grown(tree.nextSibling, Int32Array, capacity);
  tree.previousSibling = grown(tree.previousSibling, Int32Array, capacity);
  tree.depth = grown(tree.depth, Int32Array, capacity);
  tree.listed = grown(tree.listed, Int32Array, capacity);
  tree.order = new Int32Array(capacity);
  tree.chain = new Int32Array(capacity);
  tree.stamp = grown(tree.stamp, Uint32Array, capacity);
  if (position) tree.grew?.(position, quaternion, scale);
}
