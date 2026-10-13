import { transformAffinePoint } from '../../../math/src/vector/vector.ts'
import type { Object3D } from '../world/object/object3d.ts'
import type { Mesh } from '../world/object/mesh.ts'

/**
 * THE ONE RULE OF WHAT A SCENE QUERY READS — a raycast: `visit` is called on
 * every node under `roots`, parents first, except the nodes `skip` names — the marks a page works
 * with, never its content — and, when `visibleOnly`, the hidden ones, each with its subtree. A
 * root under a skipped or, when `visibleOnly`, a hidden ancestor is read as its ancestors are.
 */
export function forEachReadNode(
  roots: Object3D | readonly Object3D[],
  rule: { skip?: (node: Object3D) => boolean; visibleOnly?: boolean },
  visit: (node: Object3D) => void,
) {
  const { skip = () => false, visibleOnly = false } = rule
  const read = (node: Object3D) => !skip(node) && (!visibleOnly || node.visible)
  const walk = (node: Object3D) => {
    if (!read(node)) return
    visit(node)
    for (const child of node.children) walk(child)
  }
  const list = (Array.isArray(roots) ? roots : [roots]) as readonly Object3D[]
  for (const root of list) {
    let shown = true
    for (let at = root.parent; at && shown; at = at.parent) shown = read(at)
    if (shown) walk(root)
  }
}

const corner = new Float64Array(3)

/** One mesh's triangles, nine numbers each, moved by the column-major `matrix` — its world matrix
 *  for a collision world — or as they are stored when it is `null`; `null` for anything but a
 *  triangle mesh with a position list. */
export function meshTriangles(node: Mesh, matrix: ArrayLike<number> | null) {
  if (!node.isMesh || node.primitive !== 'triangles') return null
  const position = node.geometry.attributes.position,
    index = node.geometry.index
  if (!position) return null
  const corners = index ? index.count : position.count,
    count = Math.floor(corners / 3)
  const out = new Float32Array(count * 9),
    { array, itemSize } = position
  for (let i = 0; i < count * 3; i++) {
    const vertex = index ? index.array[i] : i,
      from = vertex * itemSize
    if (matrix) {
      transformAffinePoint(corner, matrix, array[from], array[from + 1], array[from + 2])
      out.set(corner, 3 * i)
    } else for (let k = 0; k < 3; k++) out[3 * i + k] = array[from + k]
  }
  return out
}
