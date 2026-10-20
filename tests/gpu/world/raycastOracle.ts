// The ray proof's oracle (`raycastPage.ts`): what a ray meets of a generated scene, in doubles, from
// the meshes the page built — each triangle where the world draws it, its morph targets applied at
// their weights —, by every triangle in turn, with the engine's two-sided test in doubles. The test
// kit's alone: the engine's query is on the GPU.
import type { Mesh } from '../../../packages/sdk-core/src/world/object/mesh.ts'
import { rayTriangle } from '../../../packages/math/src/geometry/rayTriangle.ts'
import {
  dotVector3 as dot,
  normalizeVector3,
  writeCrossVector3,
} from '../../../packages/math/src/vector/vector.ts'
import { clamp } from '../../../packages/math/src/scalar/reals.ts'

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

/** Where the engine's test rejects a hit, as near (`rayTriangleDistance`): at or under 1e-4. */
const NEAR = 1e-4

/** The nearest of `triangles` the ray meets — the engine's Möller–Trumbore test, its processor
 *  twin in doubles (`rayTriangle`) —: the triangle, the distance, and its world normal as its
 *  winding orients it, or `null`. */
export function nearestTriangle(
  triangles: readonly OracleTriangle[],
  origin: number[],
  direction: number[],
) {
  let best: { triangle: OracleTriangle; distance: number } | null = null
  for (const triangle of triangles) {
    const far = best?.distance ?? Infinity
    const t = rayTriangle(origin, direction, triangle.corners.flat(), 0, NEAR, far)
    if (t < far) best = { triangle, distance: t }
  }
  if (!best) return null
  const [a, b, c] = best.triangle.corners,
    normal = new Float64Array(3)
  writeCrossVector3(normal, 0, ...edge(b, a), ...edge(c, a))
  normalizeVector3(normal)
  return { ...best, normal: [...normal] }
}

/** Where the engine meets a line (`raySegmentDistance`): the nearest pass of the ray by the one
 *  segment of a line mesh, in doubles, within `reach` of it — the distance along the ray and the
 *  normal facing the ray —, or `null`. */
export function nearestSegment(mesh: Mesh, origin: number[], direction: number[], reach: number) {
  const [a, b] = [0, 1].map((k) => drawnCorner(mesh, k)),
    edge = b.map((x, c) => x - a[c]),
    offset = origin.map((x, c) => x - a[c])
  const [dd, ee, de] = [dot(direction, direction), dot(edge, edge), dot(direction, edge)]
  // The closest points of the two lines, the segment's clamped to its ends, the ray's to its start.
  const s = clamp(
    (dd * dot(edge, offset) - de * dot(direction, offset)) / (dd * ee - de * de),
    0,
    1,
  )
  const point = a.map((x, c) => x + edge[c] * s)
  const t = Math.max(
    0,
    dot(
      direction,
      point.map((x, c) => x - origin[c]),
    ) / dd,
  )
  const gap = point.map((x, c) => origin[c] + direction[c] * t - x)
  if (dot(gap, gap) > reach * reach || t <= NEAR) return null
  return { distance: t, normal: direction.map((x) => -x) }
}

/** Vertex `v` of `mesh` in the world. */
function drawnCorner(mesh: Mesh, v: number) {
  mesh.updateWorldMatrix(true, false)
  const p = mesh.geometry.attributes.position,
    m = mesh.matrixWorld.elements
  const [x, y, z] = [p.getX(v), p.getY(v), p.getZ(v)]
  return [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r])
}

/** `to − from`, three numbers. */
const edge = (to: number[], from: number[]) =>
  [to[0] - from[0], to[1] - from[1], to[2] - from[2]] as const
