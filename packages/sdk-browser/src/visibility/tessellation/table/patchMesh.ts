import { lerp } from '../../../../../math/src/scalar/reals.ts'

/**
 * The triangle mesh a pattern is remeshed on (`remesh.ts`): an indexed mesh whose triangles know
 * their edges and whose edges know their two triangles, with the identifier rules the remeshing's
 * order depends on — a freed vertex, triangle or edge is the next one handed out, last freed
 * first; an edge keeps its lower vertex first; a split takes its parameter from that vertex.
 * The pattern a triangle's three factors give is a function of this order: the same remesh on a
 * mesh that numbered its parts otherwise would settle on another, equally valid, pattern.
 */

/** No vertex, triangle or edge. */
export const NONE = -1

/** A set of identifiers handed out lowest-free-first by a free list, the last freed first. */
export class Ids {
  /** The references each identifier holds, `0` for a freed one. */
  refs: number[] = []
  private free: number[] = []
  allocate() {
    const id = this.free.pop() ?? this.refs.length
    this.refs[id] = 1
    return id
  }
  increment(id: number, by = 1) {
    this.refs[id] += by
  }
  decrement(id: number, by = 1) {
    this.refs[id] -= by
    if (this.refs[id] === 0) this.free.push(id)
  }
  valid(id: number) {
    return id >= 0 && id < this.refs.length && this.refs[id] > 0
  }
  get max() {
    return this.refs.length
  }
  get count() {
    return this.refs.filter((n) => n > 0).length
  }
}

type Edge = { v: [number, number]; t: [number, number] }

/** The edges of a vertex as the mesh lists them: the first eight in the order they came, the
 *  rest after them, the last added first; a removal closes the gap in order. */
export class EdgeList {
  private block: number[] = []
  private spill: number[] = []
  insert(e: number) {
    if (this.block.length < BLOCK) this.block.push(e)
    else this.spill.unshift(e)
  }
  remove(e: number) {
    const i = this.block.indexOf(e)
    if (i >= 0) {
      this.block.splice(i, 1)
      if (this.spill.length) this.block.push(this.spill.shift()!)
      return
    }
    const j = this.spill.indexOf(e)
    if (j >= 0) this.spill.splice(j, 1)
  }
  get values() {
    return this.spill.length ? [...this.block, ...this.spill] : this.block
  }
  get length() {
    return this.block.length + this.spill.length
  }
}
const BLOCK = 8

export class PatchMesh {
  position: number[][] = []
  triangle: [number, number, number][] = []
  triangleEdges: [number, number, number][] = []
  edge: Edge[] = []
  /** The edges of each vertex, in the order they were added. */
  vertexEdges: EdgeList[] = []
  readonly vertices = new Ids()
  readonly triangles = new Ids()
  readonly edges = new Ids()

  appendVertex(p: number[]) {
    const id = this.vertices.allocate()
    this.position[id] = p
    this.vertexEdges[id] = new EdgeList()
    return id
  }

  /** Appends triangle `tv`, its edges made or joined as its sides go round. */
  appendTriangle(tv: [number, number, number]) {
    const e = [0, 1, 2].map((i) => this.findEdge(tv[i], tv[(i + 1) % 3]))
    const tid = this.triangles.allocate()
    this.triangle[tid] = [...tv]
    for (const v of tv) this.vertices.increment(v)
    this.triangleEdges[tid] = [NONE, NONE, NONE]
    for (let j = 0; j < 3; j++) {
      const a = tv[j],
        b = tv[(j + 1) % 3]
      if (e[j] !== NONE) {
        this.edge[e[j]].t[1] = tid
        this.triangleEdges[tid][j] = e[j]
      } else this.triangleEdges[tid][j] = this.addEdge(a, b, tid)
    }
    return tid
  }

  addEdge(a: number, b: number, t0: number, t1 = NONE) {
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const id = this.edges.allocate()
    this.edge[id] = { v: [lo, hi], t: [t0, t1] }
    this.vertexEdges[lo].insert(id)
    this.vertexEdges[hi].insert(id)
    return id
  }

