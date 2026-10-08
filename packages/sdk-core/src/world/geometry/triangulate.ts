import { cross2 } from '../../../../math/src/vector/vector.ts'

type P = readonly [number, number]

/** Twice the signed area: positive for a counter-clockwise outline. */
export const signedArea = (ring: readonly P[]) =>
  ring.reduce((sum, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length]
    return sum + x * ny - nx * y
  }, 0)

const orient = (a: P, b: P, c: P) => cross2(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1])
const same = (a: P, b: P) => a[0] === b[0] && a[1] === b[1]

/** True when segments `ab` and `cd` cross at a point inside both. */
function crosses(a: P, b: P, c: P, d: P) {
  // A shared end makes one product below zero, never negative: the guard only saves the work.
  // Stryker disable next-line ConditionalExpression,LogicalOperator: see above
  if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) return false
  const d1 = orient(a, b, c),
    d2 = orient(a, b, d),
    d3 = orient(c, d, a),
    d4 = orient(c, d, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/**
 * Ear clipping of a polygon with holes, in the plane. The outline is taken counter-clockwise and
 * each hole clockwise; each hole is joined to the outline by a bridge from its rightmost vertex to
 * the nearest outline vertex the bridge can reach without crossing an edge, which makes one
 * simple outline; then a convex corner holding no other vertex is cut off, again and again.
 * Returns the points in outline order and the triangles as indices into them.
 */
export function triangulate(outline: readonly P[], holes: readonly (readonly P[])[] = []) {
  const ring = [...outline]
  if (signedArea(ring) < 0) ring.reverse()
  // Stryker disable next-line EqualityOperator: a flat hole takes nothing, either way round
  const clockwise = (h: readonly P[]) => (signedArea(h) > 0 ? [...h].reverse() : [...h])
  const rings = holes.filter((h) => h.length >= 3).map(clockwise)
  // Stryker disable next-line all: any order bridges validly, every ring's edges being checked
  rings.sort((a, b) => Math.max(...b.map((p) => p[0])) - Math.max(...a.map((p) => p[0])))
  for (const hole of rings) {
    // Stryker disable next-line EqualityOperator: of two rightmost vertices, either bridges
    const m = hole.reduce((best, p, i) => (p[0] > hole[best][0] ? i : best), 0)
    const from = hole[m]
    const edges = [ring, ...rings].flatMap((r) =>
      r.map((p, i) => [p, r[(i + 1) % r.length]] as const),
    )
    let bridge = -1,
      nearest = Infinity
    ring.forEach((p, i) => {
      const d = (p[0] - from[0]) ** 2 + (p[1] - from[1]) ** 2
      if (d < nearest && !edges.some(([a, b]) => crosses(from, p, a, b))) [bridge, nearest] = [i, d]
    })
    if (bridge < 0) continue
    const loop = [...hole.slice(m), ...hole.slice(0, m), from]
    ring.splice(bridge + 1, 0, ...loop, ring[bridge])
  }
  const triangles: number[] = []
  const left = ring.map((_, i) => i)
  // The guard never binds (a pass without an ear breaks out), and a pass reporting a cut it did not
  // make runs again to the same fan: a safety, not a result.
  // Stryker disable all: see above
  let guard = left.length * left.length
  while (left.length > 3 && guard-- > 0) {
    let cut = false
    // Stryker restore all
    for (let k = 0; k < left.length; k++) {
      const [i, j, l] = [
        left[(k + left.length - 1) % left.length],
        left[k],
        left[(k + 1) % left.length],
      ]
      const [a, b, c] = [ring[i], ring[j], ring[l]]
      if (orient(a, b, c) <= 0) continue
      // On a simple outline no other vertex lies on the ear's own edges `ab` and `bc`.
      const blocked = left.some((v) => {
        const p = ring[v]
        if (same(p, a) || same(p, b) || same(p, c)) return false
        // Stryker disable next-line EqualityOperator: see above; `ca` is checked
        return orient(a, b, p) >= 0 && orient(b, c, p) >= 0 && orient(c, a, p) >= 0
      })
      if (blocked) continue
      triangles.push(i, j, l)
      left.splice(k, 1)
      cut = true
      break
    }
    // A polygon left with no ear is degenerate: its rest is fanned rather than dropped.
    // Stryker disable next-line ConditionalExpression: see the guard
    if (!cut) break
  }
  for (let k = 1; k + 1 < left.length; k++) triangles.push(left[0], left[k], left[k + 1])
  return { points: ring, triangles }
}
