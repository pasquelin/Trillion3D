// The scene trace's oracle: a brute force over the same triangles, in doubles. Every triangle of
// every placement the cut holds is taken from the ray tracing file, carried to the world by the
// placement's world matrix, and met by the Möller–Trumbore test (`rayTriangle`), the nearest hit
// found by trying them all.
import type { RayTracing } from '../../../packages/sdk-core/src/lighting/rayTracingFile.ts'
import {
  RAY_TRACING_FLAG_TRANSLUCENT,
  RAY_TRACING_FLAG_TWO_SIDED,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_TRIANGLE_BYTES,
} from '../../../packages/sdk-core/src/contracts/rayTracingAbi.ts'
import { RAY_TRACING_RECORD_WORDS } from '../../../packages/sdk-core/src/lighting/rayTracingFile.ts'
import { rayTriangle } from '../../../packages/math/src/geometry/rayTriangle.ts'
import { triangleCross } from '../../../packages/math/src/geometry/triangle.ts'
import { transformAffinePoint } from '../../../packages/math/src/vector/vector.ts'
import { CASTS_NO_SHADOW } from '../../../packages/sdk-browser/src/visibility/shader/spriteWgsl.ts'
import type { ClusterRoot } from '../../../packages/sdk-browser/src/geometry/selection/types.ts'

/** What the oracle reads of a root of the cut: where it is, which primitive it places, and the
 *  flags that take it out of a trace. */
export type OracleRoot = Pick<
  ClusterRoot<unknown>,
  'world' | 'mesh' | 'primitive' | 'mark' | 'parked' | 'hidden'
>

/** How much a triangle is grown (+) or shrunk (−) about its centroid to ask whether a ray passes
 *  within a hair of its edge: scaling by `1 ± 3·EDGE` moves each edge by `EDGE` in barycentric
 *  coordinates. A ray the nearest hit of which does not hold under both is grazing: float32 and
 *  double may part on it, and neither is wrong. */
const EDGE = 1e-4

/** The length under which two distances are the same hit: the relative and the absolute part. */
export const distanceTolerance = (t: number) => 1e-4 * t + 1e-4

/** A ray the oracle casts: world origin and unit direction, its reach, and the trace's rules. */
export interface OracleRay {
  origin: ArrayLike<number>
  direction: ArrayLike<number>
  tMax: number
  anyHit: boolean
  cullFront: boolean
  shadow: boolean
}

/** The triangles of the cut in the world, the rank of the placement and of the triangle in the file
 *  with each: three copies of the corners, the exact ones and the shrunk and grown ones. */
export interface PlacedTriangles {
  readonly count: number
  readonly placement: Uint32Array
  readonly triangle: Uint32Array
  /** Whether the primitive is two-sided, translucent, or casts no shadow, per triangle. */
  readonly twoSided: Uint8Array
  readonly translucent: Uint8Array
  readonly noShadow: Uint8Array
  readonly exact: Float64Array
  readonly shrunk: Float64Array
  readonly grown: Float64Array
}

/** Every triangle of every placement of `roots` that has a record in `file`, in the world. A parked
 *  or hidden root holds none, as the cut's tables name it no root. */
