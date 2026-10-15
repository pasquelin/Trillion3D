import type { CommandWriter } from '../../../sdk-core/src/physics/commands.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { flagsOf, type createPhysicsBodies } from './bodies.ts'
import { hasBody } from './bodied.ts'
import { worldPoseOf } from './bodyFrame.ts'
import { followMove } from './nodePose.ts'
import { fits } from './softBodies.ts'

/**
 * The page moved or hid `node`: THE ONE WALK every body under it follows by. A page's body goes
 * where the page put it — a kinematic one driven there over a step, any other teleported, a soft
 * one with its vertices and its simulation kept —; hidden, no pose. A compiled model met on the way
 * carries its tiles and declared bodies (`tiles.moved`, `followModel`), and each compiled node a
 * body moves is put where it now stands (`followMove`). A body placed off the scale it was made
 * at is made again at the new one: a page's soft body taken out here, made again when the bodies
 * are reconciled — whether they must be, the walk returns.
 */
export function followNode(
  node: Object3D,
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'slots' | 'removeAt' | 'nested'>,
  writer: CommandWriter,
  tiles: { moved(node: Object3D): void },
  follow: (node: Object3D) => void,
) {
  let changed = false
  node.traverse((child) => {
    tiles.moved(child)
    if (!hasBody(child)) return
    const owner = bodies.slots.at(child.physics._index)
    if (!owner || !('mesh' in owner) || owner.mesh !== child) return
    const { physics } = child
    const { position, quaternion, scale } = worldPoseOf(child)
    if (owner.scale && !fits(scale, owner.scale)) {
      bodies.removeAt(physics._index)
      changed = true
      return
    }
    const move = physics.type === 'kinematic' ? 'moveKinematic' : 'teleport'
    writer[move](physics._index, position, quaternion)
    writer.flags(physics._index, flagsOf(child))
  })
  followMove(node, bodies.nested, writer, follow)
  return changed
}
