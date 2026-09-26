import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { flagsOf, hasBody } from './bodies.ts';
import type { createBodySlots } from './bodySlots.ts';
import { worldPoseOf, worldScaleOf } from './bodyFrame.ts';
import { fits, rescaledSoft } from './softBodies.ts';

/**
 * The page moved or hid `node`: each body of it that `slots` hold goes where the page put it — a
 * kinematic one driven there over a step, any other teleported, a soft one with its vertices and
 * its simulation kept —; hidden, no pose. A soft body placed at another scale than it was made at
 * is refused by name and handed to `retire`: Jolt scales no soft body once made.
 */
export function placeBodies(
  node: Object3D,
  slots: Pick<ReturnType<typeof createBodySlots>, 'at'>,
  writer: CommandWriter,
  retire: (index: number, error: EngineError) => void,
) {
  node.traverse((child) => {
    if (!hasBody(child)) return;
    const owner = slots.at(child.physics._index);
    if (!owner || !('mesh' in owner) || owner.mesh !== child) return;
    const { name, physics } = child;
    if (physics.soft && !fits(worldScaleOf(child), owner.scale))
      return retire(physics._index, rescaledSoft(`"${name}"`, owner.scale, { name }));
    const { position, quaternion } = worldPoseOf(child);
    const move = child.physics.type === 'kinematic' ? 'moveKinematic' : 'teleport';
    writer[move](child.physics._index, position, quaternion);
    writer.flags(child.physics._index, flagsOf(child));
  });
}
