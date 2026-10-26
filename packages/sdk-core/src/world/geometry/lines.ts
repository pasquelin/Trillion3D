import { dotVector3, normalizeVector3 } from '../../../../math/src/vector/vector.ts'
import { triangleCross } from '../../../../math/src/geometry/triangle.ts'
import { BufferAttribute } from '../buffer/attribute.ts'
import { Geometry } from './geometry.ts'
import { pointAt } from './bounds.ts'
import { DEG2RAD } from '../../../../math/src/constants.ts'

/** Every triangle edge of `geometry` once, as `[a, b]` corner pairs and, when `faceNormals` is set,
 *  the unit normals of the faces it borders; of the triangles `corners` make when given (a
 *  wireframe's drawn range). */
export function edgesOf(geometry: Geometry, corners?: ArrayLike<number>, faceNormals = true) {
  const position = geometry.attributes.position
  const count = position?.count ?? 0
  corners ??= geometry.index?.array ?? Array.from({ length: count }, (_, i) => i)
  // Corners that share a position share an edge, whatever their other attributes: each corner
  // is welded to the first one at its position, once, and an edge is its two welded corners.
  const byPosition = new Map<string, number>()
  const welded = new Int32Array(count).fill(-1)
  const weld = (v: number) => {
    let id = welded[v]
    if (id < 0) {
      const [x, y, z] = pointAt(position, v)
      const key = `${x},${y},${z}`
      const known = byPosition.get(key)
      id = known ?? byPosition.size
      if (known === undefined) byPosition.set(key, id)
      welded[v] = id
    }
    return id
  }
  const edges = new Map<number, { a: number; b: number; normals: number[][] }>()
  for (let t = 0; t + 2 < corners.length; t += 3) {
    let n: number[] | undefined
    if (faceNormals) {
      n = triangleCross(
        [0, 0, 0],
        0,
        [corners[t], corners[t + 1], corners[t + 2]].flatMap((v) => pointAt(position, v)),
        0,
        3,
        6,
      )
      normalizeVector3(n)
    }
    for (let k = 0; k < 3; k++) {
      const a = corners[t + k],
        b = corners[t + ((k + 1) % 3)]
      const [wa, wb] = [weld(a), weld(b)]
      const id = Math.min(wa, wb) * count + Math.max(wa, wb)
      const edge = edges.get(id) ?? { a, b, normals: [] }
      if (n) edge.normals.push(n)
      edges.set(id, edge)
    }
  }
  return edges
}

/** Line-segment geometry of the chosen edges: two positions per segment; every edge when `keep` is
 *  left out (the face normals `keep` reads are then not made). */
function segments(geometry: Geometry, keep?: (normals: number[][]) => boolean) {
  const position = geometry.attributes.position
  const picked = [...edgesOf(geometry, undefined, !!keep).values()].filter(
    ({ normals }) => !keep || keep(normals),
  )
  const out = new Float32Array(picked.length * 6)
  picked.forEach(({ a, b }, i) => {
    out.set(pointAt(position, a), i * 6)
    out.set(pointAt(position, b), i * 6 + 3)
  })
  const lines = new Geometry()
  lines.setAttribute('position', new BufferAttribute(out, 3))
  return lines
}

/**
 * The edges where the surface folds by more than `thresholdAngle` degrees, and its borders.
 * @param geometry - The shape whose edges are drawn.
 * @param thresholdAngle - Least angle between two faces, in degrees, for their shared edge to show.
 */
export function edges(geometry: Geometry, thresholdAngle = 1) {
  const limit = Math.cos(thresholdAngle * DEG2RAD)
  return segments(
    geometry,
    (normals) => normals.length < 2 || dotVector3(normals[0], normals[1]) <= limit,
  )
}

/**
 * Every edge of every triangle, once.
 * @param geometry - The shape whose triangle edges are drawn.
 */
export function wireframe(geometry: Geometry) {
  return segments(geometry)
}
