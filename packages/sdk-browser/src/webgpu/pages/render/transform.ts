import {
  EngineError,
  copyMatrix4,
  decomposeMatrix4,
  determinantMatrix4,
  invertMatrix4,
  multiplyMatrix4,
} from '../../../../../sdk-core/src/index.ts';
import { assertFiniteTransform, hostLocalInto } from '../../../host/world/matrices.ts';
import { hostWorldChainInto, rootedUnder } from '../../../host/world/chain.ts';
import { copyElements, sameElements } from '../../../math/matrixElements.ts';
import { findNode } from './movedNode.ts';
import { finishMoves, noteMoved } from './movedBatch.ts';
import type { HostWorldPlacements } from '../../../host/world/placements.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

const local = new Float64Array(16),
  current = new Float64Array(16),
  parentWorld = new Float64Array(16),
  parentInverse = new Float64Array(16),
  trs = new Float64Array(3),
  trsRotation = new Float64Array(4),
  trsScale = new Float64Array(3),
  request = new Float32Array(16);

/** True when `world`, rounded to single precision, is `matrix`. */
function standsAt(world: Float64Array, matrix: Float32Array) {
  for (let i = 0; i < 16; i++) if (Math.fround(world[i]) !== matrix[i]) return false;
  return true;
}

/** Moves a named node of the prepared scene (R8): the move of `setWebgpuTransforms` on the node the
 *  name index finds (`movedNode.ts`). A host moving nodes frame after frame resolves them once. */
export function setWebgpuTransform(rt: WebgpuPagesRuntime, nodeName: string, matrix: Float32Array) {
  if (matrix.length !== 16)
    throw new EngineError('INVALID_TRANSFORM', `${nodeName}: sixteen floats expected`, {
      length: matrix.length,
    });
  const node = findNode(rt.setup.source, nodeName);
  if (!node)
    throw new EngineError(
      'UNKNOWN_SCENE_NODE',
      `node ${nodeName} missing from the prepared scene`,
      {
        nodeName,
      },
    );
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

/**
 * Sets the local pose of `node` so that its world is `matrix`: brought back into the parent's
 * space, then set as-is as the local matrix, so that `updateMatrixWorld` finds it identical.
 * False when that moves nothing. `held`: no host write is owed, the engine tree mirrors the host.
 */
function poseNode(
  worlds: HostWorldPlacements,
  node: Object3D,
  matrix: Float32Array,
  held: boolean,
) {
  // A non-finite pose is refused here, before any inversion: further on it would become a NaN
  // world matrix, then a null normal, then a black surface with no readable cause.
  assertFiniteTransform(matrix, node.name);
  // The requested pose is a WORLD pose: bringing it back into the parent's space needs the
  // parent's world matrix, and the host is allowed to have written a local pose above without
  // climbing the graph. The engine reads it from ITS tree when that tree is current (#971,
  // `host/world/pose.ts`), and otherwise computes it from the local poses of the ancestor chain
  // (`../../../host/world/chain.ts`): the same bits, nothing asked of the host or written to it.
  // Without that, inversion would bear on a stale parent — a child requested at x = 3 under a
  // parent that moved to x = 10 would end at x = 13 — and the comparisons that follow would judge
  // "no effect" a request remade after the parent moved. It therefore precedes them.
  const parent = node.parent,
    above = parent
      ? ((held ? worlds.parentWorld(node) : null) ?? hostWorldChainInto(parentWorld, parent))
      : null;
  // The world the node already stands at, to the precision the request carries: moving it there
  // moves nothing — a node's first write included, which the local comparison below cannot judge.
  hostLocalInto(current, node);
  if (above) multiplyMatrix4(current, above, current);
  if (standsAt(current, matrix)) return false;
  copyElements(local, matrix);
  if (parent && above) {
    // A parent flattened onto a plane or a line has no inverse: the base would yield sixteen
    // zeros and the node would silently leave for the origin. The determinant is the only test
    // that distinguishes this case from the exit, and it also catches a non-finite matrix.
    const parentDeterminant = determinantMatrix4(above);
    if (parentDeterminant === 0 || !Number.isFinite(parentDeterminant))
      throw new EngineError(
        'SINGULAR_PARENT_TRANSFORM',
        `${node.name}: parent world matrix not invertible`,
        { nodeName: node.name, parentName: parent.name, determinant: parentDeterminant },
      );
    invertMatrix4(parentInverse, above);
    multiplyMatrix4(local, parentInverse, local);
  }
  // A pose identical to the one this node already carries — and set from here, hence
  // `matrixAutoUpdate` false — changes no world matrix: declaring it changed would invalidate
  // shadow pages and refuse the held image for a result identical to the pixel. A host's direct
  // write leaves `node.matrix` different and therefore takes the full path again. `local` is
  // expressed in the parent space JUST RESOLVED: a moved parent gives another `local` for the
  // same requested world pose, and the request is therefore not judged as no-effect.
  if (!node.matrixAutoUpdate && sameElements(node.matrix.elements, local)) return false;
  // The local matrix is authoritative, not the three fields: not every matrix is a
  // translation-rotation-scale product. A shear — two non-orthogonal axes, which a non-uniform
  // scale under a rotation produces — does not decompose into it, and `updateMatrixWorld` would
  // recompose `matrix` from `position`, `quaternion` and `scale` over the one set here, leaving
  // the engine drawing another transform than the one requested. Cutting recomposition on the
  // moved node alone is what keeps it intact. The base's decompose still fills the three fields,
  // at the same bits as `Matrix4.decompose`: exact without shear and approximate otherwise, for
  // whoever reads them.
  decomposeMatrix4(local, trs, trsRotation, trsScale);
  node.position.set(trs[0], trs[1], trs[2]);
  node.quaternion.set(trsRotation[0], trsRotation[1], trsRotation[2], trsRotation[3]);
  node.scale.set(trsScale[0], trsScale[1], trsScale[2]);
  copyElements(node.matrix.elements, local);
  node.matrixAutoUpdate = false;
  return true;
}
