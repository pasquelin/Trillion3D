import type { HostGraphNode } from '../scene/graphNodes.ts';
import {
  EngineError,
  POSITION_VALUES,
  QUATERNION_VALUES,
  composeMatrix4,
} from '../../../../sdk-core/src/index.ts';
import { copyElements } from '../../math/matrixElements.ts';

/**
 * Read frontier of the host graph.
 *
 * The scene belongs to the host: it is who writes the LOCAL POSES of its nodes. What it
 * composes of them no longer concerns the engine — the world matrices the engine needs are its
 * OWN, computed by the core from those local poses: `chain.ts` for a node's ancestor
 * chain, `tree.ts` for a whole subtree.
 *
 * So only two gestures remain here: READ a node's local pose, and refuse a non-finite pose. The
 * only composition call that remains keeps the HOST's scene up to date for its own readers —
 * replication (`../../scene/replicateInstances.ts`) starts from the world matrices it carries; no number
 * the engine draws comes from there, its own are those of `placements.ts`. The test
 * `tests/integration/moteur-sans-three-math.test.ts` holds this frontier.
 */

/** Whole subtree of `node` updated IN THE HOST SCENE, for its own readers. */
export function resolveHostSubtree(node: HostGraphNode) {
  node.updateMatrixWorld(true);
}

const position = new Float64Array(POSITION_VALUES),
  rotation = new Float64Array(QUATERNION_VALUES),
  scale = new Float64Array(POSITION_VALUES);

/**
 * LOCAL matrix of `node`, written into `out`. This is the reference's `updateMatrix`: a node that
 * recomposes returns the translation-rotation-scale product of its pose, composed by the core
 * and at the same bits; a node whose host cut recomposition returns the matrix it set, as-is.
 * Nothing of the host library is called — the ten pose numbers are READ.
 */
export function hostLocalInto(out: Float64Array, node: HostGraphNode) {
  if (!node.matrixAutoUpdate) {
    copyElements(out, node.matrix.elements);
    return out;
  }
  const { position: p, quaternion: q, scale: s } = node;
  position[0] = p.x;
  position[1] = p.y;
  position[2] = p.z;
  rotation[0] = q.x;
  rotation[1] = q.y;
  rotation[2] = q.z;
  rotation[3] = q.w;
  scale[0] = s.x;
  scale[1] = s.y;
  scale[2] = s.z;
  return composeMatrix4(out, position, rotation, scale);
}

/**
 * Refuses a pose of which one of the sixteen numbers is not finite. A NaN or infinite transform
 * does not carry into any normal: the inverse-transpose kernel would see it by its non-finite
 * sum and return the null vector, hence a dark surface with nobody knowing why. It is therefore
 * refused at the ENTRY — at load (`../../world/scene/scene.ts`) and on every requested pose
 * (`../../webgpu/pages/render/transform.ts`) — with the node name and the faulty index. This is case 4 of the
 * singular-normal convention, written in `../../math/inverseTransposeWgsl.ts`; cases 1 to 3 answer there
 * with a computation, this one with a refusal.
 */
export function assertFiniteTransform(elements: ArrayLike<number>, nodeName: string) {
  for (let index = 0; index < 16; index++)
    if (!Number.isFinite(elements[index]))
      throw new EngineError('NON_FINITE_TRANSFORM', `${nodeName}: non-finite matrix`, {
        nodeName,
        index,
        value: elements[index],
      });
}
