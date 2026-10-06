import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { sphereFromBounds } from '../../../../sdk-core/src/math/primitives/sphere.ts'
import { emptyWorldBox, hostWorldBounds } from '../../host/world/bounds.ts'

/** A node that may carry a mesh's morph weights. */
type Weighted = { morphTargetInfluences?: number[] }

/** The graph node each scene node of a loaded model stands for. */
const sources = new WeakMap<Object3D, Object3D>()

/** The first graph node named `name` from `graph` down, depth first: a scene walk's order. */
export function findGraphNode(graph: Object3D, name: string): Object3D | undefined {
  if (graph.name === name) return graph
  for (const child of graph.children) {
    const found = findGraphNode(child, name)
    if (found) return found
  }
  return undefined
}

/**
 * One scene node standing for a graph node of a loaded model, named and posed as it, without
 * children: a model builds one only for a node a page looks up, and for its ancestors
 * (`LoadedModel.getObjectByName`), so a world of a million nodes holds none it was not asked
 * for. A move is written back into the graph node (`writeModelNode`).
 */
export function modelNode(graph: Object3D): Object3D {
  const node = new Object3D()
  node.name = graph.name
  // A graph node whose matrix is its pose may carry no pose fields: the matrix is read instead.
  if (graph.matrixAutoUpdate) {
    node.position.set(graph.position.x, graph.position.y, graph.position.z)
    const { x, y, z, w } = graph.quaternion
    node.quaternion.set(x, y, z, w)
    node.scale.set(graph.scale.x, graph.scale.y, graph.scale.z)
  } else graph.matrix.decompose(node.position, node.quaternion, node.scale)
  node.visible = graph.visible
  node.castShadow = graph.castShadow
  // A morphed mesh's weights are one list for both: a clip writing them moves the drawn mesh.
  const weights = (graph as Weighted).morphTargetInfluences
  if (weights) (node as Weighted).morphTargetInfluences = weights
  sources.set(node, graph)
  return node
}

/**
 * Writes a moved scene node of a loaded model into its graph node; any other node is left.
 * The two chains have the same shape, so the local pose is copied as it stands; the engine reads
 * the write as it reads any host pose. A graph node whose matrix is its pose takes the matrix.
 */
export function writeModelNode(node: Object3D) {
  const graph = sources.get(node)
  if (!graph) return
  graph.position.set(node.position.x, node.position.y, node.position.z)
  const { x, y, z, w } = node.quaternion
  graph.quaternion.set(x, y, z, w)
  graph.scale.set(node.scale.x, node.scale.y, node.scale.z)
  graph.visible = node.visible
  graph.castShadow = node.castShadow
  if (!graph.matrixAutoUpdate) graph.matrix.fromArray(node._matrixElements)
}

/** Each table of a model's nodes by source index (`graphSubtree`), the index of each node. */
const indexOfs = new WeakMap<readonly Object3D[], Map<Object3D, number>>()
const sphere = new Float64Array(4)

/**
 * The subtree of the graph node of source node `index` (`nodes`, by source index): the source
 * indices of the nodes it holds, itself included, and the radius of the box they draw in its
 * parent's frame (0 for none).
 */
export function graphSubtree(nodes: readonly Object3D[], index: number) {
  let indexOf = indexOfs.get(nodes)
  if (!indexOf) indexOfs.set(nodes, (indexOf = new Map(nodes.map((node, i) => [node, i]))))
  const indices: number[] = []
  nodes[index].traverse((node) => {
    const at = indexOf.get(node)
    if (at !== undefined) indices.push(at)
  })
  const b = hostWorldBounds(nodes[index], emptyWorldBox())
  sphereFromBounds(sphere, 0, b[0], b[1], b[2], b[3], b[4], b[5])
  return { indices, radius: Math.max(0, sphere[3]) }
}