  findEdge(a: number, b: number) {
    for (const id of this.vertexEdges[a].values) if (this.otherVertex(id, a) === b) return id
    return NONE
  }
  otherVertex(e: number, v: number) {
    const [a, b] = this.edge[e].v
    return a === v ? b : a
  }
  isBoundaryEdge(e: number) {
    return this.edge[e].t[1] === NONE
  }
  isBoundaryVertex(v: number) {
    return this.vertexEdges[v].values.some((e) => this.isBoundaryEdge(e))
  }
  /** The vertex of triangle `t` that is neither `a` nor `b`. */
  third(t: number, a: number, b: number) {
    return this.triangle[t].find((v) => v !== a && v !== b)!
  }
  /** Where in triangle `t` the edge `(a, b)` runs, in either direction: the index of its first
   *  vertex among the triangle's three; -1 when `t` has no such edge. */
  private slotOf(t: number, a: number, b: number) {
    const tv = this.triangle[t]
    for (let i = 0; i < 3; i++) {
      const p = tv[i],
        q = tv[(i + 1) % 3]
      if ((p === a && q === b) || (p === b && q === a)) return i
    }
    return -1
  }
  /** Edge `(a, b)` oriented as triangle `t` winds it, and the vertex opposite it. */
  orient(a: number, b: number, t: number): [number, number, number] {
    const i = this.slotOf(t, a, b)
    if (i < 0) return [a, b, NONE]
    const tv = this.triangle[t]
    return tv[i] === a ? [a, b, tv[(i + 2) % 3]] : [b, a, tv[(i + 2) % 3]]
  }
  /** The vertices opposite edge `e`, in the order of its triangles. */
  opposing(e: number): [number, number] {
    const { v, t } = this.edge[e]
    return [this.third(t[0], v[0], v[1]), t[1] === NONE ? NONE : this.third(t[1], v[0], v[1])]
  }
  triangleEdgeOf(t: number, a: number, b: number) {
    const i = this.slotOf(t, a, b)
    return i < 0 ? NONE : this.triangleEdges[t][i]
  }

  /** The mean of the vertices an edge joins `v` to. */
  oneRingCentroid(v: number) {
    const sum = [0, 0, 0]
    for (const e of this.vertexEdges[v].values) {
      const p = this.position[this.otherVertex(e, v)]
      sum[0] += p[0]
      sum[1] += p[1]
      sum[2] += p[2]
    }
    const n = this.vertexEdges[v].length
    return n > 0 ? sum.map((x) => x * (1 / n)) : sum
  }

  otherTriangle(e: number, t: number) {
    const [u, w] = this.edge[e].t
    return u === t ? w : u
  }
  replaceEdgeVertex(e: number, old: number, next: number) {
    const [a, b] = this.edge[e].v
    const other = a === old ? b : a
    this.edge[e].v = other < next ? [other, next] : [next, other]
  }
  replaceEdgeTriangle(e: number, old: number, next: number) {
    const edge = this.edge[e]
    if (edge.t[0] === old) {
      if (next === NONE) edge.t = [edge.t[1], NONE]
      else edge.t[0] = next
    } else if (edge.t[1] === old) edge.t[1] = next
  }
  /** Puts vertex `next` in place of vertex `old` in triangle `t`. */
  replaceTriangleVertex(t: number, old: number, next: number) {
    this.triangle[t] = this.triangle[t].map((v) => (v === old ? next : v)) as [
      number,
      number,
      number,
    ]
  }
  replaceTriangleEdge(t: number, old: number, next: number) {
    const te = this.triangleEdges[t]
    const i = te.indexOf(old)
    if (i >= 0) te[i] = next
  }

