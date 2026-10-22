import { saturate } from '../../../../../math/src/scalar/reals.ts'
import { BARYCENTRIC_ONE } from '../contract.ts'
import { PatchMesh } from './patchMesh.ts'
import { collapseEdge } from './patchCollapse.ts'
import { compact } from './patchCompact.ts'

const f = Math.fround

/** A pattern of a triangle's three edge factors: its vertices, each a pair of 15-bit barycentrics
 *  packed `x | y << 16`, and its triangles, three vertex indices of ten bits packed. */
export type Pattern = { verts: number[]; indexes: number[] }

/** Remeshing sweeps over the edges, and the shortest an edge may be and the longest it is let be,
 *  in edge lengths: half of the longest, so a split never leaves an edge a collapse takes back. */
const SWEEPS = 64
const MIN_EDGE = f(0.66)
const MAX_EDGE = f(1.33)
/** The prime a sweep steps over the edge numbers by, so every edge is met once in a shuffled
 *  order. */
const EDGE_STRIDE = 31337

/**
 * The squared length of the step between two barycentric points of a triangle whose squared edge
 * lengths are `edges`, in single precision: -(x·y·e0 + y·z·e1 + z·x·e2) for the difference
 * `(x, y, z)`, which sums to zero.
 */
function lengthSquared(a: number[], b: number[], edges: number[]) {
  const x = f(f(a[0]) - f(b[0])),
    y = f(f(a[1]) - f(b[1])),
    z = f(f(a[2]) - f(b[2]))
  const first = f(f(f(-x) * y) * edges[0])
  const second = f(f(y * z) * edges[1])
  const third = f(f(z * x) * edges[2])
  return f(f(first - second) - third)
}

/** The triangle grid of factor `n` on every edge: the rows of a triangle, vertices then triangles. */
function uniform(mesh: PatchMesh, n: number) {
  const verts = ((n + 1) * (n + 2)) / 2
  for (let i = 0; i < verts; i++) {
    const row = Math.floor(f(f(Math.sqrt(f(i * 8 + 1))) * 0.5 - 0.5))
    const col = i - (row * (row + 1)) / 2
    mesh.appendVertex([(n - row) / n, col / n, (row - col) / n])
  }
  for (let t = 0; t < n * n; t++) {
    const row = Math.floor(Math.sqrt(t)),
      col = t - row * row
    const flip = col & 1,
      vc = col >> 1
    const rc = [
      [row, vc],
      [row + 1 - flip, vc + 1],
      [row + 1, vc + flip],
    ]
    mesh.appendTriangle(rc.map(([r, c]) => c + (r * (r + 1)) / 2) as [number, number, number])
  }
}

/** One edge's turn in a sweep: collapse it when short, flip it when its opposite is closer, split
 *  it when long, the first that applies. */
function processEdge(mesh: PatchMesh, e: number, edges: number[]) {
  const [v0, v1] = mesh.edge[e].v
  const length = lengthSquared(mesh.position[v0], mesh.position[v1], edges)
  const b0 = mesh.isBoundaryVertex(v0),
    b1 = mesh.isBoundaryVertex(v1),
    border = mesh.isBoundaryEdge(e)
  if ((border || !b0 || !b1) && length < f(MIN_EDGE * MIN_EDGE)) {
    let keep = v0,
      remove = v1,
      t = 0.5
    if (b0) [keep, remove, t] = [v0, v1, 0]
    if (b1) [keep, remove, t] = [v1, v0, 0]
    if (collapseEdge(mesh, keep, remove, t)) return
  }
  if (!border) {
    const [o0, o1] = mesh.opposing(e)
    const across = lengthSquared(mesh.position[o0], mesh.position[o1], edges)
    if (across < f(f(0.9) * length) && mesh.flipEdge(e)) return
  }
  if (length > f(MAX_EDGE * MAX_EDGE)) {
    let t = 0.5
    if (border) {
      const splits = Math.floor(f(f(Math.sqrt(length)) + 0.5))
      t = f(Math.floor(f(splits / 2)) / splits)
    }
    mesh.splitEdge(e, t)
  }
}

/** The triangle remeshed until its edges are about one unit long in the metric its factors give. */
function remesh(mesh: PatchMesh, factors: number[]) {
  mesh.appendVertex([1, 0, 0])
  mesh.appendVertex([0, 1, 0])
  mesh.appendVertex([0, 0, 1])
  mesh.appendTriangle([0, 1, 2])
  const edges = factors.map((n) => n * n)
  for (let k = 0; k < SWEEPS; k++) {
    const max = mesh.edges.max
    const start = k % max
    let e = start
    do {
      if (mesh.edges.valid(e)) processEdge(mesh, e, edges)
      e = (e + EDGE_STRIDE) % max
    } while (e !== start)
    const relaxed: number[][] = []
    for (let v = 0; v < mesh.vertices.max; v++) {
      if (!mesh.vertices.valid(v)) continue
      relaxed[v] = mesh.isBoundaryVertex(v) ? mesh.position[v] : mesh.oneRingCentroid(v)
    }
    for (let v = 0; v < relaxed.length; v++) if (relaxed[v]) mesh.position[v] = relaxed[v]
  }
}

/** The barycentric of a vertex rounded to 15 bits, the largest recomputed so they sum to the whole,
 *  and snapped on an edge to the exact division the edge's factor says. */
function quantize(p: number[], factors: number[]) {
  const q = p.map((x) => Math.floor(saturate(x) * BARYCENTRIC_ONE + 0.5))
  const e0 = q[0] > q[1] ? (q[0] > q[2] ? 0 : 2) : q[1] > q[2] ? 1 : 2
  const e1 = (1 << e0) & 3,
    e2 = (1 << e1) & 3
  q[e0] = BARYCENTRIC_ONE - q[e1] - q[e2]
  for (let i = 0; i < 3; i++) {
    const a = i,
      b = (1 << a) & 3
    if (q[a] + q[b] !== BARYCENTRIC_ONE) continue
    const low = q[a] < q[b] ? a : b,
      high = q[a] >= q[b] ? a : b
    const snapped = (q[low] * factors[i] + BARYCENTRIC_ONE / 2 - 1) & ~(BARYCENTRIC_ONE - 1)
    q[low] = Math.floor(snapped / factors[i])
    q[high] = BARYCENTRIC_ONE - q[low]
  }
  return q
}

/**
 * The pattern of a triangle whose edges have the factors `factors`, descending: the uniform grid
 * when the factors are all one, else the triangle remeshed. Its vertices are quantised and its
 * triangles listed in the order the vertex and triangle numbers fall in once the mesh is compacted.
 */
export function pattern(factors: [number, number, number]): Pattern {
  const mesh = new PatchMesh()
  if (factors[0] === factors[2]) uniform(mesh, factors[0])
  else remesh(mesh, factors)
  compact(mesh)
  const verts = mesh.position.map((p) => {
    const q = quantize(p, factors)
    return (q[0] | (q[1] << 16)) >>> 0
  })
  const indexes = mesh.triangle.map(([a, b, c]) => a | (b << 10) | (c << 20))
  return { verts, indexes }
}
