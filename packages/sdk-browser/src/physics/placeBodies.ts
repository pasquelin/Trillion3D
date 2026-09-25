import type { CommandWriter, PhysicsHost } from '../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { flagsOf, hasBody } from './bodies.ts';
import { worldPoseOf } from './bodyFrame.ts';

/**
 * The page moved or hid `node`: each body of it that `host` simulates goes where the page put it
 * (a kinematic one driven there over a step, a soft one made again there); hidden, no pose.
 */
export function placeBodies(node: Object3D, host: PhysicsHost, writer: CommandWriter) {
  node.traverse((child) => {
    if (!hasBody(child) || child.physics._host !== host) return;
    if (child.physics.soft) return host.rebuild(child.physics);
    const { position, quaternion } = worldPoseOf(child);
    const move = child.physics.type === 'kinematic' ? 'moveKinematic' : 'teleport';
    writer[move](child.physics._index, position, quaternion);
    writer.flags(child.physics._index, flagsOf(child));
  });
}
