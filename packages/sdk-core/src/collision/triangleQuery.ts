import { slabCut } from '../math/primitives/slab.ts';
import { insideTriangle, triangleNormal } from './closest.ts';
import type { TriangleTree } from './triangleTree.ts';

/**
 * THE QUERIES OF A TRIANGLE TREE (`triangleTree.ts`): every triangle whose box meets a box, and
 * the nearest triangle a ray crosses. Both walk the tree on one fixed stack and allocate nothing.
 */

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
    if (!overlapsNode(bounds, at, min, max)) continue;
    if (counts[node] === 0) {
      stack[top++] = links[node];
      stack[top++] = node + 1;
      continue;
    }
    for (let t = links[node], end = t + counts[node]; t < end; t++) {
      const first = 9 * t;
      if (overlapsTriangle(triangles, first, min, max)) visit(first);
    }
  }
}

/** Whether node box `at` of `bounds` — min xyz, max xyz, never NaN — meets `[min, max]`. Each
 *  axis misses when both bounds lie past one side of the query: the test of the smaller and the
 *  larger bound, so an empty node (`+∞` to `−∞`) is kept as before. */
function overlapsNode(
  bounds: Float32Array,
  at: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  for (let k = 0; k < 3; k++) {
    const low = bounds[at + k],
      high = bounds[at + 3 + k];
    if ((low > max[k] && high > max[k]) || (low < min[k] && high < min[k])) return false;
  }
  return true;
}

/** Whether the box around triangle `at` of `triangles` — three corners, a NaN number skipped —
 *  meets `[min, max]`. */
export function overlapsTriangle(
  triangles: Float32Array,
  at: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  for (let k = 0; k < 3; k++) {
    let low = Infinity,
      high = -Infinity;
    for (let c = at + k; c < at + 9; c += 3) {
      const value = triangles[c];
      if (value < low) low = value;
      if (value > high) high = value;
    }
    if (low > max[k] || high < min[k]) return false;
  }
  return true;
}

/**
 * The triangles of `tree` whose box meets `[min, max]` — each one's first number in
 * `tree.triangles` — in the order `forEachTriangleInBox` visits them, into `into.list` (grown when
 * full); returns their count. A node's box holds its triangles' boxes, so filtering this list by
 * `overlapsTriangle` against any box inside `[min, max]` gives that box's visit, in its order.
 */
export function gatherTrianglesInBox(
  tree: TriangleTree,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  into: { list: Int32Array },
) {
  let count = 0;
  forEachTriangleInBox(tree, min, max, (at) => {
    if (count === into.list.length) {
      const grown = new Int32Array(2 * count);
      grown.set(into.list);
      into.list = grown;
    }
    into.list[count++] = at;
  });
  return count;
}

const normal = new Float64Array(3);

/**
 * Where the ray `o + t·d` crosses triangle `v[at..at+9]`: its parameter `t ≥ 0`, or `-1`. Either
 * face is crossed; a ray in the triangle's plane, or a degenerate triangle, crosses nothing. The
 * plane is met first, then the point is tested inside the edges (`insideTriangle`, the rule the
 * capsule's contacts read).
 */
function crossTriangle(
  o: ArrayLike<number>,
  d: ArrayLike<number>,
  v: ArrayLike<number>,
  at: number,
) {
  if (triangleNormal(normal, v, at) === 0) return -1;
  const facing = normal[0] * d[0] + normal[1] * d[1] + normal[2] * d[2];
  if (facing === 0) return -1;
  const height =
    normal[0] * (v[at] - o[0]) + normal[1] * (v[at + 1] - o[1]) + normal[2] * (v[at + 2] - o[2]);
  const t = height / facing;
  if (!(t >= 0)) return -1;
  return insideTriangle(o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2], v, at, normal) ? t : -1;
}

const span = new Float64Array(2);

/** The parameter where the ray enters node box `at` of `bounds` (`slabCut`), or
 *  `Infinity` when it misses it or enters it past `before`. */
function enterBox(
  bounds: Float32Array,
  at: number,
  o: ArrayLike<number>,
  d: ArrayLike<number>,
  before: number,
) {
  span[0] = 0;
  span[1] = before;
  return slabCut(span, bounds, at, bounds, at + 3, o, d) ? span[0] : Infinity;
}

/**
 * The nearest triangle of `tree` the ray `o + t·d` crosses: its parameter `t` and `at`, its first
 * number in `tree.triangles`; `null` when it crosses none. Only the nodes the ray enters before
 * the nearest crossing found so far are opened.
 */
export function nearestTriangleOnRay(
  tree: TriangleTree,
  o: ArrayLike<number>,
  d: ArrayLike<number>,
) {
  if (tree.triangleCount === 0) return null;
  const { bounds, links, counts, triangles } = tree;
  let best = Infinity,
    found = -1,
    top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const node = stack[--top];
    if (enterBox(bounds, node * 6, o, d, best) === Infinity) continue;
    if (counts[node] === 0) {
      stack[top++] = links[node];
      stack[top++] = node + 1;
      continue;
    }
    for (let t = links[node], end = t + counts[node]; t < end; t++) {
      const crossed = crossTriangle(o, d, triangles, 9 * t);
      if (crossed >= 0 && crossed < best) [best, found] = [crossed, 9 * t];
    }
  }
  return found < 0 ? null : { t: best, at: found };
}
