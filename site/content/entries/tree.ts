import type { PortalEntry } from '../model.ts';

/** The transform tree: the engine's scene graph, data-oriented. */
const T = {
  section: 'tree',
  kind: 'Function',
  module: 'packages/sdk-core/src/math/transform-tree/transformTree.ts',
};

export const TREE: PortalEntry[] = [
  {
    ...T,
    id: 'createTransformTree',
    exports: ['createTransformTree', 'addTransformNode', 'TransformTree'],
    title: 'createTransformTree() · addTransformNode()',
    signature:
      'createTransformTree(capacity = 64): TransformTree\naddTransformNode(tree, parent = -1): number',
    description:
      "The engine transform hierarchy, data-oriented: a node is an index into flat arrays — parent, flags, position, quaternion `(x, y, z, w)`, scale, local matrix, world matrix. `localViews[i]` and `worldViews[i]` are sixteen-number views created at growth and never during an update: the GPU reads the whole buffer, a kernel reads a node's view. A fresh node is the reference's fresh object: zero position, identity rotation, scale 1, identity matrices, automatic update. A growth replaces every array, so a caller re-reads `tree.world` or `tree.worldViews` after an add.",
    replaces: 'new Object3D(), parent.add(child)',
  },
  {
    ...T,
    id: 'setNodePosition',
    exports: [
      'setNodePosition',
      'setNodeQuaternion',
      'setNodeScale',
      'setNodeLocalMatrix',
      'setNodeAutoUpdate',
    ],
    title: 'setNodePosition() · setNodeQuaternion() · setNodeScale() · setNodeLocalMatrix()',
    signature:
      'setNodePosition(tree, node, x, y, z)\nsetNodeQuaternion(tree, node, x, y, z, w)\nsetNodeScale(tree, node, x, y, z)\nsetNodeLocalMatrix(tree, node, m)\nsetNodeAutoUpdate(tree, node, auto)',
    description:
      'Writes go through the setters, which mark what they changed — that mark is what an update reads to decide whom to visit. Under automatic update the next update recomposes the local matrix from the pose, as the reference overwrites `matrix`; `setNodeAutoUpdate(tree, node, false)` keeps the matrix a caller wrote.',
    replaces: 'Object3D.position.set, quaternion.set, scale.set, matrix.copy, matrixAutoUpdate',
  },
  {
    ...T,
    id: 'reparentTransformNode',
    exports: ['reparentTransformNode', 'removeTransformNode'],
    title: 'reparentTransformNode() · removeTransformNode()',
    module: 'packages/sdk-core/src/math/transform-tree/structure.ts',
    signature: 'reparentTransformNode(tree, node, parent)\nremoveTransformNode(tree, node)',
    description:
      'Attaches `node` under `parent` (`-1`: a root) like the reference `add` — matrices do not move until the next update — and throws if `parent` is `node` or one of its descendants. Removing takes the node and all its descendants, their indices reused afterwards; to detach a subtree while keeping it, reparent it to `-1`.',
    replaces: 'Object3D.add, remove',
  },
  {
    ...T,
    id: 'updateNodeMatrixWorld',
    exports: ['updateNodeMatrixWorld', 'updateNodeWorldMatrix'],
    title: 'updateNodeMatrixWorld() · updateNodeWorldMatrix()',
    module: 'packages/sdk-core/src/math/transform-tree/update.ts',
    signature:
      'updateNodeMatrixWorld(tree, node, force = false)\nupdateNodeWorldMatrix(tree, node, updateParents, updateChildren)',
    description:
      'The node and its whole subtree, parents first. A node is reached if it updates automatically, if it is marked, or if `force`. The stamp of a visited node is `2 · traversal + reached`, so one read tells a child whether it is in the subtree and what its parent passes it. The second form also walks the ancestors from the root, when asked.',
    replaces: 'Object3D.updateMatrixWorld, updateWorldMatrix',
  },
  {
    ...T,
    id: 'nodeWorldPosition',
    exports: [
      'nodeWorldPosition',
      'nodeWorldQuaternion',
      'nodeWorldScale',
      'nodeWorldDirection',
      'nodeWorldMirrorsFaces',
    ],
    title: 'nodeWorldPosition() · nodeWorldQuaternion() · nodeWorldScale() · nodeWorldDirection()',
    module: 'packages/sdk-core/src/math/transform-tree/read.ts',
    signature:
      'nodeWorldPosition(out, tree, node)\nnodeWorldQuaternion(out, tree, node)\nnodeWorldScale(out, tree, node)\nnodeWorldDirection(out, tree, node, cameraForward)\nnodeWorldMirrorsFaces(tree, node)',
    description:
      'Reads of the world matrix: the translation column; the rotation and scale from its decomposition, a negative determinant carried by `x` alone; the third column normalised as a direction, flipped when `cameraForward` — a camera and a light look toward their `−z`. `nodeWorldMirrorsFaces` is true when the world matrix reverses orientation, and the draw then swaps its front and back faces; it reads as-is, without update, and a zero or NaN determinant reverses nothing.',
    replaces: 'getWorldPosition, getWorldQuaternion, getWorldScale, getWorldDirection',
  },
  {
    ...T,
    id: 'lookAtNode',
    exports: ['lookAtNode'],
    title: 'lookAtNode()',
    module: 'packages/sdk-core/src/math/transform-tree/lookAt.ts',
    signature: 'lookAtNode(tree, node, x, y, z, up, viewer)',
    description:
      "Turns `node` toward the world point `(x, y, z)`. `viewer` is true for a camera or a light, which look toward their `−z`, false for an object, which presents its `+z`. `up` is the node's up, `(0, 1, 0)` in the reference. Ancestors and the node are updated first.",
    replaces: 'Object3D.lookAt',
  },
];
