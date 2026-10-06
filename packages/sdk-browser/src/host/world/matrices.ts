import { EngineError } from '../../../../sdk-core/src/index.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

/**
 * Read frontier of the host graph.
 *
 * The scene belongs to the host: it is who writes the LOCAL POSES of its nodes. The world matrices
 * the engine draws are those of the transform tree every node is a slot of, brought up to date by
 * its frame pass (`placements.ts`). What remains here: a node's pose refused when one of its
 * numbers is not finite, and the HOST's scene brought up to date
 * for its own readers — replication (`../../scene/replicateInstances.ts`) starts from the world
 * matrices it carries. The test `tests/integration/engine-without-three-math.test.ts` holds this
 * frontier.
 */

/** Whole subtree of `node` updated IN THE HOST SCENE, for its own readers. */
export function resolveHostSubtree(node: Object3D) {
  node.updateMatrixWorld(true)
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
      })
}
