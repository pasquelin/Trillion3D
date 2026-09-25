import {
  type CommandWriter,
  type PhysicsHost,
  physicsMatterOf,
} from '../../../sdk-core/src/physics/index.ts';
import { flagsOf, type Bodied } from './bodies.ts';

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
      rebuild(meshes()[body._index] ?? null);
      invalidate();
    },
    tune(body) {
      const mesh = meshes()[body._index];
      if (!mesh) return;
      const matter = physicsMatterOf(mesh.material);
      writer.gravityScale(body._index, body.gravityScale);
      writer.material(
        body._index,
        body.friction ?? matter.friction,
        body.restitution ?? matter.restitution,
      );
      invalidate();
    },
    velocity(body) {
      writer.velocity(body._index, body.velocity.elements);
      invalidate();
    },
    impulse(body, x, y, z) {
      writer.impulse(body._index, [x, y, z]);
      invalidate();
    },
    wake(body) {
      writer.wake(body._index);
      invalidate();
    },
    listened(body) {
      const mesh = meshes()[body._index];
      // A soft body has no flags word: nothing would read them (softLayout.ts).
      if (mesh && !body.soft) writer.flags(body._index, flagsOf(mesh));
      invalidate();
    },
  };
}
