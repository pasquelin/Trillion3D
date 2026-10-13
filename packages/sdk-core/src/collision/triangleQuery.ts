import { slabCut } from '../../../math/src/geometry/slab.ts'
import type { TriangleTree } from './triangleTree.ts'
import { rayTriangle } from '../../../math/src/geometry/rayTriangle.ts'

/**
 * THE QUERIES OF A TRIANGLE TREE (`triangleTree.ts`): every triangle whose box meets a box, and
 * the nearest triangle a ray crosses. Both walk the tree on one fixed stack and allocate nothing.
 */

/** Depth bound of a balanced tree over 2^32 triangles: the traversal stack never grows. */
const STACK_DEPTH = 64
const stack = new Int32Array(STACK_DEPTH)

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
  if (tree.triangleCount === 0) return
  const { bounds, links, counts, triangles } = tree
  let top = 0
  stack[top++] = 0
  while (top > 0) {
    const node = stack[--top],
      at = node * 6
    if (!overlapsNode(bounds, at, min, max)) continue
    if (counts[node] === 0) {
      stack[top++] = links[node]
      stack[top++] = node + 1
      continue
    }
    for (let t = links[node], end = t + counts[node]; t < end; t++) {
      const first = 9 * t
      if (overlapsTriangle(triangles, first, min, max)) visit(first)
    }
  }
}

/** Whether node box `at` of `bounds` — min xyz, max xyz, never NaN — meets `[min, max]`. Each
 *  axis misses when both bounds lie past one side of the query: the test of the smaller and the
 *  larger bound, so an empty node (`+∞` to `−∞`) is kept. */
function overlapsNode(
  bounds: Float32Array,
  at: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  for (let k = 0; k < 3; k++) {
    const low = bounds[at + k],
      high = bounds[at + 3 + k]
    if ((low > max[k] && high > max[k]) || (low < min[k] && high < min[k])) return false
  }
  return true
}

/** Whether the box around triangle `at` of `triangles` — three corners, a NaN number skipped —
 *  meets `[min, max]`. */
function overlapsTriangle(
  triangles: Float32Array,
  at: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  for (let k = 0; k < 3; k++) {
    let low = Infinity,
      high = -Infinity
    for (let c = at + k; c < at + 9; c += 3) {
      const value = triangles[c]
      if (value < low) low = value
      if (value > high) high = value
    }
    if (low > max[k] || high < min[k]) return false
  }
  return true
}

const span = new Float64Array(2)

/** The parameter where the ray enters node box `at` of `bounds` (`slabCut`), or
 *  `Infinity` when it misses it or enters it past `before`. */
function enterBox(
  bounds: Float32Array,
  at: number,
  o: ArrayLike<number>,
  d: ArrayLike<number>,
  before: number,
) {
  span[0] = 0
  span[1] = before
  return slabCut(span, bounds, at, bounds, at + 3, o, d) ? span[0] : Infinity
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
  if (tree.triangleCount === 0) return null
  const { bounds, links, counts, triangles } = tree
  let best = Infinity,
    found = -1,
    top = 0
  stack[top++] = 0
  while (top > 0) {
    const node = stack[--top]
    if (enterBox(bounds, node * 6, o, d, best) === Infinity) continue
    if (counts[node] === 0) {
      stack[top++] = links[node]
      stack[top++] = node + 1
      continue
    }
    for (let t = links[node], end = t + counts[node]; t < end; t++) {
      const crossed = rayTriangle(o, d, triangles, 9 * t, -Number.MIN_VALUE, best)
      if (crossed < best) [best, found] = [crossed, 9 * t]
    }
  }
  return found < 0 ? null : { t: best, at: found }
}
