import type { Capsule, CapsuleContact, CapsulePush } from './capsule.ts';
import type { CharacterCollision } from './characterCollision.ts';
import { hypot2, hypot3 } from '../math/primitives/hypot.ts';
import { MOVE_PASSES, SLACK } from './characterSettings.ts';

/**
 * HOW A BODY MOVES THROUGH TRIANGLES: in parts no longer than half its radius, each followed by
 * passes that push it out of whatever it entered. A capsule centre that moves less than its
 * radius cannot cross a surface between two tests, so no speed tunnels through a wall however
 * thin; the number of parts is what the speed asks for, never a constant.
 *
 * THE PUSH READS THE SURFACE. A contact under the bottom sphere's centre is FLOOR when its way
 * out is within `maxSlope` of up, or when it is the edge of a face that is — the body perches on
 * a ledge it overhangs — provided the point is no higher than `stepTop`: the body leaves it
 * straight up, so a slope never slides a standing body down it. Any other contact met while
 * grounded is WALL, left horizontally, so a wall never lifts a walker; a wall under the centre
 * — the lip of a ledge, a steep slope — waits for the second pass, so that the floor sharing
 * its edge is answered first, whatever order the contacts come in. A contact in the air, an
 * overhang, a ceiling is left along its own way out, so a jump against a steep slope slides
 * down it. The velocity and the rest of the move lose the part that points into the surface,
 * which is what makes a body slide along a wall.
 *
 * A PART NEVER CARRIES A BODY DEEPER IN. Where the passes leave it more inside than it was before
 * the part — a ramp under a low ceiling, a gap narrower than the body, where the floor's push and
 * the ceiling's undo each other — the part is not taken: the body stops against what holds it and
 * loses the speed that drove it in, as a character's sweep stops at its first blocking hit
 * (the reference engine's `SafeMoveUpdatedComponent`, Jolt's `CharacterVirtual`). A part may still carry a
 * body out of an overlap it was already in.
 */
export interface MoveReport {
  /** A floor was met. */
  ground: boolean;
  /** A wall was met. */
  wall: boolean;
  /** The downward speed at the first floor contact, negative when the body was rising. */
  impact: number;
}

/** A body the moves act on. */
export interface MovingBody {
  readonly capsule: Capsule;
  readonly velocity: Float64Array;
}

const part = new Float64Array(3),
  away = new Float64Array(3),
  before = new Float64Array(3);
let body: MovingBody,
  report: MoveReport,
  rules: MoveRules,
  firstPass = true;

/** How a move reads the surfaces it meets. */
export interface MoveRules {
  /** Steepest floor, radians from level. */
  maxSlope: number;
  /** Whether the body walks: steep surfaces are then walls, left horizontally. */
  onGround: boolean;
  /** Highest point a floor contact may have: a walker perches on no ledge above a step. */
  stepTop: number;
}

/** Removes from `v` its component into the surface `direction` leaves. */
function clip(v: Float64Array, direction: Float64Array) {
  const into = v[0] * direction[0] + v[1] * direction[1] + v[2] * direction[2];
  if (into < 0) for (let k = 0; k < 3; k++) v[k] -= into * direction[k];
}

/** Whether a contact is floor under `how`: under the centre, walkable, no higher than a step. */
export function isFloor({ normal, surface, point }: CapsuleContact, how: MoveRules) {
  const walkable = Math.cos(how.maxSlope);
  return normal[1] > 0 && point[1] <= how.stepTop && Math.max(normal[1], surface[1]) >= walkable;
}

