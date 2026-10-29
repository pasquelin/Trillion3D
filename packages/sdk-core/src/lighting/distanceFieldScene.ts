import { DISTANCE_FIELD_UNITS_PER_METRE } from '../contracts/distanceFieldAbi.ts'
import { DISTANCE_FIELD_KERNEL_PULLBACK } from './distanceFieldKernel.ts'
import { cross } from '../../../math/src/vector/vectorTuple.ts'
import { binaryTreeOf } from './rayTracingTree.ts'

/**
 * THE TRIANGLES OF A MESH AS THE FIELD'S BUILD QUERIES THEM (`asset-compiler-rust/src/distance_field/scene.rs`, which this follows
 * step by step): the nearest triangle to a point, and the rays that tell inside from outside, in double precision on the CPU. The GPU
 * measures the voxels (`distanceFieldGpu.ts`); these queries classify the bricks, measure again the voxels the GPU was in doubt of, and
 * measure everything where no GPU is (`distanceFieldBuild.ts`).
 */

export type Vec3 = [number, number, number]

/** A triangle whose cross product, in centimetres, has a squared length under this is degenerate. */
const DEGENERATE_CROSS_SQUARED = 1e-8
/** A voxel is inside when more than this share of its rays meet a back face first. */
const INSIDE_SHARE = 0.25
const DIVISOR_FLOOR = 1e-20

const f = Math.fround

// Scalars over flat arrays, no allocation in a query: a field asks for millions.

/** The tree the queries walk, as flat arrays: the triangles' corners in leaf order (nine numbers each), and per node its two children
 *  (-1 for a leaf) and the range of slots a leaf holds. The GPU is sent the same tree (`distanceFieldGpu.ts`). */
interface SceneTree {
  readonly triangles: Float64Array
  readonly left: Int32Array
  readonly right: Int32Array
  readonly first: Int32Array
  readonly size: Int32Array
}

/** The queryable triangles of one mesh. */
export interface Scene {
  readonly tree: SceneTree
  readonly low: Vec3
  readonly high: Vec3
  readonly mostlyTwoSided: boolean
  /** Whether its triangles are two-sided: a hit on a back face then says nothing of the inside. */
  readonly twoSided: boolean
  /** The squared distance from `(x, y, z)` to the nearest triangle nearer than `limit`; -1 where none is. */
  nearest(x: number, y: number, z: number, limit: number): number
  /** Whether the ray `o + t · r`, for 0 < t < 1, first meets a back face: the triangle's winding turned the way the ray goes (`first_hit_beyond`). */
  hitsBackFace(ox: number, oy: number, oz: number, rx: number, ry: number, rz: number): boolean
}

