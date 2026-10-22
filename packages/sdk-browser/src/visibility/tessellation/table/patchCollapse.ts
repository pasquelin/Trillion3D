import { lerp } from '../../../../../math/src/scalar/reals.ts'
import { EdgeList, NONE, type PatchMesh } from './patchMesh.ts'

/** Whether edge `a`-`b`'s collapse into `b` leaves a manifold mesh, and the neighbourhood it
 *  would act on. */
function collapsible(m: PatchMesh, b: number, a: number) {
  const eab = m.findEdge(a, b)
  if (eab === NONE) return undefined
  const t0 = m.edge[eab].t[0],
    t1 = m.edge[eab].t[1]
  if (t0 === NONE) return undefined
  const c = m.third(t0, a, b)
  const boundary = t1 === NONE
  const d = boundary ? NONE : m.third(t1, a, b)
  if (!boundary && c === d) return undefined
  let eac = NONE,
    ead = NONE
  for (const ea of m.vertexEdges[a].values) {
    const x = m.otherVertex(ea, a)
    if (x === c) eac = ea
    else if (x === d) ead = ea
    else if (x !== b && m.vertexEdges[b].values.some((eb) => m.otherVertex(eb, b) === x))
      return undefined
  }
  if (!boundary && m.vertexEdges[a].length === 3) {
    const edc = m.findEdge(d, c)
    if (edc !== NONE && m.edge[edc].t[1] !== NONE) {
      const [u, w] = m.edge[edc].t
      const has = (t: number, v: number) => m.triangle[t].includes(v)
      if ((has(u, a) && has(w, b)) || (has(u, b) && has(w, a))) return undefined
    }
  } else if (boundary && eac !== NONE && m.isBoundaryEdge(eac)) {
    const ebc = m.triangleEdgeOf(t0, b, c)
    if (m.isBoundaryEdge(ebc)) return undefined
  }
  if (!boundary && m.isBoundaryVertex(a) && m.isBoundaryVertex(b)) return undefined
  return { eab, t0, t1, c, d, eac, ead, boundary }
}

/** Collapses the edge `keep`-`remove` of `m` into `keep`, moved to `t` of the way to `remove`:
 *  false, and nothing changed, when that would leave a mesh that is not a manifold. */
export function collapseEdge(m: PatchMesh, keep: number, remove: number, t: number) {
  const info = collapsible(m, keep, remove)
  if (!info) return false
  const { eab, t0, t1, c, d, eac, ead, boundary } = info
  const [a, b] = [remove, keep]
  const keptPosition = m.position[b],
    removedPosition = m.position[a]
  let tad = NONE,
    tac = NONE
  for (const eid of [...m.vertexEdges[a].values]) {
    const o = m.otherVertex(eid, a)
    if (o === b) m.vertexEdges[b].remove(eid)
    else if (o === c) {
      m.vertexEdges[c].remove(eid)
      tac = m.otherTriangle(eid, t0)
    } else if (o === d) {
      m.vertexEdges[d].remove(eid)
      tad = m.otherTriangle(eid, t1)
    } else {
      m.replaceEdgeVertex(eid, a, b)
      m.vertexEdges[b].insert(eid)
    }
    for (const tj of m.edge[eid].t)
      if (tj !== NONE && tj !== t0 && tj !== t1 && m.triangle[tj].includes(a)) {
        m.triangle[tj] = m.triangle[tj].map((v) => (v === a ? b : v)) as [number, number, number]
        m.vertices.increment(b)
        m.vertices.decrement(a)
      }
  }
  m.vertexEdges[a] = new EdgeList()
  if (!boundary) {
    m.vertices.decrement(a, 3)
    m.triangles.decrement(t0)
    m.triangles.decrement(t1)
    m.vertices.decrement(c)
    m.vertices.decrement(d)
    m.vertices.decrement(b, 2)
    m.edges.decrement(ead)
    m.edges.decrement(eab)
    m.edges.decrement(eac)
    const ebd = m.triangleEdgeOf(t1, b, d),
      ebc = m.triangleEdgeOf(t0, b, c)
    m.replaceEdgeTriangle(ebd, t1, tad)
    m.replaceEdgeTriangle(ebc, t0, tac)
    if (tad !== NONE) m.replaceTriangleEdge(tad, ead, ebd)
    if (tac !== NONE) m.replaceTriangleEdge(tac, eac, ebc)
  } else {
    m.vertices.decrement(a, 2)
    m.triangles.decrement(t0)
    m.vertices.decrement(c)
    m.vertices.decrement(b)
    m.edges.decrement(eab)
    m.edges.decrement(eac)
    const ebc = m.triangleEdgeOf(t0, b, c)
    m.replaceEdgeTriangle(ebc, t0, tac)
    if (tac !== NONE) m.replaceTriangleEdge(tac, eac, ebc)
  }
  m.position[b] = keptPosition.map((x, i) => lerp(x, removedPosition[i], t))
  return true
}
