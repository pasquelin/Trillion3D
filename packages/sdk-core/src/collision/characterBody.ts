import { arc, freshReport, isFloor, slide, type MoveReport } from './characterMove.ts';
import type { CapsuleContact } from './capsule.ts';
import type { CharacterEvents, CharacterInput, CharacterSettings } from './characterSettings.ts';
import type { CharacterCollision } from './characterCollision.ts';
import { createDrive, driveTick, type DriveStep } from './characterDrive.ts';

/**
 * A CHARACTER BODY: a capsule with a velocity, integrated on a fixed tick against a collision
 * world (`characterCollision.ts`). The fixed tick makes the motion the same at any frame rate;
 * within a tick the motion is integrated in closed form — the exponential approach to the
 * wished speed, the parabolas of gravity — so a jump reaches `v² / 2g` whatever the tick. The
 * body is ticked up to one tick past the present and the pose handed back is interpolated at
 * the present between the two ticks around it: smooth on any display, and drawn without delay.
 *
 * GROUND. The speed it gathers and loses, and its jumps, are the drive's (`characterDrive.ts`),
 * shared with the physics backend. A body rises under `gravity` and falls under `fallGravity`. A walker
 * blocked by a wall tries the same move raised by `stepHeight` and keeps it if it ends on a
 * floor further on; a walker whose floor drops by less than `stepHeight` follows it down, and
 * one whose floor drops by more falls.
 *
 * STILL. A grounded body with no speed and no key does no work at all. Without a world there is
 * nothing to stand on or fall onto: the body walks level where it was placed, with the same
 * inertia, and neither falls nor jumps.
 */

/** Seconds per tick. The motion inside a tick is exact, so the tick only sets how often the
 *  contacts are read and how late a landing or a jump can be noticed: one tick, 8 ms. */
const CHARACTER_TICK = 1 / 120;

/** Seconds one call lives at most, the usual clamp of a fixed-step loop: a stall (a hidden tab,
 *  a long frame) resumes where it stopped, 0.25 s later at most, instead of spending one frame on
 *  the whole stall. Any shorter delta is caught up in full, so a page at 5 fps walks as fast. */
export const MAX_CHARACTER_DELTA = 0.25;

/** What a character's controller drives, whatever the body collides with. */
export interface CharacterBody {
  /** The lowest point of the capsule, as last moved. */
  readonly feet: Float64Array;
  /** Metres per second. */
  readonly velocity: Float64Array;
  readonly onGround: boolean;
  place(x: number, y: number, z: number): void;
  pressJump(): void;
  advance(delta: number, input: CharacterInput, events?: CharacterEvents): Float64Array;
  /** Releases what the body holds outside the page; the triangle body holds nothing. */
  dispose?(): void;
}

/** Makes a character's body under `settings`, read live: how a physics backend hands the
 *  controller a body of its own (`world.controls` gives it the world's physics one). */
export type CharacterBodyFactory = (settings: CharacterSettings) => CharacterBody;

