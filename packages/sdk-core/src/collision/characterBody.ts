import { freshReport, isFloor, slide, type MoveReport } from './characterMove.ts';
import type { CapsuleContact } from './capsule.ts';
import {
  RESPONSE_LEFT,
  type CharacterEvents,
  type CharacterInput,
  type CharacterSettings,
} from './characterSettings.ts';
import type { CharacterCollision } from './characterCollision.ts';

/**
 * A CHARACTER BODY: a capsule with a velocity, integrated on a fixed tick against a collision
 * world (`characterCollision.ts`). The fixed tick makes the motion the same at any frame rate;
 * within a tick the motion is integrated in closed form — the exponential approach to the wished speed, the parabola of
 * gravity — so a jump reaches `v² / 2g` whatever the tick. The pose handed back is interpolated
 * between the last two ticks, which is how a fixed tick draws smoothly on any display, at the
 * price of one tick of latency.
 *
 * GROUND. On the ground the velocity closes 95 % of its gap to the wished one in
 * `responseTime`; in the air it does so `airControl` times as fast, and only while a key is
 * held, so an unsteered jump keeps its momentum. A walker blocked by a wall tries the same move
 * raised by `stepHeight` and keeps it if it ends on a floor further on; a walker whose floor
 * drops by less than `stepHeight` follows it down, and one whose floor drops by more falls.
 *
 * STILL. A grounded body with no speed and no key does no work at all. Without a world there is
 * nothing to stand on or fall onto: the body walks level where it was placed, with the same
 * inertia, and neither falls nor jumps.
 */

/** Seconds per tick. The motion inside a tick is exact, so the tick only sets how often the
 *  contacts are read and how late a landing or a jump can be noticed: one tick, 8 ms. */
export const CHARACTER_TICK = 1 / 120;

/** Remaining glide below which a grounded body with no key stops dead: 0.1 mm. */
const REST = 1e-4;

export function createCharacterBody(settings: CharacterSettings) {
  const capsule = { feet: new Float64Array(3), radius: 0, height: 0 },
    velocity = new Float64Array(3),
    moving = { capsule, velocity },
    previous = new Float64Array(3),
    drawn = new Float64Array(3),
    start = new Float64Array(3),
    kept = new Float64Array(6),
    before = new Float64Array(3),
    report: MoveReport = freshReport({ ground: false, wall: false, impact: 0 });
  let world: CharacterCollision | null = null,
    grounded = true,
    sinceGround = 0,
    sinceJump = Infinity,
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
    grounded = land(settings.stepHeight);
  };

  /** Takes the settings' capsule; `settle` then stands the body if its feet are on a floor. */
  const shape = () => {
    capsule.radius = settings.capsuleRadius;
    capsule.height = settings.capsuleHeight;
  };
  const settle = () => {
    shape();
    start.set(capsule.feet);
    grounded = !world || land(0);
  };

  const tick = (h: number, input: CharacterInput, events: CharacterEvents) => {
    sinceGround = grounded ? 0 : sinceGround + h;
    sinceJump += h;
    const speed = input.sprint ? settings.sprintSpeed : settings.walkSpeed;
    const tx = input.wishX * speed,
      tz = input.wishZ * speed,
      wishing = tx !== 0 || tz !== 0;
    let jumped = false;
    if (world && sinceJump <= settings.jumpBuffer && sinceGround <= settings.coyoteTime) {
      velocity[1] = settings.jumpSpeed;
      [grounded, jumped, sinceGround, sinceJump] = [false, true, Infinity, Infinity];
      events.onJump?.();
    }
    if (grounded && !wishing && velocity[0] === 0 && velocity[2] === 0) return;
    const ground = -Math.log(RESPONSE_LEFT) / settings.responseTime;
    const rate = grounded ? ground : wishing ? ground * settings.airControl : 0;
    const decay = Math.exp(-rate * h),
      reach = rate > 0 ? (1 - decay) / rate : h;
    const dx = tx * (h - reach) + velocity[0] * reach,
      dz = tz * (h - reach) + velocity[2] * reach;
    velocity[0] = tx + (velocity[0] - tx) * decay;
    velocity[2] = tz + (velocity[2] - tz) * decay;
    if (grounded && !wishing && Math.hypot(velocity[0], velocity[2]) < REST * ground)
      velocity[0] = velocity[2] = 0;
    start.set(capsule.feet);
    if (!world) {
      capsule.feet[0] += dx;
      capsule.feet[2] += dz;
      return;
    }
    if (grounded) return walk(dx, dz);
    const g = settings.gravity,
      dy = velocity[1] * h - 0.5 * g * h * h;
    velocity[1] -= g * h;
    move(dx, dy, dz, false);
    if (!report.ground || report.impact < 0 || jumped) return;
    [grounded, velocity[1]] = [true, 0];
    events.onLand?.(report.impact);
  };

  return {
    /** The lowest point of the capsule, as last ticked. */
    feet: capsule.feet,
    /** Metres per second. */
    velocity,
    get onGround() {
      return grounded;
    },
    /** Puts the body at `(x, y, z)` at rest: a teleport, not a move. Feet put on a floor
     *  stand on it; anywhere else they fall. */
    place(x: number, y: number, z: number) {
      [capsule.feet[0], capsule.feet[1], capsule.feet[2]] = [x, y, z];
      previous.set(capsule.feet);
      velocity.fill(0);
      [sinceGround, carry] = [Infinity, 0];
      settle();
    },
    /** What to collide with, `null` for nothing; the body looks for its floor again. */
    setWorld(next: CharacterCollision | null) {
      world = next;
      settle();
    },
    /** The jump key went down: it is kept `jumpBuffer` seconds for a floor to jump from. */
    pressJump() {
      sinceJump = 0;
    },
    /** Lives `delta` seconds; returns the feet to draw, between the last two ticks. */
    advance(delta: number, input: CharacterInput, events: CharacterEvents = {}) {
      shape();
      for (carry += Math.max(0, delta); carry >= CHARACTER_TICK; carry -= CHARACTER_TICK) {
        previous.set(capsule.feet);
        tick(CHARACTER_TICK, input, events);
      }
      const t = carry / CHARACTER_TICK;
      for (let k = 0; k < 3; k++) drawn[k] = previous[k] + (capsule.feet[k] - previous[k]) * t;
      return drawn;
    },
  };
}

export type CharacterBody = ReturnType<typeof createCharacterBody>;
