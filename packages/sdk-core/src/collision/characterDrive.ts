import {
  DECLARED_FLOOR,
  RESPONSE_LEFT,
  SOLE_FRICTION,
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
 * key is held and in `stopTime` once none is, never faster than the floor lets it: a sole pushes
 * on the floor with at most its friction times the body's weight, so the velocity changes by at
 * most `μ g` a second, `μ` the grip of a rubber sole on the floor's matter (`gripOf`). A jog then
 * glides `v² / (2 μ g)` to a stop, 0.8 m on stone and 3.8 m on ice. In the air the velocity closes
 * its gap `airControl` times as fast as a start, and only while a key is held, so an unsteered
 * jump keeps its momentum. The motion inside a tick is integrated in closed form — the constant
 * push of friction, then the exponential approach to the wished speed — so a tick of any length
 * moves the body the same.
 */
export interface CharacterDrive {
  /** Metres per second, relative to what the body stands on. */
  readonly velocity: Float64Array;
  /** Whether the feet are on a floor. */
  grounded: boolean;
  /** Seconds since the feet left a floor, and since the jump key went down. */
  sinceGround: number;
  sinceJump: number;
  /** The friction of the floor's matter (`PhysicsMatter.friction`), as last stood on. */
  floor: number;
}

/** A drive at rest on its feet, no jump pending. */
export const createDrive = (): CharacterDrive => ({
  velocity: new Float64Array(3),
  grounded: true,
  sinceGround: 0,
  sinceJump: Infinity,
  floor: DECLARED_FLOOR,
});

/**
 * The friction between a rubber sole and a floor of friction `floor`: their geometric mean, the
 * rule the physics backend combines two bodies' frictions by (Jolt's default). 0.79 on stone,
 * 0.16 on ice.
 */
export const gripOf = (floor: number) => Math.sqrt(SOLE_FRICTION * Math.max(0, floor));

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
  const push = drive.grounded ? gripOf(drive.floor) * settings.gravity : Infinity;
  approach(velocity, tx, tz, rate, push, h, step);
  if (drive.grounded && !wishing && Math.hypot(velocity[0], velocity[2]) < REST * rate)
    velocity[0] = velocity[2] = 0;
  return true;
}

/**
 * Moves the horizontal `velocity` toward `(tx, tz)` for `h` seconds: the gap shrinks at `rate`
 * times itself but never by more than `push` m/s², so it falls at `push` down to `push / rate`,
 * then exponentially. The gap keeps its direction, so the motion is exact along it; the tick's
 * move is written into `step`.
 */
function approach(
  velocity: Float64Array,
  tx: number,
  tz: number,
  rate: number,
  push: number,
  h: number,
  step: DriveStep,
) {
  const gx = velocity[0] - tx,
    gz = velocity[2] - tz,
    gap = Math.hypot(gx, gz);
  const linear = gap > push / rate ? Math.min(h, (gap - push / rate) / push) : 0,
    middle = linear > 0 ? gap - push * linear : gap,
    decay = Math.exp(-rate * (h - linear)),
    reach = rate > 0 ? (1 - decay) / rate : h - linear;
  // The gap's integral over the tick, then the gap left, as fractions of the gap at its start.
  const along = gap > 0 ? (((gap + middle) / 2) * linear + middle * reach) / gap : 0,
    left = gap > 0 ? (middle * decay) / gap : 0;
  step.dx = tx * h + gx * along;
  step.dz = tz * h + gz * along;
  velocity[0] = tx + gx * left;
  velocity[2] = tz + gz * left;
}
