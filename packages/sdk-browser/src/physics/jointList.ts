import type { Joint } from '../../../sdk-core/src/physics/index.ts';

/**
 * The joints a world holds, `world.physics.add` and `remove`; `changed` tells the running session.
 * Kept apart from the session's code, which a world without physics never fetches.
 */
export function createJointList(changed: () => void) {
  const joints = new Set<Joint>();
  return {
    joints: joints as ReadonlySet<Joint>,
    methods: {
      /** Adds a joint (`joint.hinge(door, frame, …)` and its kin): it is made once both its
       *  bodies are simulated, and holds until it is removed or breaks. */
      add(joint: Joint) {
        joints.add(joint);
        changed();
      },
      /** Takes a joint out: the bodies it held move apart freely. */
      remove(joint: Joint) {
        joints.delete(joint);
        changed();
      },
    },
  };
}