const push: CapsulePush = (contact) => {
  const { normal, depth } = contact;
  const under = normal[1] > 0,
    across = hypot2(normal[0], normal[2]);
  let amount = depth;
  if (isFloor(contact, rules)) {
    // Straight up until the touched point is one radius from the centre: exact for an edge or
    // a corner, and for a face the next pass finishes what the point leaves.
    const radius = body.capsule.radius,
      gap = radius - depth;
    [away[0], away[1], away[2]] = [0, 1, 0];
    // A level way out touches at the sphere's widest, where the root is 0: rounding must not
    // take it below 0 and make the feet not a number.
    amount = Math.sqrt(Math.max(0, radius * radius - (gap * across) ** 2)) - gap * normal[1];
    if (!report.ground) report.impact = -body.velocity[1];
    report.ground = true;
  } else if (rules.onGround && normal[1] >= 0 && across > 0) {
    if (under && firstPass) return;
    [away[0], away[1], away[2]] = [normal[0] / across, 0, normal[2] / across];
    amount = depth / across;
    report.wall = true;
  } else {
    away.set(normal);
    report.wall ||= normal[1] >= 0;
  }
  const feet = body.capsule.feet;
  for (let k = 0; k < 3; k++) feet[k] += amount * away[k];
  clip(body.velocity, away);
  clip(part, away);
};

/** Clears a report before a move. */
export function freshReport(into: MoveReport) {
  into.ground = into.wall = false;
  into.impact = -Infinity;
  return into;
}

/**
 * Moves `moving` by `delta` through `world`, pushing it out of what it meets under `how`; the
 * floor and wall contacts are added to `into`.
 */
export function slide(
  world: CharacterCollision,
  moving: MovingBody,
  how: MoveRules,
  delta: readonly [number, number, number],
  into: MoveReport,
) {
  [body, report, rules] = [moving, into, how];
  const { capsule } = moving;
  const length = hypot3(delta[0], delta[1], delta[2]);
  // Half a radius a part, so that nothing thinner than the body is crossed; a body with no
  // thickness (a radius of 0, or not a number) has nothing to part by and moves in one.
  const parts = capsule.radius > 0 ? Math.max(1, Math.ceil(length / (0.5 * capsule.radius))) : 1;
  for (let k = 0; k < 3; k++) part[k] = delta[k] / parts;
  for (let i = 0; i < parts; i++) {
    before.set(capsule.feet);
    for (let k = 0; k < 3; k++) capsule.feet[k] += part[k];
    let open = false;
    for (let pass = 0; pass < MOVE_PASSES && !open; pass++) {
      firstPass = pass === 0;
      open = !world.resolveCapsule(capsule, push);
    }
    if (open || !blocked(world, capsule)) continue;
    // Squeezed — a ramp under a low ceiling, a gap narrower than the body: the part is not
    // taken, and the body stops against what holds it, as a blocked sweep stops a capsule.
    capsule.feet.set(before);
    for (let k = 0; k < 3; k++) away[k] = -delta[k] / length;
    clip(body.velocity, away);
    report.wall = true;
    break;
  }
  return into;
}

let depth = 0;
const measure: CapsulePush = (contact) => {
  depth = Math.max(depth, contact.depth);
};

/** The deepest overlap of `capsule` where it stands, the capsule left in place. */
function deepest(world: CharacterCollision, capsule: Capsule) {
  depth = 0;
  world.resolveCapsule(capsule, measure);
  return depth;
}

/** Whether the passes left the capsule deeper inside than it was before the part, by more than
 *  the arithmetic's `SLACK`: a part may carry a body out of an overlap, never further into one. */
function blocked(world: CharacterCollision, capsule: Capsule) {
  const inside = deepest(world, capsule);
  if (inside <= SLACK) return false;
  const { radius, height } = capsule;
  return inside > deepest(world, { feet: before, radius, height }) + SLACK;
}

/** The height gained over `h` seconds from the vertical speed `vy`, and the speed after:
 *  rising under `up`, falling under `down`, the apex found inside the tick when it is there. */
export function arc(vy: number, h: number, up: number, down: number) {
  const rising = vy > 0 ? Math.min(h, vy / up) : 0,
    falling = h - rising,
    top = vy - up * rising;
  const dy = vy * rising - 0.5 * up * rising * rising + top * falling - 0.5 * down * falling ** 2;
  return [dy, top - down * falling] as const;
}
