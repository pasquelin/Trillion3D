// The run-time proxy's rays on the CPU (`runtimeTraceWgsl.ts`), the cut level: the same wide traversal of
// a cut's columns, the same budget (`runtimeSceneOracle.fixture.ts` walks the placements above them).
import {
  PROXY_CHILD_WORDS,
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
} from '../../../sdk-core/src/index.ts'
import { RAY_TRIANGLES, RAY_WORK } from './runtimeLayout.ts'
import { rayTriangle } from '../../../math/src/geometry/rayTriangle.ts'
import { slabCut } from '../../../math/src/geometry/slab.ts'

/** The columns of the arena's cuts, one cut's after another. */
export type ArenaColumns = {
  triangles: Float32Array
  nodeBounds: Float32Array
  nodeChildren: Uint32Array
}
/** A placement's instance: where its cut starts in the columns, and how many triangles it holds. */
export type Instance = { node: number; triangle: number; triangles: number }
export type Hit = { distance: number; placement: number; triangle: number; found: boolean }
/** The ray's spending (`rtWork`, `rtTests`). */
export type Spent = { work: number; tests: number }
export const spent = (s: Spent) => s.work >= RAY_WORK || s.tests >= RAY_TRIANGLES

export type Vec = [number, number, number]
/** The answer of a ray that has met nothing before `limit`. */
export const missed = (limit: number): Hit => ({
  distance: limit,
  placement: 0,
  triangle: 0,
  found: false,
})

/** `rayBoxEntry`: where the ray enters the box, or `limit + 1`. */
export function boxEntry(low: Vec, high: Vec, o: Vec, d: Vec, limit: number) {
  const span = new Float64Array([0, limit])
  return slabCut(span, low, 0, high, 0, o, d) ? span[0] : limit + 1
}

/** `rayTriangleDistance` on the triangle whose nine floats start at `at` of `v`: the distance along
 *  `d`, or `limit` where the ray misses or meets it within the 1e-4 self-hit bound. */
export const triangleDistance = (o: Vec, d: Vec, v: ArrayLike<number>, at: number, limit: number) =>
  rayTriangle(o, d, v, at, 1e-4, limit)

export const vertex = (columns: ArenaColumns, index: number, k: number): Vec => {
  const at = index * PROXY_TRIANGLE_FLOATS + k * 3
  return [columns.triangles[at], columns.triangles[at + 1], columns.triangles[at + 2]]
}

/** A cut's wide tree walked as `rtTraceCut` walks it, `node0` and `tri0` the cut's first node and
 *  triangle in the columns. */
export function traceCut(
  columns: ArenaColumns,
  o: Vec,
  d: Vec,
  limit: number,
  node0: number,
  tri0: number,
  placement: number,
  s: Spent,
): Hit {
  let best = missed(limit)
  const stack: number[] = []
  let node = 0
  for (let step = 0; step < 128; step++) {
    if (spent(s)) break
    s.work += 4
    const at = (node0 + node) * PROXY_NODE_FLOATS
    const low = [...columns.nodeBounds.subarray(at, at + 3)] as Vec,
      high = [...columns.nodeBounds.subarray(at + 3, at + 6)] as Vec
    if (boxEntry(low, high, o, d, best.distance) > best.distance) {
      const next = stack.pop()
      if (next === undefined) break
      node = next
      continue
    }
    let nearest = 0,
      nearestSpan = best.distance + 1
    for (let slot = 0; slot < 4; slot++) {
      if (spent(s)) break
      const base = (node0 + node) * PROXY_NODE_WORDS + slot * PROXY_CHILD_WORDS
      const lo = columns.nodeChildren[base],
        hi = columns.nodeChildren[base + 1],
        offset = columns.nodeChildren[base + 2]
      if (hi >>> 24 === 0) continue
      const byte = (word: number, k: number) => (word >>> (k * 8)) & 255
      const span = [0, 1, 2].map((a) => (high[a] - low[a]) / 255)
      const bytes = [byte(lo, 0), byte(lo, 1), byte(lo, 2), byte(lo, 3), byte(hi, 0), byte(hi, 1)]
      const childLow = [0, 1, 2].map((a) => low[a] + span[a] * bytes[a]) as Vec,
        childHigh = [0, 1, 2].map((a) => low[a] + span[a] * bytes[3 + a]) as Vec
      const entry = boxEntry(childLow, childHigh, o, d, best.distance)
      if (entry > best.distance) continue
      const count = byte(hi, 2)
      if (count > 0) {
        for (let k = 0; k < Math.min(count, 8); k++) {
          if (spent(s)) break
          const index = offset + k
          s.tests++
          s.work += 2
          const t = tri0 + index
          const distance = triangleDistance(
            o,
            d,
            columns.triangles,
            t * PROXY_TRIANGLE_FLOATS,
            best.distance,
          )
          if (distance < best.distance) best = { distance, placement, triangle: t, found: true }
        }
        continue
      }
      if (entry < nearestSpan) {
        if (nearestSpan <= best.distance) stack.push(nearest)
        nearest = offset
        nearestSpan = entry
      } else stack.push(offset)
    }
    if (nearestSpan <= best.distance) {
      node = nearest
      continue
    }
    const next = stack.pop()
    if (next === undefined) break
    node = next
  }
  return best
}
