import { EngineError, copyMatrix4 } from '../../../../../sdk-core/src/index.ts';
import { rootedUnder } from '../../../host/world/chain.ts';
import { namedNode, poseNode } from '../../../host/world/moveByName.ts';
import { finishMoves, noteMoved } from './movedBatch.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

const request = new Float32Array(16);

/** Moves a named node of the prepared scene (R8): the move of `setWebgpuTransforms` on the node the
 *  name index finds (`host/world/nameIndex.ts`). A host moving nodes frame after frame resolves them once. */
export function setWebgpuTransform(rt: WebgpuPagesRuntime, nodeName: string, matrix: Float32Array) {
  const node = namedNode(rt.setup.source, nodeName, matrix);
  try {
    moveNode(rt, node, matrix, rt.run.gate.engineWriting());
  } finally {
    finishMoves(rt);
  }
}

/**
 * Moves nodes the host holds — handles, no name looked up — to column-major WORLD poses, sixteen
 * floats per node in the same order (#971, CPU-19). Each node is posed as its own call would, in
 * order, so a node reads the poses the nodes before it set; its subtree alone is passed again.
 * Boxes, rows, the scene revision and the shadow boxes follow once for the call (`movedBatch.ts`).
 * A refused node throws once the nodes before it took effect, as the calls one by one would.
 *
 * Nothing is drawn here: the moves take effect at the next image, with no per-image allocation.
 */
export function setWebgpuTransforms(
  rt: WebgpuPagesRuntime,
  nodes: readonly Object3D[],
  matrices: Float32Array,
) {
  if (matrices.length !== nodes.length * 16)
    throw new EngineError('INVALID_TRANSFORM', `${nodes.length} nodes: sixteen floats each`, {
      length: matrices.length,
    });
  // A host pose written in this same task is read before the engine's own write hides it: the
  // first move then passes the whole index, which leaves it current for the moves after it.
  let wholePass = rt.run.gate.engineWriting();
  try {
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k];
      // A handle outlives nothing: a node the host removed from the scene is refused by name.
      if (!rootedUnder(node, rt.setup.source))
        throw new EngineError(
          'UNKNOWN_SCENE_NODE',
          `node ${node.name} missing from the prepared scene`,
          { nodeName: node.name },
        );
      copyMatrix4(request, matrices, 0, k * 16);
      if (moveNode(rt, node, request, wholePass)) wholePass = false;
    }
  } finally {
    finishMoves(rt);
  }
}

/** One node posed, noted for `finishMoves`, and the engine index passed again; false when that
 *  moves nothing. The engine index takes the pose, and every matrix it holds — page records,
 *  selection roots, transparent copies — carries the new place at that instant. With no host
 *  write owed, only the moved subtree and its ancestors have new inputs (`refreshFrom`). A matrix
 *  set by hand elsewhere is announced by the next image's scan, whose walk runs first. */
function moveNode(
  rt: WebgpuPagesRuntime,
  node: Object3D,
  matrix: Float32Array,
  wholePass: boolean,
) {
  const worlds = rt.setup.worlds;
  if (!poseNode(worlds, node, matrix, !wholePass)) return false;
  noteMoved(rt, node);
  if (wholePass) worlds.refresh();
  else worlds.refreshFrom(node);
  return true;
}
