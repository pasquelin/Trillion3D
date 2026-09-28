import { serialOf } from '../../host/graph/serial.ts';
import { depthOf } from './meshDepth.ts';

/** A drawn mesh as its order reads it: its order, its surface, and what its depth reads. */
export type OrderedNode = Parameters<typeof depthOf>[0] & {
  readonly renderOrder: number;
  readonly material?: unknown;
};

/**
 * THE ORDER OF A SCENE DRAW, the reference's: the opaque meshes by `renderOrder`, surface, then
 * from the nearest; the see-through ones by `renderOrder`, then from the farthest; a tie is broken
 * by the node's creation number (`serialOf`, a mesh the engine did not build sorting as the first
 * built). Opaque meshes of one order are grouped by surface, numbered as first met, as the
 * reference numbers the surfaces it meets — a run of one surface binds it once.
 *
 * Each list's keys are read once per node into flat arrays, and a permutation of its indices is
 * sorted by the comparators' own arithmetic: the same comparison results, hence the same stable
 * order, NaN, ±0 and ±Inf included (`drawOrder.test.ts`). A surface's number is still taken where
 * the comparison first asks for it, so the surfaces are numbered in the order they always were.
 * `screen` is the projection times the view; `serial` reads a node's creation number.
 */
export function createDrawOrder(serial: (node: OrderedNode) => number | undefined = serialOf) {
  const ranks = new WeakMap<object, number>();
  let nextRank = 0;
  // Reused from frame to frame: a sort allocates only when a list outgrows them.
  let depths = new Float64Array(0),
    orders = new Float64Array(0),
    serials = new Float64Array(0),
    surfaceRanks = new Int32Array(0);
  // Packed, grown one index at a time; `nodes` is emptied in place after each sort, so no mesh
  // is held between frames.
  const nodes: (OrderedNode | undefined)[] = [],
    permutation: number[] = [];
  /** The surface number of the node at `i`, taken on first ask (-1: not asked yet this sort). */
  const rankAt = (i: number) => {
    let rank = surfaceRanks[i];
    if (rank < 0) {
      const surface = nodes[i]!.material as object;
      const known = ranks.get(surface);
      if (known === undefined) ranks.set(surface, (rank = nextRank++));
      else rank = known;
      surfaceRanks[i] = rank;
    }
    return rank;
  };
  const frontToBack = (a: number, b: number) =>
    orders[a] - orders[b] ||
    rankAt(a) - rankAt(b) ||
    depths[a] - depths[b] ||
    serials[a] - serials[b];
  const backToFront = (a: number, b: number) =>
    orders[a] - orders[b] || depths[b] - depths[a] || serials[a] - serials[b];
  const sort = (
    list: OrderedNode[],
    screen: ArrayLike<number>,
    compare: (a: number, b: number) => number,
  ) => {
    const count = list.length;
    if (depths.length < count) {
      const size = Math.max(count, depths.length * 2);
      depths = new Float64Array(size);
      orders = new Float64Array(size);
      serials = new Float64Array(size);
      surfaceRanks = new Int32Array(size);
    }
    permutation.length = Math.min(permutation.length, count);
    for (let i = 0; i < count; i++) {
      const node = list[i];
      if (i < permutation.length) permutation[i] = i;
      else permutation.push(i);
      nodes[i] = node;
      depths[i] = depthOf(node, screen);
      orders[i] = node.renderOrder;
      serials[i] = serial(node) ?? 0;
    }
    if (compare === frontToBack) surfaceRanks.fill(-1, 0, count);
    permutation.sort(compare);
    for (let i = 0; i < count; i++) list[i] = nodes[permutation[i]]!;
    nodes.fill(undefined, 0, count);
  };
  return (opaque: OrderedNode[], seeThrough: OrderedNode[], screen: ArrayLike<number>) => {
    sort(opaque, screen, frontToBack);
    sort(seeThrough, screen, backToFront);
  };
}
