// The ray proof's oracle (`raycastPage.ts`): what a ray meets of a generated scene, in doubles, from
// the meshes the page built — each triangle where the world draws it, its morph targets applied at
// their weights —, by every triangle in turn, two-sided, as the engine's test rejects a hit at or
// under 1e-4 (`rayTriangleDistance`). The test kit's alone: the engine's query is on the GPU.
import type { Mesh } from '../../../packages/sdk-core/src/world/object/mesh.ts'

/** A world triangle of the oracle: its three corners, and the mesh and rank it comes from. */
export type OracleTriangle = { corners: number[][]; mesh: Mesh; rank: number }

/** The world triangles of `mesh` as it is drawn: its positions moved by its morph targets at their
 *  weights (relative ones added, absolute ones blended), then by its world matrix. */
export function drawnTriangles(mesh: Mesh): OracleTriangle[] {
  mesh.updateWorldMatrix(true, false)
  const shape = mesh.geometry,
    position = shape.attributes.position,
    targets = shape.morphAttributes.position ?? [],
    weights = mesh.morphTargetInfluences ?? [],
    m = mesh.matrixWorld.elements
  const vertex = (v: number) => {
    const p = [position.getX(v), position.getY(v), position.getZ(v)]
    targets.forEach((target, k) => {
      const w = weights[k] ?? 0,
        q = [target.getX(v), target.getY(v), target.getZ(v)]
      for (let a = 0; a < 3; a++)
        p[a] = shape.morphTargetsRelative ? p[a] + w * q[a] : p[a] + w * (q[a] - p[a])
    })
    return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
  }
  const index = shape.index,
    corners = index ? index.count : position.count
  const out: OracleTriangle[] = []
  for (let t = 0; t + 2 < corners; t += 3) {
    const at = (c: number) => (index ? index.getX(t + c) : t + c)
    out.push({ corners: [vertex(at(0)), vertex(at(1)), vertex(at(2))], mesh, rank: t / 3 })
  }
  return out
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** The distance along the unit `direction` from `origin` to the triangle, or `Infinity`. */
function crossing(origin: number[], direction: number[], [a, b, c]: number[][]) {
  const e0 = sub(b, a),
    e1 = sub(c, a),
    p = cross(direction, e1),
    det = dot(e0, p)
  if (det === 0) return Infinity
  const offset = sub(origin, a),
    u = dot(offset, p) / det
  if (u < 0 || u > 1) return Infinity
  const q = cross(offset, e0),
    v = dot(direction, q) / det
  if (v < 0 || u + v > 1) return Infinity
  const t = dot(e1, q) / det
  return t > 1e-4 ? t : Infinity
}

/** The nearest of `triangles` the ray meets: the triangle, the distance and its world normal as its
 *  winding orients it, or `null`. */
export function nearestTriangle(
  triangles: readonly OracleTriangle[],
  origin: number[],
  direction: number[],
) {
  let best: { triangle: OracleTriangle; distance: number } | null = null
  for (const triangle of triangles) {
    const t = crossing(origin, direction, triangle.corners)
    if (t < (best?.distance ?? Infinity)) best = { triangle, distance: t }
  }
  if (!best) return null
  const [a, b, c] = best.triangle.corners,
    n = cross(sub(b, a), sub(c, a)),
    length = Math.hypot(n[0], n[1], n[2])
  return { ...best, normal: n.map((x) => x / length) }
}
