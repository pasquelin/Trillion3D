/** The transform tree: the engine's scene graph, data-oriented, and its batches. */
const T = {
  section: 'tree',
  kind: 'Function',
  module: 'packages/sdk-core/mathTransformTree.ts',
};
const BATCH = { section: 'batches', kind: 'Function', module: 'packages/sdk-core/mathBatch.ts' };

export const TREE = [
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
    module: 'packages/sdk-core/mathTransformTreeStructure.ts',
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
    module: 'packages/sdk-core/mathTransformTreeUpdate.ts',
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
    module: 'packages/sdk-core/mathTransformTreeRead.ts',
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
    module: 'packages/sdk-core/mathTransformTreeLookAt.ts',
    signature: 'lookAtNode(tree, node, x, y, z, up, viewer)',
    description:
      "Turns `node` toward the world point `(x, y, z)`. `viewer` is true for a camera or a light, which look toward their `−z`, false for an object, which presents its `+z`. `up` is the node's up, `(0, 1, 0)` in the reference. Ancestors and the node are updated first.",
    replaces: 'Object3D.lookAt',
  },
];

export const BATCHES = [
  {
    ...BATCH,
    id: 'multiplyMatrix4Batch',
    exports: ['multiplyMatrix4Batch'],
    title: 'multiplyMatrix4Batch()',
    signature: 'multiplyMatrix4Batch(out: Float64Array[], a: Float64Array[], b: Float64Array[], n)',
    description:
      '`n` products `out[i] = a[i] · b[i]`, all three sides given as sub-views of sixteen numbers. The sub-views are built once, never per frame; a WebAssembly kernel repeats the same formula term by term and the governor picks whichever path is measured faster.',
    replaces: 'a loop of Matrix4.multiplyMatrices',
  },
  {
    ...BATCH,
    id: 'boxTransformBatch',
    exports: ['boxTransformBatch'],
    title: 'boxTransformBatch()',
    signature: 'boxTransformBatch(out: Float64Array, boxes, mats: ArrayLike<number>[], n)',
    description:
      '`n` boxes transformed by `n` matrices: `out[i] = boxTransform(boxes[i], mats[i])`. `out` and `boxes` carry six numbers per element, `mats` a sub-view of sixteen.',
    replaces: 'a loop of Box3.applyMatrix4',
  },
  {
    ...BATCH,
    id: 'hierarchyUpdateBatch',
    exports: [
      'hierarchyUpdateBatch',
      'HIERARCHY_ROOT',
      'MATRIX_VALUES',
      'POSITION_VALUES',
      'QUATERNION_VALUES',
    ],
    title: 'hierarchyUpdateBatch()',
    signature:
      'hierarchyUpdateBatch(worldViews, positions, rotations, scales, parents: Uint32Array, n, local)\nHIERARCHY_ROOT = 0xffffffff · MATRIX_VALUES = 16 · POSITION_VALUES = 3 · QUATERNION_VALUES = 4',
    description:
      "A full hierarchy updated in one pass: `n` nodes ordered parents before children, each composing its local matrix then multiplying it by its parent's world matrix — the traversal of `mathTransformTreeUpdate.ts`, the same two formulas in the same order, on flat buffers. `parents[i]` **must** index an already updated node, hence strictly less than `i`; any other value — the `HIERARCHY_ROOT` sentinel included — makes the node a root whose world matrix is its local matrix. The rule is identical on both paths: no input, however hostile, can make them diverge. `local` is one scratch matrix, reused by every element.",
    replaces: 'Object3D.updateMatrixWorld over a whole scene',
  },
  {
    ...BATCH,
    id: 'createPathGovernor',
    exports: ['createPathGovernor', 'PATH_MIN_SAMPLES', 'PATH_SWITCH_RUNS', 'PATH_EXPLORE_EVERY'],
    title: 'createPathGovernor()',
    module: 'packages/sdk-core/mathPathGovernor.ts',
    signature:
      "createPathGovernor(now: () => number, mode: MathPathMode = 'auto'): PathGovernor\nPATH_MIN_SAMPLES = 5 · PATH_SWITCH_RUNS = 5 · PATH_EXPLORE_EVERY = 50",
    description:
      'What arbitrates JS against WebAssembly, per named operation: sliding medians of nanoseconds per element, a switch only after five consecutive executions at that lead, and one execution in fifty replaying the other path to refresh its median. Under five samples nothing is decided — a single value would make the median. `metrics()` publishes, per operation, `path`, `jsNsPerElement`, `wasmNsPerElement`, the switch count, and the clock resolution the measurement rests on.',
  },
  {
    ...BATCH,
    id: 'batch-api',
    title: 'The batch API for hosts',
    issue: 80,
    signature:
      'frustumExcludesBoxBatch · invertMatrix4Batch · normalMatrix3Batch · composeMatrix4Batch · decomposeMatrix4Batch\ntransformPointsBatch · transformPointsByMatricesBatch · transformDirectionsBatch\nboxUnionBatch · boxTransformUnionBatch · sphereFromBoundsBatch\nsrgbToLinearBatch · linearToSrgbBatch · nodeWorldFramesBatch',
    description:
      'The batches a host asks for — `n` elements, one call, flat typed arrays, zero allocation — are the work of issue #80, and the three above are the foundation they extend. The order is fixed: the CPU shares of the per-element loops are measured first, and **a batch is only implemented if its loop\'s share is measured**; a loop below the run-to-run spread is recorded as "not worth a batch" and left alone. A WebAssembly kernel follows for every batch whose JS path measures above 0.1 ms per frame, JS staying the reference and the fallback. `hierarchySubtreeUpdate`, the targeted subtree update, is issue #60.',
  },
];
