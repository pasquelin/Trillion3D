import type { Joint } from '../../../sdk-core/src/physics/index.ts';
import { Vehicle } from '../../../sdk-core/src/physics/vehicle.ts';

/**
 * The joints and vehicles a world holds, `world.physics.add` and `remove`; `changed` tells the
 * running session. Kept apart from the session's code, which a world without physics never
 * fetches.
 */
export function createJointList(changed: () => void) {
  const joints = new Set<Joint>();
  const vehicles = new Set<Vehicle>();
  const setOf = (item: Joint | Vehicle) =>
    (item instanceof Vehicle ? vehicles : joints) as Set<Joint | Vehicle>;
  return {
    joints: joints as ReadonlySet<Joint>,
    vehicles: vehicles as ReadonlySet<Vehicle>,
    methods: {
      /** Adds a joint (`joint.hinge(door, frame, …)` and its kin), made once both its bodies are
       *  simulated and holding until it is removed or breaks; or a vehicle (`vehicle.car(body,
       *  { wheels })` and its kin), made once its body is simulated. */
      add(item: Joint | Vehicle) {
        setOf(item).add(item);
        changed();
      },
      /** Takes a joint out, the bodies it held moving apart freely; or a vehicle, its body left
       *  without wheels. */
      remove(item: Joint | Vehicle) {
        setOf(item).delete(item);
        changed();
      },
    },
  };
}
