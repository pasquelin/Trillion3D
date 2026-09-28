import {
  EngineError,
  decomposeMatrix4,
  determinantMatrix4,
  invertMatrix4,
  multiplyMatrix4,
} from '../../../../../sdk-core/src/index.ts';
import { assertFiniteTransform, hostLocalInto } from '../../../host/world/matrices.ts';
import { hostWorldChainInto } from '../../../host/world/chain.ts';
import { copyElements, sameElements } from '../../../math/matrixElements.ts';
import type { HostWorldPlacements } from '../../../host/world/placements.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

const local = new Float64Array(16),
  current = new Float64Array(16),
  chained = new Float64Array(16),
  parentInverse = new Float64Array(16),
  trs = new Float64Array(3),
  trsRotation = new Float64Array(4),
  trsScale = new Float64Array(3);

/** True when `world`, rounded to single precision, is `matrix`. */
function standsAt(world: Float64Array, matrix: Float32Array) {
  for (let i = 0; i < 16; i++) if (Math.fround(world[i]) !== matrix[i]) return false;
  return true;
}

/**
 * Sets the local pose of `node` so that its world is the column-major WORLD `matrix` (R8): the
 * request is brought back into the parent's space, then set as-is as the local matrix, so that
 * `updateMatrixWorld` finds it identical. Returns false when it moves nothing. `held`: no host
 * write is owed, so the engine tree mirrors the host and the parent world is read there.
 */
export function poseNode(
  worlds: HostWorldPlacements,
  node: Object3D,
  matrix: Float32Array,
  held: boolean,
) {
  // A non-finite pose is refused here, before any inversion: further on it would become a NaN
  // world matrix, then a null normal, then a black surface with no readable cause.
  assertFiniteTransform(matrix, node.name);
  const parent = node.parent;
  // The requested pose is a WORLD pose: bringing it back into the parent's space needs the
  // parent's world matrix, and the host is allowed to have written a local pose above without
  // climbing the graph. The engine therefore takes it from ITS tree when that tree is current
  // (`host/world/pose.ts`, #971), and otherwise composes it from the local poses of the ancestor
  // chain (`chain.ts`): the same bits either way, nothing asked of the host or written to it.
  // Without that, inversion would bear on a stale parent — a child requested at x = 3 under a
  // parent that moved to x = 10 would end at x = 13 — and the comparisons that follow would judge
  // "no effect" a request remade after the parent moved. It therefore precedes both.
  const parentWorld = parent
    ? ((held ? worlds.parentWorld(node) : null) ?? hostWorldChainInto(chained, parent))
    : null;
  // The world the node already stands at, to the precision the request carries: moving it there
  // moves nothing — a node's first write included, which the local comparison below cannot judge.
  hostLocalInto(current, node);
  if (parentWorld) multiplyMatrix4(current, parentWorld, current);
  if (standsAt(current, matrix)) return false;
  copyElements(local, matrix);
  if (parent && parentWorld) {
    // A parent flattened onto a plane or a line has no inverse: the base would yield sixteen
    // zeros and the node would silently leave for the origin. The determinant is the only test
    // that distinguishes this case from the exit, and it also catches a non-finite matrix.
    const determinant = determinantMatrix4(parentWorld);
    if (determinant === 0 || !Number.isFinite(determinant))
      throw new EngineError(
        'SINGULAR_PARENT_TRANSFORM',
        `${node.name}: parent world matrix not invertible`,
        { nodeName: node.name, parentName: parent.name, determinant },
      );
    invertMatrix4(parentInverse, parentWorld);
    multiplyMatrix4(local, parentInverse, local);
  }
  // A pose identical to the one this node already carries — and set from here, hence
  // `matrixAutoUpdate` false — changes no world matrix: declaring it changed would invalidate
  // shadow pages and refuse the held image for a result identical to the pixel. A host's direct
  // write leaves `node.matrix` different and therefore takes the full path again.
  if (!node.matrixAutoUpdate && sameElements(node.matrix.elements, local)) return false;
  // The local matrix is authoritative, not the three fields: a shear — two non-orthogonal axes,
  // which a non-uniform scale under a rotation produces — does not decompose into them, and
  // `updateMatrixWorld` would recompose `matrix` over the one set here. Cutting recomposition on
  // the moved node alone keeps it intact; the base's decompose still fills the three fields, at
  // the bits of `Matrix4.decompose`, for whoever reads them.
  decomposeMatrix4(local, trs, trsRotation, trsScale);
  node.position.set(trs[0], trs[1], trs[2]);
  node.quaternion.set(trsRotation[0], trsRotation[1], trsRotation[2], trsRotation[3]);
  node.scale.set(trsScale[0], trsScale[1], trsScale[2]);
  copyElements(node.matrix.elements, local);
  node.matrixAutoUpdate = false;
  return true;
}
