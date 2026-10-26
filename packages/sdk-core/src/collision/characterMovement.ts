/**
 * THE RULES A CHARACTER'S VELOCITY IS MOVED BY on a floor and in the air (`characterDrive.ts`),
 * each a setting of the character with the engine's default. Lengths in metres, times in seconds,
 * speeds in metres per second.
 */
export interface CharacterMovementSettings {
  /** Character only: per second, how fast the velocity turns toward the wish on a floor, and how
   *  much of the speed braking takes with no key held; 8 by default. */
  groundFriction: number
  /** Character only: metres per second squared a body on a floor brakes by with no key held, on
   *  top of the ground friction; 20.48 by default (the whole `maxAcceleration`). */
  brakingDecelerationWalking: number
  /** Character only: the same in the air; 0 by default. */
  brakingDecelerationFalling: number
  /** Character only: the friction turning and braking a body's sideways velocity in the air, per
   *  second; 0 by default, a body keeps its momentum. */
  fallingLateralFriction: number
  /** Character only: the factor on a friction while braking; 2 by default. */
  brakingFrictionFactor: number
  /** Character only: seconds braking is cut into at most, so a slow frame brakes as a quick one
   *  does; a thirty-third of a second by default, kept between 1/75 and 1/20. */
  brakingSubStepTime: number
  /** Character only: the factor on `airControl` while the sideways speed is under
   *  `airControlBoostVelocityThreshold`, the control never over 1; 2 by default, 0 turns it off. */
  airControlBoostMultiplier: number
  /** Character only: metres per second of sideways speed under which `airControl` is boosted;
   *  0.25 by default. */
  airControlBoostVelocityThreshold: number
  /** Character only: the fastest a body falls, metres per second; 40 by default. */
  terminalVelocity: number
  /** Character only: seconds a step is cut into at most; 0.05 by default. */
  maxSimulationTimeStep: number
  /** Character only: the sub-steps a tick is cut into at most; 8 by default. */
  maxSimulationIterations: number
  /** Character only: the times a tick is cut short to end exactly on the apex of a jump; 2 by default. */
  maxJumpApexAttemptsPerSimulation: number
  /** Character only: the speed on foot the weakest key push reaches, metres per second; 0 by default. */
  minAnalogWalkSpeed: number
  /** Character only: the jumps a body makes before it lands again; 1 by default, 2 allows a double jump. */
  jumpMaxCount: number
  /** Character only: seconds a jump keeps its speed while the key is held; 0 by default, a press is one jump. */
  jumpMaxHoldTime: number
  /** Character only: whether gravity pulls while the key holds a jump; true by default. */
  applyGravityWhileJumping: boolean
  /** Character only: whether a held jump keeps the jump speed as the least vertical speed; true by default. */
  dontFallBelowJumpZVelocityDuringJump: boolean
}

/** The engine's defaults of the movement rules. */
export const MOVEMENT_DEFAULTS: Readonly<CharacterMovementSettings> = Object.freeze({
  groundFriction: 8,
  brakingDecelerationWalking: 20.48,
  brakingDecelerationFalling: 0,
  fallingLateralFriction: 0,
  brakingFrictionFactor: 2,
  brakingSubStepTime: 1 / 33,
  airControlBoostMultiplier: 2,
  airControlBoostVelocityThreshold: 0.25,
  terminalVelocity: 40,
  maxSimulationTimeStep: 0.05,
  maxSimulationIterations: 8,
  maxJumpApexAttemptsPerSimulation: 2,
  minAnalogWalkSpeed: 0,
  jumpMaxCount: 1,
  jumpMaxHoldTime: 0,
  applyGravityWhileJumping: true,
  dontFallBelowJumpZVelocityDuringJump: true,
})
