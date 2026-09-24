import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { HostGraphNode } from '../../host/scene/graphNodes.ts';

/** The graph node each scene node of a loaded model stands for. */
const sources = new WeakMap<Object3D, HostGraphNode>();

/**
 * A loaded model's source graph as scene nodes: one per graph node, named and posed as it, in
 * the same tree. A page finds them by name (`getObjectByName`) and moves them like its own; a
 * move is written back into the graph node the model is drawn from (`writeModelNode`).
 */
export function modelNodes(graph: HostGraphNode): Object3D {
  const node = new Object3D();
  node.name = graph.name;
  node.position.set(graph.position.x, graph.position.y, graph.position.z);
  const { x, y, z, w } = graph.quaternion;
  node.quaternion.set(x, y, z, w);
  node.scale.set(graph.scale.x, graph.scale.y, graph.scale.z);
  node.visible = graph.visible;
  for (const child of graph.children) node.add(modelNodes(child));
  sources.set(node, graph);
  return node;
}

/**
 * Writes a moved scene node of a loaded model into its graph node; any other node is left.
 * The two trees have the same shape, so the local pose is copied as it stands; the engine reads
 * the write as it reads any host pose. A graph node whose matrix is its pose takes the matrix.
 */
export function writeModelNode(node: Object3D) {
  const graph = sources.get(node);
  if (!graph) return;
  graph.position.set(node.position.x, node.position.y, node.position.z);
  const { x, y, z, w } = node.quaternion;
  graph.quaternion.set(x, y, z, w);
  graph.scale.set(node.scale.x, node.scale.y, node.scale.z);
  graph.visible = node.visible;
  if (!graph.matrixAutoUpdate) graph.matrix.fromArray(node.matrix.elements);
}