/** The squared distance from `(px, py, pz)` to the triangle starting at word `t` of `tri`: the closest point of the regions of its vertices, edges and face. */
function triangleDistanceSquared(tri: Float64Array, t: number, px: number, py: number, pz: number) {
  const ax = tri[t],
    ay = tri[t + 1],
    az = tri[t + 2]
  const abx = tri[t + 3] - ax,
    aby = tri[t + 4] - ay,
    abz = tri[t + 5] - az
  const acx = tri[t + 6] - ax,
    acy = tri[t + 7] - ay,
    acz = tri[t + 8] - az
  const apx = px - ax,
    apy = py - ay,
    apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz,
    d2 = acx * apx + acy * apy + acz * apz
  let qx: number, qy: number, qz: number
  if (d1 <= 0 && d2 <= 0) [qx, qy, qz] = [ax, ay, az]
  else {
    const bpx = px - tri[t + 3],
      bpy = py - tri[t + 4],
      bpz = pz - tri[t + 5]
    const d3 = abx * bpx + aby * bpy + abz * bpz,
      d4 = acx * bpx + acy * bpy + acz * bpz
    const vc = d1 * d4 - d3 * d2
    const cpx = px - tri[t + 6],
      cpy = py - tri[t + 7],
      cpz = pz - tri[t + 8]
    const d5 = abx * cpx + aby * cpy + abz * cpz,
      d6 = acx * cpx + acy * cpy + acz * cpz
    const vb = d5 * d2 - d1 * d6
    const va = d3 * d6 - d5 * d4
    if (d3 >= 0 && d4 <= d3) [qx, qy, qz] = [tri[t + 3], tri[t + 4], tri[t + 5]]
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const w = d1 / (d1 - d3)
      ;[qx, qy, qz] = [ax + abx * w, ay + aby * w, az + abz * w]
    } else if (d6 >= 0 && d5 <= d6) [qx, qy, qz] = [tri[t + 6], tri[t + 7], tri[t + 8]]
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6)
      ;[qx, qy, qz] = [ax + acx * w, ay + acy * w, az + acz * w]
    } else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
      qx = tri[t + 3] + (tri[t + 6] - tri[t + 3]) * w
      qy = tri[t + 4] + (tri[t + 7] - tri[t + 4]) * w
      qz = tri[t + 5] + (tri[t + 8] - tri[t + 5]) * w
    } else {
      const denominator = 1 / (va + vb + vc)
      const v = vb * denominator,
        w = vc * denominator
      qx = ax + abx * v + acx * w
      qy = ay + aby * v + acy * w
      qz = az + abz * v + acz * w
    }
  }
  const dx = px - qx,
    dy = py - qy,
    dz = pz - qz
  return dx * dx + dy * dy + dz * dz
}

/**
 * The scene of the triangles `indices` name in `positions` (metres): `doubleSided` for all, `asIfTwoSided` as the build asks. None where no
 * triangle is left.
 */
