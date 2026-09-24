import {
  RESPONSE_LEFT,
  type CharacterEvents,
  type CharacterInput,
  type CharacterSettings,
} from './characterSettings.ts';

/**
 * WHAT A CHARACTER WISHES OVER ONE TICK, before it meets anything: the speed it gathers or loses,
 * the jump it takes. Both collision backends read it — the triangle tree on the page
 * (`characterBody.ts`) and Jolt's virtual character in the physics worker
 * (`sdk-browser/src/physics/characterDriver.ts`) — so a character walks, jumps and brakes the
 * same whatever it collides with; only how the move meets the world differs.
 *
 * On the ground the velocity closes 95 % of its gap to the wished one in `responseTime` while a
 * key is held and in `stopTime` once none is; in the air it does so `airControl` times as fast
 * as a start, and only while a key is held, so an unsteered jump keeps its momentum. The motion
 * inside a tick is integrated in closed form, the exponential approach to the wished speed, so a
 * tick of any length moves the body the same.
 */
export interface CharacterDrive {
  /** Metres per second, relative to what the body stands on. */
  readonly velocity: Float64Array;
  /** Whether the feet are on a floor. */
  grounded: boolean;
  /** Seconds since the feet left a floor, and since the jump key went down. */
  sinceGround: number;
  sinceJump: number;
}

/** A drive at rest on its feet, no jump pending. */
export const createDrive = (): CharacterDrive => ({
  velocity: new Float64Array(3),
  grounded: true,
  sinceGround: 0,
  sinceJump: Infinity,
});

/** The horizontal move of one tick, and whether it started with a jump. */
export interface DriveStep {
  dx: number;
  dz: number;
  jumped: boolean;
}

/** Whether the drive stands on its feet with no speed and no key: a tick then moves nothing. */
export const driveAtRest = (drive: CharacterDrive, input: CharacterInput) =>
  drive.grounded &&
  input.wishX === 0 &&
  input.wishZ === 0 &&
  drive.velocity[0] === 0 &&
  drive.velocity[2] === 0;

/** Remaining glide below which a grounded body with no key stops dead: 0.1 mm. */
const REST = 1e-4;

/**
 * Lives one tick of `h` seconds: jumps when the key was pressed within `jumpBuffer` of a floor
 * left within `coyoteTime` (and `canJump`), then moves the horizontal velocity toward the wish.
 * Writes the tick's horizontal move into `step`; returns false when the body is still — grounded,
 * no speed, no key — and nothing is to be done.
 */
export function driveTick(
  drive: CharacterDrive,
  settings: CharacterSettings,
  input: CharacterInput,
  h: number,
  canJump: boolean,
  events: CharacterEvents,
  step: DriveStep,
) {
  const velocity = drive.velocity;
  drive.sinceGround = drive.grounded ? 0 : drive.sinceGround + h;
  drive.sinceJump += h;
  const speed = input.sprint ? settings.sprintSpeed : settings.walkSpeed;
  const tx = input.wishX * speed,
    tz = input.wishZ * speed,
    wishing = tx !== 0 || tz !== 0;
  step.jumped = false;
  if (
    canJump &&
    drive.sinceJump <= settings.jumpBuffer &&
    drive.sinceGround <= settings.coyoteTime
  ) {
    velocity[1] = settings.jumpSpeed;
    drive.grounded = false;
    step.jumped = true;
    drive.sinceGround = drive.sinceJump = Infinity;
    events.onJump?.();
  }
  if (driveAtRest(drive, input)) return false;
  const gather = -Math.log(RESPONSE_LEFT) / settings.responseTime,
    brake = -Math.log(RESPONSE_LEFT) / settings.stopTime;
  const rate = drive.grounded
    ? wishing
      ? gather
      : brake
    : wishing
      ? gather * settings.airControl
      : 0;
  const decay = Math.exp(-rate * h),
    reach = rate > 0 ? (1 - decay) / rate : h;
  step.dx = tx * (h - reach) + velocity[0] * reach;
  step.dz = tz * (h - reach) + velocity[2] * reach;
  velocity[0] = tx + (velocity[0] - tx) * decay;
  velocity[2] = tz + (velocity[2] - tz) * decay;
  if (drive.grounded && !wishing && Math.hypot(velocity[0], velocity[2]) < REST * rate)
    velocity[0] = velocity[2] = 0;
  return true;
}
