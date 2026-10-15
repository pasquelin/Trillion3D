import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { CommandWriter } from '../../../sdk-core/src/physics/commands.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { flagsOf, type createPhysicsBodies } from './bodies.ts'
import { hasBody, type Bodied } from './bodied.ts'
import { worldPoseOf } from './bodyFrame.ts'
import { followBody, type Following } from './cookedMoved.ts'
import { followMove } from './nodePose.ts'

/**
 * The page moved or hid `node`: THE ONE WALK every body under it follows by. A page's body follows
 * by the one rescale rule (`followBody`): placed where the page put it — a kinematic one driven
 * there over a step, any other teleported, a soft one with its vertices and its simulation kept
 * —, hidden, no pose; off the scale it was made at, made again at the new one (`bodies.remake`,
 * a refusal handed to `failed`). A compiled model met on the way carries its tiles and declared
 * bodies (`tiles.moved`, `followModel`), and each compiled node a body moves is put where it now
 * stands (`followMove`).
 */
export function followNode(
  node: Object3D,
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'slots' | 'remake' | 'nested'>,
  writer: CommandWriter,
  tiles: { moved(node: Object3D): void },
  follow: (node: Object3D) => void,
  failed: (error: EngineError) => void,
) {
  const page: Following<Bodied> = {
    madeAt: (mesh) => {
      const owner = bodies.slots.at(mesh.physics._index)
      return owner && 'mesh' in owner ? owner.scale! : []
    },
    remake(mesh) {
      try {
        bodies.remake(mesh.physics._index)
      } catch (error) {
        failed(error as EngineError)
      }
      return null
    },
    place(mesh, { position, quaternion }) {
      const { physics } = mesh
      writer[physics.type === 'kinematic' ? 'moveKinematic' : 'teleport'](
        physics._index,
        position,
        quaternion,
      )
      writer.flags(physics._index, flagsOf(mesh))
    },
  }
  node.traverse((child) => {
    tiles.moved(child)
    if (!hasBody(child)) return
    const owner = bodies.slots.at(child.physics._index)
    if (owner && 'mesh' in owner && owner.mesh === child)
      followBody(child, worldPoseOf(child), page)
  })
  followMove(node, bodies.nested, writer, follow)
}