export function placeTriangles(file: RayTracing, roots: readonly OracleRoot[]): PlacedTriangles {
  const corners = new Float32Array(
    file.triangles.buffer,
    file.triangles.byteOffset,
    file.triangles.length,
  )
  const R = RAY_TRACING_RECORD_AT
  const list: { placement: number; triangle: number; root: OracleRoot; flags: number }[] = []
  roots.forEach((root, placement) => {
    if (root.parked || root.hidden || root.mesh === undefined || root.primitive === undefined)
      return
    const record = file.byPrimitive.get(root.mesh)?.get(root.primitive)
    if (record === undefined) return
    const at = record * RAY_TRACING_RECORD_WORDS
    const first = file.records[at + R.firstTriangle]
    for (let k = 0; k < file.records[at + R.triangleCount]; k++)
      list.push({ placement, triangle: first + k, root, flags: file.records[at + R.flags] })
  })
  const count = list.length
  const placed = {
    count,
    placement: new Uint32Array(count),
    triangle: new Uint32Array(count),
    twoSided: new Uint8Array(count),
    translucent: new Uint8Array(count),
    noShadow: new Uint8Array(count),
    exact: new Float64Array(count * 9),
    shrunk: new Float64Array(count * 9),
    grown: new Float64Array(count * 9),
  }
  list.forEach(({ placement, triangle, root, flags }, i) => {
    placed.placement[i] = placement
    placed.triangle[i] = triangle
    placed.twoSided[i] = flags & RAY_TRACING_FLAG_TWO_SIDED ? 1 : 0
    placed.translucent[i] = flags & RAY_TRACING_FLAG_TRANSLUCENT ? 1 : 0
    placed.noShadow[i] = (root.mark ?? 0) & CASTS_NO_SHADOW ? 1 : 0
    const m = root.world.elements
    const world = new Float64Array(9)
    for (let c = 0; c < 3; c++) {
      const at = triangle * (RAY_TRACING_TRIANGLE_BYTES / 4) + c * 3
      transformAffinePoint(world, m, corners[at], corners[at + 1], corners[at + 2], c * 3)
    }
    placed.exact.set(world, i * 9)
    for (const [out, scale] of [
      [placed.shrunk, 1 - 3 * EDGE],
      [placed.grown, 1 + 3 * EDGE],
    ] as const)
      for (let axis = 0; axis < 3; axis++) {
        const centre = (world[axis] + world[3 + axis] + world[6 + axis]) / 3
        for (let c = 0; c < 3; c++)
          out[i * 9 + c * 3 + axis] = centre + (world[c * 3 + axis] - centre) * scale
      }
  })
  return placed
}

/** What one pass over the triangles finds: the nearest hit (or none), whether another triangle is
 *  met at the same distance, and whether the nearest faces the ray. */
interface Pass {
  hit: boolean
  t: number
  index: number
  front: boolean
  tie: boolean
}

/** The triangles `corners` against `ray`: the nearest meeting the trace's rules let through, or the
 *  first of them for an any-hit ray. The front is the winding seen from the ray in the world: a world
 *  that mirrors turns the corners over, and so the winding with them. */
function pass(set: PlacedTriangles, corners: Float64Array, ray: OracleRay): Pass {
  const best: Pass = { hit: false, t: ray.tMax, index: -1, front: false, tie: false }
  const hits: number[] = []
  const normal = [0, 0, 0]
  const [dx, dy, dz] = [ray.direction[0], ray.direction[1], ray.direction[2]]
  for (let i = 0; i < set.count; i++) {
    if (ray.shadow && (set.translucent[i] || set.noShadow[i])) continue
    const t = rayTriangle(ray.origin, ray.direction, corners, i * 9, 1e-4, ray.tMax)
    if (t >= ray.tMax) continue
    const at = i * 9
    triangleCross(normal, 0, corners, at, at + 3, at + 6)
    const front = normal[0] * dx + normal[1] * dy + normal[2] * dz < 0
    if (ray.cullFront && front && !set.twoSided[i]) continue
    if (ray.anyHit) return { hit: true, t, index: i, front, tie: false }
    hits.push(t)
    if (t < best.t) Object.assign(best, { hit: true, t, index: i, front })
  }
  if (best.hit) best.tie = hits.filter((t) => t - best.t <= distanceTolerance(best.t)).length > 1
  return best
}

/** The oracle's answer for one ray. */
export interface OracleHit extends Pass {
  /** False for a grazing ray: one the exact triangles and the same triangles shrunk or grown by a
   *  hair do not answer alike, so that no float tells the ray's side of an edge. */
  robust: boolean
  /** The placement and the triangle (ranks in the cut's roots and in the file) of the nearest hit. */
  placement: number
  triangle: number
}

/** The ray against every triangle of the cut: the nearest hit (the first, for an any-hit ray), and
 *  whether the answer holds with the triangles grown and shrunk by a hair. */
export function traceBruteForce(set: PlacedTriangles, ray: OracleRay): OracleHit {
  const exact = pass(set, set.exact, ray)
  const shrunk = pass(set, set.shrunk, ray),
    grown = pass(set, set.grown, ray)
  const robust =
    shrunk.hit === grown.hit &&
    (!shrunk.hit || ray.anyHit || shrunk.t - grown.t <= distanceTolerance(exact.t))
  return {
    ...exact,
    robust,
    placement: exact.hit ? set.placement[exact.index] : -1,
    triangle: exact.hit ? set.triangle[exact.index] : -1,
  }
}
