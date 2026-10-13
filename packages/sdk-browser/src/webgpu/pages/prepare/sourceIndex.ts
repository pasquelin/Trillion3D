import { preparedNodeRank } from '../../../host/prepared/sourceRanks.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'

const indexes = new WeakMap<WebgpuPagesRuntime, Map<number, Object3D>>()

/** Each ranked source node, indexed once per runtime. */
export function sourceNodes(rt: WebgpuPagesRuntime) {
  let nodes = indexes.get(rt)
  if (nodes) return nodes
  const found = new Map<number, Object3D>()
  const note = (node: Object3D) => {
    const rank = preparedNodeRank(node)
    if (rank !== undefined) found.set(rank, node)
  }
  rt.setup.source.traverse(note)
  // The meshes a source is drawn at rows from stand in the graph of their model, not in the scene.
  for (const { rows } of rt.setup.draws)
    for (const mesh of rows?.sources ?? []) if (mesh) note(mesh)
  indexes.set(rt, (nodes = found))
  return nodes
}