export function sceneOf(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  doubleSided: boolean,
  asIfTwoSided: boolean,
): Scene | undefined {
  const count = Math.floor(indices.length / 3)
  const centimetres = Float32Array.from(positions, (v) => f(v * DISTANCE_FIELD_UNITS_PER_METRE))
  const kept: number[] = []
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => 3 * indices[3 * t + k])
    const e1 = [0, 1, 2].map((k) => centimetres[b + k] - centimetres[a + k])
    const e2 = [0, 1, 2].map((k) => centimetres[c + k] - centimetres[a + k])
    const [nx, ny, nz] = cross(e1, e2)
    if (nx * nx + ny * ny + nz * nz >= DEGENERATE_CROSS_SQUARED) kept.push(t)
  }
  if (kept.length === 0) return undefined
  const low: Vec3 = [Infinity, Infinity, Infinity],
    high: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let k = 0; k < centimetres.length; k++) {
    low[k % 3] = Math.min(low[k % 3], centimetres[k])
    high[k % 3] = Math.max(high[k % 3], centimetres[k])
  }
  const soup = new Float32Array(kept.length * 9)
  kept.forEach((t, rank) => {
    for (let k = 0; k < 3; k++)
      for (let a = 0; a < 3; a++)
        soup[rank * 9 + 3 * k + a] = centimetres[3 * indices[3 * t + k] + a]
  })
  const tree = binaryTreeOf(
    soup,
    Uint32Array.from({ length: kept.length * 3 }, (_, k) => k),
  )!
  // The triangles in leaf order, and the nodes as flat arrays: the box, the two children or the range of slots.
  const tri = new Float64Array(kept.length * 9)
  tree.order.forEach((rank, slot) => {
    for (let k = 0; k < 9; k++) tri[slot * 9 + k] = soup[rank * 9 + k]
  })
  const { nodes } = tree
  const box = new Float64Array(nodes.length * 6)
  const left = new Int32Array(nodes.length).fill(-1),
    right = new Int32Array(nodes.length).fill(-1)
  const first = new Int32Array(nodes.length),
    size = new Int32Array(nodes.length)
  nodes.forEach((node, k) => {
    box.set(node.box, 6 * k)
    if (node.children) [left[k], right[k]] = node.children
    if (node.leaf) [first[k], size[k]] = [node.leaf.first, node.leaf.count]
  })
  const stack = new Int32Array(Math.max(64, nodes.length))
  const boxDistance = (node: number, x: number, y: number, z: number) => {
    const b = 6 * node
    const dx = Math.max(box[b] - x, x - box[b + 3], 0),
      dy = Math.max(box[b + 1] - y, y - box[b + 4], 0),
      dz = Math.max(box[b + 2] - z, z - box[b + 5], 0)
    return dx * dx + dy * dy + dz * dz
  }
  const sided = doubleSided ? count : 0
  return {
    tree: { triangles: tri, left, right, first, size },
    low,
    high,
    mostlyTwoSided: sided * 4 >= count || asIfTwoSided,
    twoSided: doubleSided || asIfTwoSided,
    nearest(x, y, z, limit) {
      let best = limit * limit,
        found = false,
        top = 0
      stack[top++] = 0
      while (top > 0) {
        const node = stack[--top]
        if (boxDistance(node, x, y, z) >= best) continue
        if (left[node] < 0) {
          for (let slot = first[node]; slot < first[node] + size[node]; slot++) {
            const d = triangleDistanceSquared(tri, slot * 9, x, y, z)
            if (d < best) {
              best = d
              found = true
            }
          }
        } else if (boxDistance(left[node], x, y, z) < boxDistance(right[node], x, y, z)) {
          // The nearer child last, so it is walked first.
          stack[top++] = right[node]
          stack[top++] = left[node]
        } else {
          stack[top++] = left[node]
          stack[top++] = right[node]
        }
      }
      return found ? best : -1
    },
    hitsBackFace(ox, oy, oz, rx, ry, rz) {
      const ix = Math.abs(rx) < DIVISOR_FLOOR ? Infinity : 1 / rx,
        iy = Math.abs(ry) < DIVISOR_FLOOR ? Infinity : 1 / ry,
        iz = Math.abs(rz) < DIVISOR_FLOOR ? Infinity : 1 / rz
      let nearest = 1,
        slotHit = -1,
        top = 0
      stack[top++] = 0
      while (top > 0) {
        const node = stack[--top]
        const b = 6 * node
        let entry = 0,
          exit = nearest
        if (ix === Infinity) {
          if (ox < box[b] || ox > box[b + 3]) continue
        } else {
          const n = (box[b] - ox) * ix,
            far = (box[b + 3] - ox) * ix
          entry = Math.max(entry, Math.min(n, far))
          exit = Math.min(exit, Math.max(n, far))
        }
        if (iy === Infinity) {
          if (oy < box[b + 1] || oy > box[b + 4]) continue
        } else {
          const n = (box[b + 1] - oy) * iy,
            far = (box[b + 4] - oy) * iy
          entry = Math.max(entry, Math.min(n, far))
          exit = Math.min(exit, Math.max(n, far))
        }
        if (iz === Infinity) {
          if (oz < box[b + 2] || oz > box[b + 5]) continue
        } else {
          const n = (box[b + 2] - oz) * iz,
            far = (box[b + 5] - oz) * iz
          entry = Math.max(entry, Math.min(n, far))
          exit = Math.min(exit, Math.max(n, far))
        }
        if (entry > exit) continue
        if (left[node] >= 0) {
          stack[top++] = right[node]
          stack[top++] = left[node]
          continue
        }
        for (let slot = first[node]; slot < first[node] + size[node]; slot++) {
          const t0 = slot * 9
          const ax = tri[t0],
            ay = tri[t0 + 1],
            az = tri[t0 + 2]
          const e1x = tri[t0 + 3] - ax,
            e1y = tri[t0 + 4] - ay,
            e1z = tri[t0 + 5] - az
          const e2x = tri[t0 + 6] - ax,
            e2y = tri[t0 + 7] - ay,
            e2z = tri[t0 + 8] - az
          const hx = ry * e2z - rz * e2y,
            hy = rz * e2x - rx * e2z,
            hz = rx * e2y - ry * e2x
          const det = e1x * hx + e1y * hy + e1z * hz
          if (Math.abs(det) < 1e-300) continue
          const sx = ox - ax,
            sy = oy - ay,
            sz = oz - az
          const u = (sx * hx + sy * hy + sz * hz) / det
          if (u < 0 || u > 1) continue
          const qx = sy * e1z - sz * e1y,
            qy = sz * e1x - sx * e1z,
            qz = sx * e1y - sy * e1x
          const v = (rx * qx + ry * qy + rz * qz) / det
          if (v < 0 || u + v > 1) continue
          const t = (e2x * qx + e2y * qy + e2z * qz) / det
          if (t > 0 && t < nearest) {
            nearest = t
            slotHit = slot
          }
        }
      }
      if (slotHit < 0) return false
      // The triangle's cross product by its winding, against the ray's direction: positive is a back face.
      const t0 = slotHit * 9
      const e1 = [0, 1, 2].map((k) => tri[t0 + 3 + k] - tri[t0 + k])
      const e2 = [0, 1, 2].map((k) => tri[t0 + 6 + k] - tri[t0 + k])
      const [nx, ny, nz] = cross(e1, e2)
      return rx * nx + ry * ny + rz * nz > 0
    },
  }
}

