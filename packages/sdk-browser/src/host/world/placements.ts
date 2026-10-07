import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { updateTransformTree } from '../../../../sdk-core/src/world/transform-tree/pass.ts'
import type { MatrixElements } from '../matrixElements.ts'

/**
 * World matrices of the drawn nodes of a scene, read where they live: the transform tree every
 * scene node is a slot of (`objectSpace.ts`). A pose handed out is the node's own `matrixWorld`,
 * whose numbers are its slot's world matrix in that tree, whose storage never moves (`storage.ts`):
 * the numbers the tree's frame pass last wrote, rewritten in place, never copied, never stale.
 * Nothing mirrors the scene and nothing compares its poses: a write lists its node in the tree, and
 * the pass recomputes what the writes since the last one changed (`pass.ts`).
 */
export interface HostWorldPlacements {
  /** The world matrix of `node`: the same object from call to call, its numbers always those of
   *  the last pass. */
  of(node: Object3D): MatrixElements
  /** Brings every world matrix up to date with the poses written since the last pass. */
  refresh(): void
}

/** The world matrices of `source`'s scene, brought up to date a first time: the one entry that
 *  runs the pass before world matrices are read in bulk. */
export function hostWorldPlacements(source: Object3D): HostWorldPlacements {
  const tree = Object3D._treeOf(source)
  updateTransformTree(tree)
  return { of: (node) => node.matrixWorld, refresh: () => void updateTransformTree(tree) }
}