export function createCharacterBody(settings: CharacterSettings) {
  const capsule = { feet: new Float64Array(3), radius: 0, height: 0 },
    drive = createDrive(),
    velocity = drive.velocity,
    step: DriveStep = { dx: 0, dz: 0, jumped: false },
    moving = { capsule, velocity },
    previous = new Float64Array(3),
    drawn = new Float64Array(3),
    start = new Float64Array(3),
    kept = new Float64Array(6),
    before = new Float64Array(3),
    report: MoveReport = freshReport({ ground: false, wall: false, impact: 0 });
  let world: CharacterCollision | null = null,
    carry = 0;
  const rules = { maxSlope: 0, onGround: false, stepTop: Infinity };
  const read = (onGround: boolean) => {
    rules.maxSlope = settings.maxSlope;
    rules.onGround = onGround;
    rules.stepTop = onGround ? start[1] + settings.stepHeight : Infinity;
    return rules;
  };
  const move = (dx: number, dy: number, dz: number, onGround: boolean) =>
    slide(world!, moving, read(onGround), [dx, dy, dz], freshReport(report));
  const floor = (contact: CapsuleContact) => isFloor(contact, rules);

  /** Sets a walker down on the highest floor within `depth` below it; false when none. */
  const land = (depth: number) => {
    const drop = world!.groundBelow(capsule, depth, (read(true), floor));
    if (drop === null) return false;
    capsule.feet[1] -= drop;
    move(0, 0, 0, true);
    return true;
  };

  /** Raises the body by a step from `start`, moves it by `(dx, dz)`, sets it down. */
  const stepOver = (dx: number, dz: number) => {
    capsule.feet.set(start);
    velocity.set(before);
    move(0, settings.stepHeight, 0, true);
    const rise = capsule.feet[1] - start[1];
    move(dx, 0, dz, true);
    return land(rise);
  };

  /**
   * A walker blocked by a wall looks for a step: a foot put a radius ahead, raised by
   * `stepHeight`, must come down on a floor above the one it left. The body then takes its own
   * move raised and set down, perched on the edge it rolls up on the next ticks.
   */
  const stepUp = (dx: number, dz: number) => {
    kept.set(capsule.feet);
    kept.set(velocity, 3);
    const length = Math.hypot(dx, dz);
    if (length === 0) return;
    const reach = Math.max(1, settings.capsuleRadius / length);
    // A micrometre of rise is the arithmetic's, not a step.
    if (stepOver(dx * reach, dz * reach) && capsule.feet[1] > start[1] + 1e-6)
      return void stepOver(dx, dz);
    capsule.feet.set(kept.subarray(0, 3));
    velocity.set(kept.subarray(3));
  };

  const walk = (dx: number, dz: number) => {
    before.set(velocity);
    move(dx, 0, dz, true);
    if (report.wall && settings.stepHeight > 0) stepUp(dx, dz);
    velocity[1] = 0;
    drive.grounded = land(settings.stepHeight);
  };

  /** Takes the settings' capsule; `settle` then stands the body if its feet are on a floor. */
  const shape = () => {
    capsule.radius = settings.capsuleRadius;
    capsule.height = settings.capsuleHeight;
  };
  const settle = () => {
    shape();
    start.set(capsule.feet);
    drive.grounded = !world || land(0);
  };

  const tick = (h: number, input: CharacterInput, events: CharacterEvents) => {
    if (!driveTick(drive, settings, input, h, world !== null, events, step)) return;
    const { dx, dz, jumped } = step;
    start.set(capsule.feet);
    if (!world) {
      capsule.feet[0] += dx;
      capsule.feet[2] += dz;
      return;
    }
    if (drive.grounded) return walk(dx, dz);
    const [dy, vy] = arc(velocity[1], h, settings.gravity, settings.fallGravity);
    velocity[1] = vy;
    move(dx, dy, dz, false);
    if (!report.ground || report.impact < 0 || jumped) return;
    [drive.grounded, velocity[1]] = [true, 0];
    events.onLand?.(report.impact);
  };

  return {
    /** The lowest point of the capsule, as last ticked. */
    feet: capsule.feet,
    /** Metres per second. */
    velocity,
    get onGround() {
      return drive.grounded;
    },
    /** Puts the body at `(x, y, z)` at rest: a teleport, not a move. Feet put on a floor
     *  stand on it; anywhere else they fall. */
    place(x: number, y: number, z: number) {
      [capsule.feet[0], capsule.feet[1], capsule.feet[2]] = [x, y, z];
      previous.set(capsule.feet);
      velocity.fill(0);
      [drive.sinceGround, carry] = [Infinity, 0];
      settle();
    },
    /** What to collide with, `null` for nothing; the body looks for its floor again. */
    setWorld(next: CharacterCollision | null) {
      world = next;
      settle();
    },
    /** The jump key went down: it is kept `jumpBuffer` seconds for a floor to jump from. */
    pressJump() {
      drive.sinceJump = 0;
    },
    /** Lives `delta` seconds; returns the feet to draw at the present. */
    advance(delta: number, input: CharacterInput, events: CharacterEvents = {}) {
      shape();
      // `carry` is the present less the last tick's time, in (-tick, 0] between calls.
      carry += Math.min(Math.max(0, delta), MAX_CHARACTER_DELTA);
      for (; carry > 0; carry -= CHARACTER_TICK) {
        previous.set(capsule.feet);
        tick(CHARACTER_TICK, input, events);
      }
      const t = 1 + carry / CHARACTER_TICK;
      for (let k = 0; k < 3; k++) drawn[k] = previous[k] + (capsule.feet[k] - previous[k]) * t;
      return drawn;
    },
  };
}
