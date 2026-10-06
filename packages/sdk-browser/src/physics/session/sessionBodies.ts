import { type CommandWriter, type PhysicsBudget } from '../../../../sdk-core/src/physics/index.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createPhysicsBodies } from '../bodies.ts'
import { createPhysicsJoints } from '../joints.ts'
import { createPhysicsPoses } from '../poses.ts'
import { createSessionHost } from './sessionHost.ts'
import type { SessionState } from './sessionLink.ts'
import type { WantedPhysics } from './sessionParts.ts'

/** The drawn poses, the simulated bodies and their joints: a body the host reports changed goes
 *  to `stale`, and the scene is reconciled before the next frame. */
export function createSessionBodies(
  parts: {
    writer: CommandWriter
    budget: Readonly<PhysicsBudget>
    root: Object3D
    step: number
    stale: Set<Object3D>
    s: SessionState
    invalidate: () => void
  },
  wanted: WantedPhysics,
) {
  const { writer, budget, root, step, stale, s, invalidate } = parts
  const host = createSessionHost(
    writer,
    () => bodies.meshes,
    (mesh) => {
      if (mesh) stale.add(mesh)
      s.dirty = true
    },
    invalidate,
  )
  const poses = createPhysicsPoses(budget.bodies, root, step)
  const bodies = createPhysicsBodies(writer, budget, host, root, poses.state, step)
  const joints = createPhysicsJoints(writer, bodies, invalidate)
  /** A body leaving takes its joints and vehicles; out for good (asleep, diverged), they break. */
  const retire = (index: number, forGood = false) => {
    if (forGood) joints.retired(bodies.slots.physicsAt(index), wanted.joints)
    bodies.retire(index)
    s.dirty = true
  }
  return { poses, bodies, joints, retire }
}
