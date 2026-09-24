import { meshCollision } from '../../../../sdk-core/src/collision/meshTriangles.ts';
import type { CharacterCollision } from '../../../../sdk-core/src/collision/characterCollision.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { VehicleDriver } from '../../../../sdk-core/src/physics/vehicle.ts';
import type { CharacterPort } from '../../physics/physicsCharacter.ts';
import { isHelper } from '../helper/mark.ts';

/** What `world.controls.colliders` takes: meshes to build a triangle tree from, or a world. */
type Colliders = Object3D | readonly Object3D[] | CharacterCollision | null;

/** Whether `value` is a collision world rather than meshes: it answers the two questions. */
const isCollision = (value: Colliders): value is CharacterCollision =>
  typeof (value as Partial<CharacterCollision> | null)?.resolveCapsule === 'function' &&
  typeof (value as Partial<CharacterCollision> | null)?.groundBelow === 'function';

/**
 * What the steered controllers of `world.controls` act on, kept by the handle across every
 * controller `kind` makes: the character's colliders and the world's physics, the vehicle the
 * vehicle controls drive. `bind` hands them to the controller in place, where it has them;
 * `changed` runs after a write, for the handle to bind and redraw.
 */
export function controlTargets(physics: () => CharacterPort | null, changed: () => void) {
  let colliders: Colliders = null,
    collision: CharacterCollision | null = null,
    vehicle: VehicleDriver | null = null;
  const accessors = {
    /**
     * Character only: what the body collides with, or `null`. Meshes — one object or a list,
     * their descendants included — build a static triangle tree from their world-space
     * triangles as they stand now: one pass over the triangles and an `O(T log T)` build, about
     * 52 bytes kept per triangle. Compiled models are not read yet: give a simple mesh stand-in
     * for them. A `CharacterCollision` — anything that answers `resolveCapsule` and
     * `groundBelow` — is used as it is. Unused while `world.physics` is on: the body is then
     * Jolt's and meets the simulation's bodies, `mesh.physics`.
     */
    get colliders(): Object3D | readonly Object3D[] | CharacterCollision | null {
      return colliders;
    },
    set colliders(next: Object3D | readonly Object3D[] | CharacterCollision | null) {
      colliders = next;
      accessors.rebuildColliders();
    },
    /** Character only: builds the collision tree again, after the colliders moved or changed; a
     *  `CharacterCollision` is its own world and is handed on unchanged. */
    rebuildColliders() {
      collision = isCollision(colliders)
        ? colliders
        : colliders
          ? meshCollision(colliders, isHelper)
          : null;
      changed();
    },
    /**
     * Vehicle only: what the `'vehicle'` controls drive — anything with `drive(input)`, which
     * hears the throttle, brake, steer and handbrake each time the keys change them. `null` by
     * default, and `kind = 'vehicle'` throws `NO_VEHICLE` while it is.
     */
    get vehicle(): VehicleDriver | null {
      return vehicle;
    },
    set vehicle(next: VehicleDriver | null) {
      vehicle = next;
      changed();
    },
  };
  return {
    accessors,
    bind(live: Record<string, unknown> | null) {
      if (!live) return;
      if ('collision' in live && live.collision !== collision) live.collision = collision;
      if ('vehicle' in live && live.vehicle !== vehicle) live.vehicle = vehicle;
      if (!('physics' in live)) return;
      const port = physics();
      if (live.physics !== port) live.physics = port;
    },
  };
}
