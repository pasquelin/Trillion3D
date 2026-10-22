import { NONE, type Ids, type PatchMesh } from './patchMesh.ts'

/** The valid vertices, then the valid triangles, of `m` moved down into the holes freed ones left:
 *  the last valid one into the first hole, as many times as it takes. */
export function compact(m: PatchMesh) {
  const shift = (ids: Ids, move: (from: number, to: number) => void) => {
    let last = ids.max - 1,
      cur = 0
    while (last >= 0 && !ids.valid(last)) last--
    while (cur < last && ids.valid(cur)) cur++
    while (cur < last) {
      move(last, cur)
      ids.refs[cur] = ids.refs[last]
      ids.refs[last] = 0
      last--
      cur++
      while (last >= 0 && !ids.valid(last)) last--
      while (cur < last && ids.valid(cur)) cur++
    }
    ids.refs.length = ids.count
  }
  shift(m.vertices, (from, to) => {
    m.position[to] = m.position[from]
    for (const e of m.vertexEdges[from].values) {
      m.replaceEdgeVertex(e, from, to)
      for (const t of m.edge[e].t)
        if (t !== NONE)
          m.triangle[t] = m.triangle[t].map((v) => (v === from ? to : v)) as [
            number,
            number,
            number,
          ]
    }
    m.vertexEdges[to] = m.vertexEdges[from]
  })
  m.position.length = m.vertices.count
  shift(m.triangles, (from, to) => {
    m.triangle[to] = m.triangle[from]
    m.triangleEdges[to] = m.triangleEdges[from]
    for (const e of m.triangleEdges[to]) m.replaceEdgeTriangle(e, from, to)
  })
  m.triangle.length = m.triangles.count
}
