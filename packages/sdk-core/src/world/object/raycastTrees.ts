import type { Geometry } from '../geometry/geometry.ts';
import type { TriangleTree } from '../../collision/triangleTree.ts';

/**
 * THE RAYCAST TREE CACHE. `raycast` keeps the triangle tree of each shape it was cast at, in the
 * shape's own frame, so a second ray reuses it. The cache holds at most `raycastTreeBudget.bytes`
 * — a fixed, settable envelope, never read from the machine — and drops the tree cast at least
 * recently when a new one would exceed it. `Geometry.dispose()` drops its tree at once; a shape
 * collected without dispose leaves its tree to the collector, its bytes counted until evicted.
 */

/** A shape's tree, the geometry version it was built from, and each tree triangle's rank. */
export interface ShapeTree {
  version: number;
  tree: TriangleTree;
  ranks: Uint32Array;
}

/** Bytes the cache holds by default: about 1.3 million triangles at 52 bytes each. */
export const RAYCAST_TREE_BUDGET = 64 * 1024 * 1024;

type Held = ShapeTree & { key: WeakRef<Geometry>; bytes: number };

const trees = new WeakMap<Geometry, Held>();
/** Every tree held, the one cast at least recently first. */
const order = new Set<Held>();
let heldBytes = 0,
  budget = RAYCAST_TREE_BUDGET;

function drop(held: Held) {
  order.delete(held);
  heldBytes -= held.bytes;
  const geometry = held.key.deref();
  if (geometry && trees.get(geometry) === held) trees.delete(geometry);
}

/** Drops the oldest trees until `room` more bytes fit in the budget. */
function makeRoom(room: number) {
  for (const held of order) {
    if (heldBytes + room <= budget) return;
    drop(held);
  }
}

/** The cache's envelope: `bytes` to read or set it; a lower value evicts at once. */
export const raycastTreeBudget = {
  get bytes() {
    return budget;
  },
  set bytes(value: number) {
    budget = Math.max(0, value);
    makeRoom(0);
  },
  /** Bytes the cache holds now. */
  get held() {
    return heldBytes;
  },
};

/** The tree held for `geometry` at its current version, marked as cast most recently. */
export function heldTree(geometry: Geometry): ShapeTree | null {
  const held = trees.get(geometry);
  if (!held) return null;
  if (held.version !== geometry.version) return (drop(held), null);
  order.delete(held);
  order.add(held);
  return held;
}

/** Keeps `shape` for `geometry` when it fits the budget, evicting the oldest trees first. */
export function holdTree(geometry: Geometry, shape: ShapeTree) {
  const old = trees.get(geometry);
  if (old) drop(old);
  const bytes = shape.tree.bytes + shape.ranks.byteLength;
  if (bytes > budget) return;
  makeRoom(bytes);
  const held = { ...shape, key: new WeakRef(geometry), bytes };
  trees.set(geometry, held);
  order.add(held);
  heldBytes += bytes;
}

/** Drops the tree held for `geometry`, if any: what `Geometry.dispose()` calls. */
export function forgetTree(geometry: Geometry) {
  const held = trees.get(geometry);
  if (held) drop(held);
}
