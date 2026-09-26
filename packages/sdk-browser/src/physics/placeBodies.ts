import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { flagsOf, hasBody, type createPhysicsBodies } from './bodies.ts';
import { worldPoseOf, worldScaleOf } from './bodyFrame.ts';
import { fits, rescaledSoft } from './softBodies.ts';

/**
 * The page moved or hid `node`: each body of it that `bodies` hold goes where the page put it — a
 * kinematic one driven there over a step, any other teleported, a soft one with its vertices and
 * its simulation kept —; hidden, no pose. Jolt scales no soft body once made: one placed at
 * another scale than it was made at is taken out and refused by name (`failed`), as a cooked one
 * is, and made again once back at it. Returns whether the bodies must be reconciled.
 */
export function placeBodies(
  node: Object3D,
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'slots' | 'retire' | 'back'>,
  writer: CommandWriter,
  failed: (error: EngineError) => void,
) {
  let changed = false;
  node.traverse((child) => {
    if (!hasBody(child)) return;
    const owner = bodies.slots.at(child.physics._index);
    if (!owner || !('mesh' in owner) || owner.mesh !== child) {
      changed ||= bodies.back(child);
      return;
    }
    const { name, physics } = child;
    if (owner.scale && !fits(worldScaleOf(child), owner.scale)) {
      bodies.retire(physics._index, owner.scale);
      failed(rescaledSoft(`"${name}"`, owner.scale, { name }));
      changed = true;
      return;
    }
    const { position, quaternion } = worldPoseOf(child);
    const move = physics.type === 'kinematic' ? 'moveKinematic' : 'teleport';
    writer[move](physics._index, position, quaternion);
    writer.flags(physics._index, flagsOf(child));
  });
  return changed;
}
