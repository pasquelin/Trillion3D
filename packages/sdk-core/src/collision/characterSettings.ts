/**
 * THE BODY A CHARACTER STARTS WITH: an adult human, every number read from that human rather
 * than tuned on a scene. Lengths in metres, times in seconds, speeds in metres per second,
 * angles in radians.
 *
 * - STATURE 1.75 m: the mean adult male stature of Europe and North America, the population a
 *   level is usually drawn for; every body length below is a ratio of it, from the classic
 *   segment proportions of anthropometry (Drillis and Contini, 1966).
 * - EYE HEIGHT 0.936 × stature = 1.64 m.
 * - RADIUS half the shoulder breadth, 0.259 / 2 × stature = 0.23 m: the widest the body is.
 * - STEP HEIGHT the knee height, 0.285 × stature = 0.50 m: the highest ledge a walker climbs in
 *   one stride, without a jump. A higher one is a wall.
 * - WALK 4.5 m/s: a steady run, a trained runner's endurance pace. A human's preferred walking
 *   speed (1.4 m/s) crosses a level too slowly to play; this is the pace a player holds.
 * - SPRINT 7 m/s: a recreational runner's top speed (elite sprinters reach 10 to 12 m/s).
 * - GRAVITY the standard 9.80665 m/s².
 * - JUMP an apex of 1.1 m, waist height (about 0.63 × stature): a running jump that lands a
 *   trained runner on a waist-high ledge. A standing jump reaches about 0.5 m; the value is
 *   that choice, declared. The launch speed is `sqrt(2 g h)`.
 * - MAX SLOPE atan(1) = 45°: a rubber sole's static friction on dry stone is about 1, and the
 *   steepest slope a foot holds on is the angle whose tangent is that coefficient.
 * - RESPONSE one gait step, 1 / 1.8 s: a walker reaches 95 % of the wished speed, or stops, in
 *   the time of one step at the usual cadence of 1.8 steps per second.
 * - AIR CONTROL has no human value: a body in the air cannot push on anything, and 0 is the
 *   physical answer. A game lets the player steer a jump; 0.3 of the ground response is that
 *   choice, declared. Sensitivity: the distance a jump can be bent, linear in the value.
 * - COYOTE TIME and JUMP BUFFER 0.1 s: the spread of a trained human's timing of a key press
 *   against a visual cue. A press that late or that early is still meant for that edge.
 */

/** What a character body reads on every tick; the controller publishes it as its settings. */
export interface CharacterSettings {
  walkSpeed: number;
  sprintSpeed: number;
  jumpSpeed: number;
  gravity: number;
  airControl: number;
  capsuleRadius: number;
  capsuleHeight: number;
  eyeHeight: number;
  stepHeight: number;
  maxSlope: number;
  responseTime: number;
  coyoteTime: number;
  jumpBuffer: number;
}

const STATURE = 1.75,
  GRAVITY = 9.80665,
  JUMP_APEX = 1.1,
  CADENCE = 1.8;

export const HUMAN_BODY: Readonly<CharacterSettings> = Object.freeze({
  walkSpeed: 4.5,
  sprintSpeed: 7,
  jumpSpeed: Math.sqrt(2 * GRAVITY * JUMP_APEX),
  gravity: GRAVITY,
  airControl: 0.3,
  capsuleRadius: (0.259 / 2) * STATURE,
  capsuleHeight: STATURE,
  eyeHeight: 0.936 * STATURE,
  stepHeight: 0.285 * STATURE,
  maxSlope: Math.atan(1),
  responseTime: 1 / CADENCE,
  coyoteTime: 0.1,
  jumpBuffer: 0.1,
});

/** The fraction of the gap to the wished speed left after the response time: 95 % is closed. */
export const RESPONSE_LEFT = 0.05;

/** What the player asks for: a horizontal wish of length at most 1, and the sprint key. */
export interface CharacterInput {
  wishX: number;
  wishZ: number;
  sprint: boolean;
}

/** The moments a game answers with a sound or a shake. */
export interface CharacterEvents {
  /** Landed, `impact` being the downward speed in metres per second. */
  onLand?(impact: number): void;
  /** Left the ground on a jump. */
  onJump?(): void;
}
