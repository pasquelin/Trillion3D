/**
 * A STATIC TRIANGLE TREE: a bounding-volume hierarchy over world-space triangles, built once
 * and asked for every triangle whose box meets a query box — the broad phase of a capsule.
 *
 * BUILD. Top-down: a node's triangles are split near the median of their centres along the
 * longest axis of the centres' box — the left side rounded up to whole leaves — until a node
 * holds at most `LEAF_TRIANGLES`. The split keeps the tree balanced whatever the triangles, so
 * its depth is about `log2(T / LEAF)` and a query's stack is a fixed array. The median is
 * selected in linear time (a partition, not a sort), so the build is `O(T log T)`. Triangles
 * are then copied in leaf order: a leaf reads a contiguous run, no index list survives.
 *
 * MEMORY. Exactly `36 T` bytes of triangles (nine float32) plus `32` bytes per node (six
 * float32 bounds, two int32 links), exactly `2 ceil(T / LEAF) - 1` nodes: about 52 bytes per
 * triangle. The build borrows `16 T` more bytes (order and centres), released when it returns.
 * `bytes` reports what the tree keeps.
 */

/** Most triangles a leaf holds. A leaf test costs a few dozen operations per triangle and a
 *  node test six comparisons, so a handful per leaf balances them; the value sets the cost of
 *  a query, never its result. */
export const LEAF_TRIANGLES = 4;

export interface TriangleTree {
  /** Nine numbers per triangle — three corners — in leaf order. */
  readonly triangles: Float32Array;
  /** Per node: min xyz, max xyz. */
  readonly bounds: Float32Array;
  /** Per node: first triangle of a leaf, or the right child of an inner node (the left one
   *  follows its parent). */
  readonly links: Int32Array;
  /** Per node: triangle count of a leaf, 0 for an inner node. */
  readonly counts: Int32Array;
  readonly triangleCount: number;
  /** Bytes the tree keeps. */
  readonly bytes: number;
}

/** Builds the tree over `source`, nine numbers per triangle; the source is left untouched. */
export function buildTriangleTree(source: ArrayLike<number>): TriangleTree {
  const count = Math.floor(source.length / 9);
  const leaves = Math.max(1, Math.ceil(count / LEAF_TRIANGLES)),
    capacity = 2 * leaves - 1;
  const bounds = new Float32Array(capacity * 6),
    links = new Int32Array(capacity),
    counts = new Int32Array(capacity),
    order = new Uint32Array(count),
    centres = new Float32Array(count * 3);
  for (let t = 0; t < count; t++) {
    order[t] = t;
    for (let k = 0; k < 3; k++)
      centres[3 * t + k] = (source[9 * t + k] + source[9 * t + 3 + k] + source[9 * t + 6 + k]) / 3;
  }
  let nodes = 0;
  const build = (start: number, end: number): number => {
    const node = nodes++;
    boxOf(bounds, node, source, order, start, end);
    if (end - start <= LEAF_TRIANGLES) {
      links[node] = start;
      counts[node] = end - start;
      return node;
    }
    // The left half takes a whole number of full leaves: every leaf but the last is full.
    const axis = longestAxis(centres, order, start, end),
      middle = start + LEAF_TRIANGLES * Math.ceil((end - start) / (2 * LEAF_TRIANGLES));
    selectMedian(order, centres, axis, start, end, middle);
    build(start, middle);
    links[node] = build(middle, end);
    return node;
  };
  build(0, count);
  const triangles = new Float32Array(count * 9);
  for (let i = 0; i < count; i++)
    for (let k = 0; k < 9; k++) triangles[9 * i + k] = source[9 * order[i] + k];
  const bytes = triangles.byteLength + bounds.byteLength + links.byteLength + counts.byteLength;
  return { triangles, bounds, links, counts, triangleCount: count, bytes };
}

function boxOf(
  bounds: Float32Array,
  node: number,
  source: ArrayLike<number>,
  order: Uint32Array,
  start: number,
  end: number,
) {
  const at = node * 6;
  bounds.fill(Infinity, at, at + 3);
  bounds.fill(-Infinity, at + 3, at + 6);
  for (let i = start; i < end; i++)
    for (let corner = 0; corner < 9; corner += 3)
      for (let k = 0; k < 3; k++) {
        const value = source[9 * order[i] + corner + k];
        if (value < bounds[at + k]) bounds[at + k] = value;
        if (value > bounds[at + 3 + k]) bounds[at + 3 + k] = value;
      }
}

function longestAxis(centres: Float32Array, order: Uint32Array, start: number, end: number) {
  let axis = 0,
    widest = -1;
  for (let k = 0; k < 3; k++) {
    let low = Infinity,
      high = -Infinity;
    for (let i = start; i < end; i++) {
      const value = centres[3 * order[i] + k];
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    if (high - low > widest) [widest, axis] = [high - low, k];
  }
  return axis;
}

/** Rearranges `order[start..end)` so `order[middle]` has the median centre on `axis`, the
 *  smaller before it and the larger after: a linear-time selection by repeated partition. */
function selectMedian(
  order: Uint32Array,
  centres: Float32Array,
  axis: number,
  start: number,
  end: number,
  middle: number,
) {
  const key = (i: number) => centres[3 * order[i] + axis];
  let low = start,
    high = end - 1;
  while (low < high) {
    const pivot = key((low + high) >> 1);
    let i = low,
      j = high;
    while (i <= j) {
      while (key(i) < pivot) i++;
      while (key(j) > pivot) j--;
      if (i <= j) {
        [order[i], order[j]] = [order[j], order[i]];
        i++;
        j--;
      }
    }
    if (middle <= j) high = j;
    else if (middle >= i) low = i;
    else return;
  }
}

/** Depth bound of a balanced tree over 2^32 triangles: the traversal stack never grows. */
const STACK_DEPTH = 64;
const stack = new Int32Array(STACK_DEPTH);

/**
 * Calls `visit(at)` — `at` the triangle's first number in `tree.triangles` — for every triangle
 * whose box meets `[min, max]`. The tree is only read; a visit may do anything but query again.
 */
export function forEachTriangleInBox(
  tree: TriangleTree,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  visit: (at: number) => void,
) {
  if (tree.triangleCount === 0) return;
  const { bounds, links, counts, triangles } = tree;
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const node = stack[--top],
      at = node * 6;
    if (!overlaps(bounds, at, min, max)) continue;
    if (counts[node] === 0) {
      stack[top++] = links[node];
      stack[top++] = node + 1;
      continue;
    }
    for (let t = links[node], end = t + counts[node]; t < end; t++) {
      const first = 9 * t;
      if (overlaps(triangles, first, min, max, 3)) visit(first);
    }
  }
}

/** Whether the box around `corners` points stored from `at` — a node's min and max, or a
 *  triangle's three corners — meets `[min, max]`. */
function overlaps(
  values: Float32Array,
  at: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  corners = 2,
) {
  for (let k = 0; k < 3; k++) {
    let low = Infinity,
      high = -Infinity;
    for (let c = 0; c < corners; c++) {
      const value = values[at + 3 * c + k];
      if (value < low) low = value;
      if (value > high) high = value;
    }
    if (low > max[k] || high < min[k]) return false;
  }
  return true;
}
