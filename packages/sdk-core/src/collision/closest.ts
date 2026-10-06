/**
 * CLOSEST POINTS between a segment and a triangle, the query a capsule is built on: a capsule
 * is the set of points within `radius` of a segment, so it overlaps a triangle exactly when the
 * segment comes closer than `radius` to it.
 *
 * The closest pair of a segment and a triangle is one of three things: the point where the
 * segment pierces the triangle (distance zero), an end of the segment against the inside of the
 * triangle, or the segment against one of the triangle's three edges. Each is solved in closed
 * form and the nearest kept. An end whose nearest triangle point is on an edge is that edge's
 * pair with the segment already: the segment's closest point to the edge is at most as far. A triangle is read from a flat list, nine numbers from `at`; every result is
 * written into caller-owned arrays, so a query allocates nothing.
 */

import { closestBetweenSegments } from './segmentPair.ts'

type Numbers = ArrayLike<number>

const edge = new Float64Array(6),
  onPlane = new Float64Array(3),
  tail = new Float64Array(3),
  candidate = new Float64Array(6),
  normal = new Float64Array(3)

/**
 * The projection of `p` on the plane of triangle `v[at..at+9]`, written to `out` with its squared
 * distance returned when it lies inside the edges, `normal` and `area` being what `triangleNormal`
 * wrote for it; `Infinity` otherwise (outside, or a flat triangle), as the nearest point is then on
 * an edge, which `closestSegmentTriangle`'s edge pairs measure.
 */
function projectionInside(out: Float64Array, p: Numbers, v: Numbers, at: number, area: number) {
  // Stryker disable next-line EqualityOperator,ConditionalExpression: flat: NaN height, never kept
  if (area > 0) {
    const h = planeSide(p, 0, v, at) / area
    // Stryker disable next-line EqualityOperator: `out` holds three numbers, a 4th write is dropped
    for (let k = 0; k < 3; k++) out[k] = p[k] - h * normal[k]
    if (insideTriangle(out[0], out[1], out[2], v, at, normal)) return h * h * area
  }
  return Infinity
}

/** The triangle's unnormalised normal, `(b - a) × (c - a)`, into `out`; returns its squared
 *  length (four times the squared area), zero for a degenerate triangle. */
export function triangleNormal(out: Float64Array, v: Numbers, at: number) {
  const ux = v[at + 3] - v[at],
    uy = v[at + 4] - v[at + 1],
    uz = v[at + 5] - v[at + 2],
    wx = v[at + 6] - v[at],
    wy = v[at + 7] - v[at + 1],
    wz = v[at + 8] - v[at + 2]
  out[0] = uy * wz - uz * wy
  out[1] = uz * wx - ux * wz
  out[2] = ux * wy - uy * wx
  return out[0] * out[0] + out[1] * out[1] + out[2] * out[2]
}

/** Whether a point of the triangle's plane lies on the inner side of all three edges, the
 *  sides being read against the triangle's normal `n` as `triangleNormal` wrote it. */
export function insideTriangle(
  x: number,
  y: number,
  z: number,
  v: Numbers,
  at: number,
  n: Numbers,
) {
  for (let e = 0; e < 3; e++) {
    const from = at + 3 * e,
      to = at + 3 * ((e + 1) % 3)
    const ex = v[to] - v[from],
      ey = v[to + 1] - v[from + 1],
      ez = v[to + 2] - v[from + 2]
    const px = x - v[from],
      py = y - v[from + 1],
      pz = z - v[from + 2]
    const turn =
      (ey * pz - ez * py) * n[0] + (ez * px - ex * pz) * n[1] + (ex * py - ey * px) * n[2]
    if (turn < 0) return false
  }
  return true
}

/**
 * The closest points of segment `segment` (six numbers) and triangle `v[at..at+9]`: `out[0..3]`
 * on the segment, `out[3..6]` on the triangle; returns the squared distance, zero when the
 * segment pierces the triangle.
 */
export function closestSegmentTriangle(
  out: Float64Array,
  segment: Numbers,
  v: Numbers,
  at: number,
) {
  const area = triangleNormal(normal, v, at)
  if (pierces(out, segment, v, at, area)) return 0
  // A read past the segment or the triangle is NaN, never kept; in a tie either closest pair is
  // right, and the first is kept.
  // Stryker disable EqualityOperator: NaN reads and ties
  let best = Infinity
  for (let end = 0; end < 6; end += 3) {
    for (let k = 0; k < 3; k++) tail[k] = segment[end + k]
    const distance = projectionInside(onPlane, tail, v, at, area)
    if (distance < best) {
      best = distance
      for (let k = 0; k < 3; k++) [out[k], out[3 + k]] = [tail[k], onPlane[k]]
    }
  }
  for (let e = 0; e < 3; e++) {
    const from = at + 3 * e,
      to = at + 3 * ((e + 1) % 3)
    for (let k = 0; k < 3; k++) [edge[k], edge[3 + k]] = [v[from + k], v[to + k]]
    const distance = closestBetweenSegments(candidate, segment, edge)
    if (distance < best) {
      best = distance
      out.set(candidate)
    }
  }
  // Stryker restore EqualityOperator
  return best
}

/** Whether the segment passes through the triangle: its ends on opposite sides of the plane,
 *  the crossing inside the edges. The crossing is then written to both halves of `out`. */
function pierces(out: Float64Array, segment: Numbers, v: Numbers, at: number, area: number) {
  // A flat triangle leaves both ends at height 0 (`d0 === d1`), and an end on the plane is found at
  // distance 0, as its own pair, by the end search.
  // Stryker disable all: flat triangle, end on the plane
  if (area === 0) return false
  const d0 = planeSide(segment, 0, v, at),
    d1 = planeSide(segment, 3, v, at)
  if (d0 * d1 > 0 || d0 === d1) return false
  // Stryker restore all
  const t = d0 / (d0 - d1)
  for (let k = 0; k < 3; k++) out[k] = out[3 + k] = segment[k] + t * (segment[3 + k] - segment[k])
  return insideTriangle(out[0], out[1], out[2], v, at, normal)
}

/** The signed, unnormalised height of point `p[k..k+3]` above the plane of `normal`. */
function planeSide(p: Numbers, k: number, v: Numbers, at: number) {
  const n = normal
  return (p[k] - v[at]) * n[0] + (p[k + 1] - v[at + 1]) * n[1] + (p[k + 2] - v[at + 2]) * n[2]
}
