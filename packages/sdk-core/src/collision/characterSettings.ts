/**
 * THE BODY A CHARACTER STARTS WITH: an adult human, every number read from that human or
 * declared as a game's choice, never tuned on a scene. Lengths in metres, times in seconds,
 * speeds in metres per second, angles in radians.
 *
 * - STATURE 1.75 m: the mean adult male stature of Europe and North America, the population a
 *   level is usually drawn for; every body length below is a ratio of it, from the classic
 *   segment proportions of anthropometry (Drillis and Contini, 1966).
 * - EYE HEIGHT 0.936 × stature = 1.64 m.
 * - RADIUS half the shoulder breadth, 0.259 / 2 × stature = 0.23 m: the widest the body is.
 * - STEP HEIGHT the knee height, 0.285 × stature = 0.50 m: the highest ledge a walker climbs in
 *   one stride, without a jump. A higher one is a wall.
 * - WALK 3.5 m/s: a jog, the relaxed running pace of recreational runners (3 to 4 m/s). A
 *   human's preferred walking speed (1.4 m/s) crosses a level too slowly to play.
 * - SPRINT 6.5 m/s: an untrained adult's top running speed (6 to 7 m/s; elite sprinters reach
 *   10 to 12 m/s).
 * - GRAVITY the standard 9.80665 m/s², on the way up.
 * - JUMP an apex of 0.5 m, an average adult's standing vertical jump (0.4 to 0.5 m for young
 *   men). The launch speed is `sqrt(2 g h)` = 3.13 m/s, the apex is reached in 0.32 s, and a
 *   jog carries a jump about 2 m, a sprint about 3.7 m, a running long jump of an untrained
 *   adult.
 * - FALL GRAVITY 1.6 g, a game's choice, declared: a body that falls as slowly as it rose
 *   floats on a screen, where no leg feels the push, and a heavier fall is the usual answer of
 *   game design (Pittman, "Building a Better Jump", GDC 2016). The fall from 0.5 m then takes
 *   0.25 s and a jump 0.57 s in the air. Sensitivity: the air time is `t_up (1 + 1 / sqrt(r))`
 *   for a ratio `r`, 0.64 s at 1 and 0.55 s at 2.
 * - MAX SLOPE atan(1) = 45°: a rubber sole's static friction on dry stone is about 1, and the
 *   steepest slope a foot holds on is the angle whose tangent is that coefficient.
 * - RESPONSE 0.12 s to reach 95 % of the wished speed, STOP 0.08 s to lose 95 % of it: a game's
 *   choice, declared. A leg needs about two strides to reach a jog, but a key is all or
 *   nothing, and a screen that answers later than the 0.1 s a human reads as instantaneous
 *   (Miller, 1968) feels like lag in the controls. The start stays just above that bound, so
 *   the body is still seen gathering speed; the stop stays under it, so an edge is kept.
 *   Sensitivity: the glide after a release is `v × stop / 3`, 9 cm from a jog.
 * - AIR CONTROL 0.05 of the ground start, a game's choice, declared: a body in the air
 *   cannot push on anything, and 0 is the physical answer; a little steering lets a player
 *   correct a jump without flying. Sensitivity: a key held through a flight of `t` seconds
 *   closes `1 - exp(-3 a t / response)` of the gap to the wished speed, 50 % over a jump.
 * - COYOTE TIME and JUMP BUFFER 0.1 s: the spread of a trained human's timing of a key press
 *   against a visual cue. A press that late or that early is still meant for that edge.
 * - HEAD BOB 0.035 m: the head rises and falls once a step with the body's centre of mass,
 *   6 to 8 cm from low to high at a jog in running gait studies; the eye travels that half
 *   amplitude above and below its height, at the running cadence.
 * - LANDING DIP 0.06 s, a game's choice, declared: on landing the eye keeps falling at the
 *   impact speed while the knees bend, and stops at its lowest `landingDip` seconds after
 *   touch-down, `impact × landingDip / e` below its height. The reflexes that steady a real
 *   eye make a screen show less than the hips travel, and no study fixes how much: a jump
 *   dips the eye about 9 cm, a 2 m fall 18 cm. Sensitivity: the depth is linear in the value.
 * - MASS 80 kg: the mean adult male body mass of Europe and North America (NCD-RisC, 2016),
 *   the weight the body presses on what it stands on. Physics backend only.
 * - PUSH STRENGTH 250 N: the horizontal force an adult man sustains pushing a load at shoulder
 *   height (Snook and Ciriello, 1991, sustained push forces, 200 to 300 N); a crate lighter than
 *   that force's worth of friction slides, a heavier one stays. Physics backend only.
 */

/** What a character body reads on every tick; the controller publishes it as its settings. */
export interface CharacterSettings {
  walkSpeed: number;
  sprintSpeed: number;
  jumpSpeed: number;
  gravity: number;
  fallGravity: number;
  airControl: number;
  capsuleRadius: number;
  capsuleHeight: number;
  eyeHeight: number;
  stepHeight: number;
  maxSlope: number;
  responseTime: number;
  stopTime: number;
  coyoteTime: number;
  jumpBuffer: number;
  headBob: number;
  landingDip: number;
  mass: number;
  pushStrength: number;
}

const STATURE = 1.75,
  GRAVITY = 9.80665,
  JUMP_APEX = 0.5;

/** Steps per second of a running human, both feet counted: 170 a minute, the self-selected
 *  cadence of recreational runners (160 to 180). Runners go faster mostly by longer strides,
 *  not quicker ones (Dorn, Schache and Pandy, 2012), so the cadence holds from a jog up. */
export const RUN_CADENCE = 170 / 60;

/** The settings that shape the body a physics backend holds: a change makes it again. */
export const RESHAPING = [
  'capsuleRadius',
  'capsuleHeight',
  'maxSlope',
  'stepHeight',
  'mass',
  'pushStrength',
] as const satisfies readonly (keyof CharacterSettings)[];

export const HUMAN_BODY: Readonly<CharacterSettings> = Object.freeze({
  walkSpeed: 3.5,
  sprintSpeed: 6.5,
  jumpSpeed: Math.sqrt(2 * GRAVITY * JUMP_APEX),
  gravity: GRAVITY,
  fallGravity: 1.6 * GRAVITY,
  airControl: 0.05,
  capsuleRadius: (0.259 / 2) * STATURE,
  capsuleHeight: STATURE,
  eyeHeight: 0.936 * STATURE,
  stepHeight: 0.285 * STATURE,
  maxSlope: Math.atan(1),
  responseTime: 0.12,
  stopTime: 0.08,
  coyoteTime: 0.1,
  jumpBuffer: 0.1,
  headBob: 0.035,
  landingDip: 0.06,
  mass: 80,
  pushStrength: 250,
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
