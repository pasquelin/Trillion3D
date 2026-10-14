import type { CommandWriter } from '../../../../sdk-core/src/physics/commands.ts'
import type { PhysicsHost } from '../../../../sdk-core/src/physics/objectPhysics.ts'
import { physicsMatterOf } from '../../../../sdk-core/src/physics/matter.ts'
import { flagsOf } from '../bodies.ts'
import type { Bodied } from '../bodied.ts'

/**
 * What a session's bodies call when the page changes one (`mesh.physics`): each change becomes a
 * command for the next frame, and the frame is asked for. `meshes` are the session's bodies;
 * `rebuild` marks one to be rebuilt (`null`: the body is gone, the scene is reconciled all the same).
 */
export function createSessionHost(
  writer: CommandWriter,
  meshes: () => readonly (Bodied | null)[],
  rebuild: (mesh: Bodied | null) => void,
  invalidate: () => void,
): PhysicsHost {
  return {
    rebuild(body) {
      rebuild(meshes()[body._index] ?? null)
      invalidate()
    },
    tune(body) {
      const mesh = meshes()[body._index]
      if (!mesh) return
      const matter = physicsMatterOf(mesh.material)
      writer.gravityScale(body._index, body.gravityScale)
      writer.material(
        body._index,
        body.friction ?? matter.friction,
        body.restitution ?? matter.restitution,
      )
      invalidate()
    },
    velocity(body) {
      writer.velocity(body._index, body.velocity.elements)
      invalidate()
    },
    impulse(body, x, y, z) {
      writer.impulse(body._index, [x, y, z])
      invalidate()
    },
    wake(body) {
      writer.wake(body._index)
      invalidate()
    },
    listened(body) {
      const mesh = meshes()[body._index]
      if (mesh) writer.flags(body._index, flagsOf(mesh))
      invalidate()
    },
  }
}