/** The fewest back faces that are more than a quarter of `rays` rays. */
export const enoughBackFaces = (rays: number) => Math.floor(INSIDE_SHARE * rays) + 1

/** The signed distance from `(x, y, z)` to the surface, held to `trace` either way (`Scene::signed_distance`): the nearest triangle's distance
 *  where one lies within `trace`, negative where more than a quarter of the rays `directions` (three numbers each) that cross `volume`
 *  (six: its low and high corner) meet a back face first; `trace` otherwise. */
export function signedDistance(
  scene: Scene,
  [x, y, z]: Vec3,
  trace: number,
  directions: Float64Array,
  volume: Float64Array,
) {
  const near = scene.nearest(x, y, z, trace)
  if (near < 0) return trace
  const distance = Math.sqrt(near)
  const rays = directions.length / 3
  const enough = enoughBackFaces(rays)
  let back = 0
  for (let cast = 0; cast < rays; cast++) {
    if (back + rays - cast < enough) break
    const dx = directions[3 * cast],
      dy = directions[3 * cast + 1],
      dz = directions[3 * cast + 2]
    if (!rayCrossesBox(volume, x, y, z, dx * trace, dy * trace, dz * trace)) continue
    const pull = DISTANCE_FIELD_KERNEL_PULLBACK * trace
    if (
      scene.hitsBackFace(
        x - pull * dx,
        y - pull * dy,
        z - pull * dz,
        dx * trace,
        dy * trace,
        dz * trace,
      ) &&
      !scene.twoSided &&
      ++back >= enough
    )
      return -distance
  }
  return distance
}

/** Whether the ray from `(ox, oy, oz)` along `(rx, ry, rz)` crosses the box `volume` for t in [0, 1] (`ray_aabb`). */
function rayCrossesBox(
  volume: Float64Array,
  ox: number,
  oy: number,
  oz: number,
  rx: number,
  ry: number,
  rz: number,
) {
  let entry = 0,
    exit = 1
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? ox : a === 1 ? oy : oz,
      r = a === 0 ? rx : a === 1 ? ry : rz
    if (Math.abs(r) < DIVISOR_FLOOR) {
      if (o < volume[a] || o > volume[3 + a]) return false
      continue
    }
    const inverse = 1 / r
    const near = (volume[a] - o) * inverse,
      far = (volume[3 + a] - o) * inverse
    entry = Math.max(entry, Math.min(near, far))
    exit = Math.min(exit, Math.max(near, far))
  }
  return entry <= exit
}
