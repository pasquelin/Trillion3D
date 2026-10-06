import type { ClusterRoot } from '../../../page/selection/types.ts'
import type { PageRec } from '../../../page/selection/selection.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'

type Roots = readonly ClusterRoot<PageRec>[]

/** Selection-root ranks by source mesh, built once per root list, again once it grew in place. */
const rootsByMeshOf = new WeakMap<Roots, Map<Object3D, number[]>>()

/** `roots` grew in place (`../../../placement/webgpuGrowth.ts`): its index is built at the next
 *  move. */
export const forgetRootsByMesh = (roots: Roots) => void rootsByMeshOf.delete(roots)

function rootsByMesh(roots: Roots) {
  let map = rootsByMeshOf.get(roots)
  if (map) return map
  map = new Map()
  for (let i = 0; i < roots.length; i++) {
    const mesh = roots[i].pages[0]?.sourceMesh as Object3D | undefined
    if (!mesh) continue
    const list = map.get(mesh)
    if (list) list.push(i)
    else map.set(mesh, [i])
  }
  rootsByMeshOf.set(roots, map)
  return map
}

/**
 * Ranks of the roots whose source mesh is `node` or lies below it, each once, in the walk's order,
 * written into `out` from `at` on; returns where they end. The node's LIVE subtree is walked once:
 * the same relation as climbing each root's parent chain up to the node. `out` is never
 * truncated: it keeps its storage and grows only past its length.
 */
export function appendRootsUnder(roots: Roots, node: Object3D, out: number[], at: number) {
  walking = rootsByMesh(roots)
  found = out
  count = at
  node.traverse(collect)
  // Let go of the layout's meshes and the list: a released scene is not kept alive by the last move.
  walking = NONE
  found = EMPTY
  return count
}

// The walk's state and its one callback, declared once: a move allocates no closure.
const NONE = new Map<Object3D, number[]>(),
  EMPTY: number[] = []
let walking = NONE,
  found = EMPTY,
  count = 0
const collect = (walk: Object3D) => {
  const list = walking.get(walk)
  if (list) for (const i of list) found[count++] = i
}
