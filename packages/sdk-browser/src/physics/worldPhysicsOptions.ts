import type { GravityPreset, PhysicsBudget } from '../../../sdk-core/src/physics/options.ts'

/** A gravity: a preset's name, or a vector in m/s². */
export type GravityInput = GravityPreset | { x: number; y: number; z: number }

/** What `createWorld(canvas, { physics })` accepts beyond `true`. */
export interface WorldPhysicsOptions {
  /** The world's gravity: a preset or a vector. @defaultValue 'earth' */ gravity?: GravityInput
  /** Fixed envelopes, read once when the physics starts. @defaultValue DEFAULT_PHYSICS_BUDGET */
  budget?: Partial<PhysicsBudget>
  /** Metres around the camera within which bodies are simulated (`world.physics.simulationRange`);
   *  `null` follows `camera.far`. @defaultValue null */
  simulationRange?: number | null
  /** Seconds of one fixed step: the simulation's clock, whatever the display's rate. Read once,
   *  when the physics starts. @defaultValue PHYSICS_STEP (1/60) */
  step?: number
  /** The acceleration below which a contact does not bounce, m/s²: a landing slower than it times
   *  the step rebounds not at all. Read once, when the physics starts.
   *  @defaultValue DEFAULT_RESTITUTION_THRESHOLD (10) */
  restitutionThreshold?: number
}

/** `value` as the `name` option: a finite number above `min` (0 included when `inclusive`). */
function finiteFrom(name: string, value: number, min: number, inclusive: boolean) {
  if (!((inclusive ? value >= min : value > min) && value < Infinity))
    throw new RangeError(
      `physics.${name} must be a finite number ${inclusive ? '>=' : '>'} ${min}, not ${value}.`,
    )
  return value
}

/** `seconds` as a fixed step: a finite number above 0. */
export const physicsStepOf = (seconds: number) => finiteFrom('step', seconds, 0, false)

/** `acceleration` as a restitution threshold: a finite number, 0 and up. */
export const restitutionThresholdOf = (acceleration: number) =>
  finiteFrom('restitutionThreshold', acceleration, 0, true)

/** `metres` as a simulation range: a finite distance above 0, or `null` for the camera's. */
export function simulationRangeOf(metres: number | null) {
  if (metres !== null && !(metres > 0 && metres < Infinity))
    throw new RangeError(
      `physics.simulationRange must be null or a finite number > 0, not ${metres}.`,
    )
  return metres
}
