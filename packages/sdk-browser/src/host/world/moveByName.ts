import {
  EngineError,
  decomposeMatrix4,
  determinantMatrix4,
  invertMatrix4,
  multiplyMatrix4,
} from '../../../../sdk-core/src/index.ts';
import { assertFiniteTransform, hostLocalInto } from './matrices.ts';
import { hostWorldChainInto } from './chain.ts';
import { copyElements, sameElements } from '../../math/matrixElements.ts';
import { findNode } from './nameIndex.ts';
import type { HostWorldPlacements } from './placements.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/**
 * A MOVE BY NAME, whichever engine draws (#972): the node a name finds, and its local pose set so
 * that its world is the one requested. WebGPU's move (`webgpu/pages/render/transform.ts`), WebGL2's
 * (`placement/autonomousPlacements.ts`) and a world's (`world/core/worldRuntime.ts`) pose alike.
 */

const local = new Float64Array(16),
  current = new Float64Array(16),
  parentWorld = new Float64Array(16),
  parentInverse = new Float64Array(16),
  trs = new Float64Array(3),
  trsRotation = new Float64Array(4),
  trsScale = new Float64Array(3);

/** True when `world`, rounded to single precision, is `matrix`. */
function standsAt(world: Float64Array, matrix: Float32Array) {
  for (let i = 0; i < 16; i++) if (Math.fround(world[i]) !== matrix[i]) return false;
  return true;
}

/** The node of `source` a move by name poses at `matrix`, by the name index (`nameIndex.ts`);
 *  a pose that is not sixteen floats, or a name no node bears, is refused by its code. */
export function namedNode(source: Object3D, nodeName: string, matrix: Float32Array) {
  if (matrix.length !== 16)
    throw new EngineError('INVALID_TRANSFORM', `${nodeName}: sixteen floats expected`, {
      length: matrix.length,
    });
  const node = findNode(source, nodeName);
  if (!node)
    throw new EngineError(
      'UNKNOWN_SCENE_NODE',
      `node ${nodeName} missing from the prepared scene`,
      {
        nodeName,
      },
    );
  return node;
}

/**
 * Sets the local pose of `node` so that its world is `matrix`: brought back into the parent's
 * space, then set as-is as the local matrix, so that `updateMatrixWorld` finds it identical.
 * False when that moves nothing. `held`: no host write is owed, the engine tree mirrors the host.
 * WebGL2's move by name poses the same way, from the host chain (`placement/autonomousPlacements.ts`).
 */
export function poseNode(
  worlds: HostWorldPlacements | null,
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
      ? ((held ? worlds?.parentWorld(node) : null) ?? hostWorldChainInto(parentWorld, parent))
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

/** A move by name on a scene no engine tree mirrors (WebGL2's, a world's): the node posed from
 *  its host chain, or null when the move moves nothing. */
export function poseNamed(source: Object3D, nodeName: string, matrix: Float32Array) {
  const node = namedNode(source, nodeName, matrix);
  return poseNode(null, node, matrix, false) ? node : null;
}
