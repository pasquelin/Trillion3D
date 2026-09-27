import type { GravityPreset, PhysicsBudget } from '../../../sdk-core/src/physics/index.ts';

/** A gravity: a preset's name, or a vector in m/s². */
export type GravityInput = GravityPreset | { x: number; y: number; z: number };

/** What `createWorld(canvas, { physics })` accepts beyond `true`. */
export interface WorldPhysicsOptions {
  /** The world's gravity: a preset or a vector. @defaultValue 'earth' */ gravity?: GravityInput;
  /** Fixed envelopes, read once when the physics starts. @defaultValue DEFAULT_PHYSICS_BUDGET */
  budget?: Partial<PhysicsBudget>;
  /** Metres around the camera within which bodies are simulated (`world.physics.simulationRange`);
   *  `null` follows `camera.far`. @defaultValue null */
  simulationRange?: number | null;
}

/** `metres` as a simulation range: a finite distance above 0, or `null` for the camera's. */
export function simulationRangeOf(metres: number | null) {
  if (metres !== null && !(metres > 0 && metres < Infinity))
    throw new RangeError(
      `physics.simulationRange must be null or a finite number > 0, not ${metres}.`,
    );
  return metres;
}