  /** Flips the interior edge `e`; false when the edge across already exists or `e` is a border. */
  flipEdge(e: number) {
    if (!this.edges.valid(e) || this.isBoundaryEdge(e)) return false
    const [low, high] = this.edge[e].v
    const [t0, t1] = this.edge[e].t
    const [a, b, c] = this.orient(low, high, t0)
    const d = this.third(t1, a, b)
    if (c === NONE || d === NONE || this.findEdge(c, d) !== NONE) return false
    const ebc = this.triangleEdgeOf(t0, b, c),
      eca = this.triangleEdgeOf(t0, c, a),
      ead = this.triangleEdgeOf(t1, a, d),
      edb = this.triangleEdgeOf(t1, d, b)
    this.triangle[t0] = [c, d, b]
    this.triangle[t1] = [d, c, a]
    this.edge[e] = { v: c < d ? [c, d] : [d, c], t: [t0, t1] }
    this.replaceEdgeTriangle(eca, t0, t1)
    this.replaceEdgeTriangle(edb, t1, t0)
    this.triangleEdges[t0] = [e, edb, ebc]
    this.triangleEdges[t1] = [e, eca, ead]
    this.vertexEdges[a].remove(e)
    this.vertexEdges[b].remove(e)
    this.vertices.decrement(a)
    this.vertices.decrement(b)
    this.vertexEdges[c].insert(e)
    this.vertexEdges[d].insert(e)
    this.vertices.increment(c)
    this.vertices.increment(d)
    return true
  }

  /** Splits edge `e` at `t` of the way from its lower vertex to its higher. */
  splitEdge(e: number, t: number) {
    const [lower, higher] = this.edge[e].v
    const t0 = this.edge[e].t[0],
      t1 = this.edge[e].t[1]
    const [a, b, c] = this.orient(lower, higher, t0)
    const along = a === lower ? t : 1 - t
    const f = this.appendVertex(this.position[a].map((x, i) => lerp(x, this.position[b][i], along)))
    const ebc = this.triangleEdgeOf(t0, b, c)
    if (t1 === NONE) {
      this.replaceTriangleVertex(t0, b, f)
      const t2 = this.newTriangle([f, b, c])
      this.replaceEdgeTriangle(ebc, t0, t2)
      this.replaceEdgeVertex(e, b, f)
      this.vertexEdges[b].remove(e)
      this.vertexEdges[f].insert(e)
      const efb = this.addEdge(f, b, t2)
      const efc = this.addEdge(f, c, t0, t2)
      this.replaceTriangleEdge(t0, ebc, efc)
      this.triangleEdges[t2] = [efb, ebc, efc]
      this.vertices.increment(c)
      this.vertices.increment(f, 2)
      return
    }
    const d = this.third(t1, a, b)
    const edb = this.triangleEdgeOf(t1, d, b)
    for (const tt of [t0, t1]) this.replaceTriangleVertex(tt, b, f)
    const t2 = this.newTriangle([f, b, c]),
      t3 = this.newTriangle([f, d, b])
    this.replaceEdgeTriangle(ebc, t0, t2)
    this.replaceEdgeTriangle(edb, t1, t3)
    this.replaceEdgeVertex(e, b, f)
    this.vertexEdges[b].remove(e)
    this.vertexEdges[f].insert(e)
    const efb = this.addEdge(f, b, t2, t3)
    const efc = this.addEdge(f, c, t0, t2)
    const edf = this.addEdge(d, f, t1, t3)
    this.replaceTriangleEdge(t0, ebc, efc)
    this.replaceTriangleEdge(t1, edb, edf)
    this.triangleEdges[t2] = [efb, ebc, efc]
    this.triangleEdges[t3] = [edf, edb, efb]
    this.vertices.increment(c)
    this.vertices.increment(d)
    this.vertices.increment(f, 4)
  }

  newTriangle(tv: [number, number, number]) {
    const id = this.triangles.allocate()
    this.triangle[id] = tv
    this.triangleEdges[id] = [NONE, NONE, NONE]
    return id
  }
}
