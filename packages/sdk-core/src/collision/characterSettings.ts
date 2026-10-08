import { PHYSICS_MATERIALS } from '../physics/options.ts'
import { QUARTER_PI } from '../../../math/src/constants.ts'

/**
 * THE BODY A CHARACTER STARTS WITH: an adult human, every number read from that human or
 * declared as a game's choice, never tuned on a scene. Lengths in metres, times in seconds,
 * speeds in metres per second, angles in radians.
 *
 * - STATURE 1.75 m, declared: stands for an adult's standing height, the body a level is drawn
 *   for; every body length below is a declared ratio of it, the share of the stature that the eye,
 *   the shoulders and the knee stand at. Sensitivity: every length is linear in it. The capsule,
 *   feet to head (`capsule.ts`), stops under a ceiling lower than the stature, the eye sits at
 *   0.936 of it, and the step height decides which ledges are climbed: 10 % taller climbs 0.55 m.
 * - EYE HEIGHT 0.936 × stature = 1.64 m, declared: 0.936 stands for the share of the stature the
 *   eyes stand at, 0.11 m under the top of the head. Sensitivity: linear, the camera rides at
 *   that height; a hundredth of the ratio moves it 1.75 cm.
 * - RADIUS 0.259 / 2 × stature = 0.23 m, declared: 0.259 stands for the share of the stature the
 *   shoulders span, the widest the body is, and the radius is half of it. Sensitivity: linear,
 *   the narrowest gap the body passes is twice the radius, 0.45 m.
 * - STEP HEIGHT 0.285 × stature = 0.50 m, declared: 0.285 stands for the share of the stature the
 *   knee stands at, the highest ledge a walker climbs in one stride, without a jump. A higher one
 *   is a wall. Sensitivity: linear, a hundredth of the ratio moves that limit 1.75 cm.
 * - WALK 3.5 m/s, declared: stands for a relaxed jog, the pace a body crosses a level at; a
 *   walking pace crosses a level too slowly to play. Sensitivity: the time to cross a distance is
 *   inverse in it, the reach of a jump and of a late press (COYOTE TIME) linear, the glide to a
 *   stop `v² / (2 μ g)` quadratic.
 * - SPRINT 6.5 m/s, declared: stands for the top running speed of an adult who does not train to
 *   run. Sensitivity: as WALK's; a sprint carries a jump 3.7 m and glides 2.7 m to a stop on
 *   stone.
 * - GRAVITY the standard 9.80665 m/s², on the way up.
 * - JUMP an apex of 0.5 m, declared: stands for the height an adult's legs throw the body from
 *   standing. The launch speed is `sqrt(2 g h)` = 3.13 m/s, the apex is reached in 0.32 s, and a
 *   jog carries a jump about 2 m, a sprint about 3.7 m. Sensitivity: the launch speed, the air
 *   time and so the length of a jump go as `sqrt(h)`; a quarter higher is 12 % longer.
 * - FALL GRAVITY 1.6 g, a game's choice, declared: a body that falls as slowly as it rose
 *   floats on a screen, where no leg feels the push, and a heavier fall is the usual answer of
 *   game design. The fall from 0.5 m then takes
 *   0.25 s and a jump 0.57 s in the air. Sensitivity: the air time is `t_up (1 + 1 / sqrt(r))`
 *   for a ratio `r`, 0.64 s at 1 and 0.55 s at 2.
 * - MAX SLOPE atan(1) = 45°: a rubber sole's static friction on dry stone is about 1, and the
 *   steepest slope a foot holds on is the angle whose tangent is that coefficient.
 * - FLOOR FRICTION: a sole pushes on its floor with at most the friction coefficient times the
 *   body's weight, so no leg changes the body's ground speed faster than `μ g`. The sole is
 *   rubber (`PHYSICS_MATERIALS.rubber`, 0.9), and `μ` is its friction combined with the floor's
 *   by the physics backend's rule, their geometric mean (`gripOf`). With physics the floor is the
 *   body the feet stand on, its material's matter (`physicsMatterOf`); without, it is declared
 *   stone (0.7), the usual floor of a level: `μ` = 0.79. A jog then glides `v² / (2 μ g)` to a
 *   stop, 0.79 m on stone and 3.8 m on ice (0.16), and gathers its pace in `v / (μ g)`, 0.45 s on
 *   stone and 2.2 s on ice; a sprint glides 2.7 m on stone, as a sprinter needs metres to stop.
 * - RESPONSE and STOP 0.12 s, declared: stands for the legs' own answer, the time they take to
 *   close 95 % of the gap to the wished speed, bounded by the floor's friction above; it is held
 *   near the 0.1 s a human reads as instantaneous, past which a screen's answer feels like lag.
 *   Sensitivity: the friction's push starts on the
 *   first tick whatever these times; they shape only the last few centimetres of a stop or a
 *   start, below `μ g × time / 3` (0.31 m/s on stone), where the gap closes exponentially and the
 *   body comes to rest without a jerk. A longer time is a gentler leg than the floor allows, and
 *   wins; no time beats the floor.
 * - AIR CONTROL 0.05 of the legs' rate on the ground (`responseTime`), a game's choice,
 *   declared: a body in the air cannot push on anything, and 0 is the physical answer; a little
 *   steering lets a player correct a jump without flying. No floor bounds it, so it stays keyed
 *   to the legs, not to the friction's slower start: every jump flies as it did before.
 *   Sensitivity: a key held through a flight of `t` seconds closes `1 - exp(-3 a t / response)`
 *   of the gap to the wished speed, 50 % over a jump.
 * - COYOTE TIME and JUMP BUFFER 0.1 s, declared: stands for the spread of a human's timing of a
 *   key press against what the screen shows. A press that late after leaving a floor, or that
 *   early before reaching one, is still meant for it (`characterDrive.ts`). Sensitivity: linear,
 *   the reach past an edge from which a press still jumps is speed × time, 0.35 m at a jog and
 *   0.65 m at a sprint.
 * - HEAD BOB 0.035 m, declared: stands for half the rise and fall of the body's centre of mass,
 *   which the head follows, in one step of a jog; the eye travels it above and below its height,
 *   once a step at the running cadence (`characterEye.ts`). Sensitivity: linear, the eye's travel
 *   is twice it, 7 cm from low to high, at the walk speed and above.
 * - LANDING DIP 0.06 s, a game's choice, declared: on landing the eye keeps falling at the
 *   impact speed while the knees bend, and stops at its lowest `landingDip` seconds after
 *   touch-down, `impact × landingDip / e` below its height. The reflexes that steady a real
 *   eye make a screen show less than the hips travel, and no measurement in this repository
 *   fixes how much: a jump dips the eye about 9 cm, a 2 m fall 18 cm. Sensitivity: the depth is
 *   linear in the value.
 * - MASS 80 kg, declared: stands for an adult man's body mass, the weight the body presses on
 *   what it stands on. Sensitivity: that weight is linear in it, `mass × g` = 785 N. Physics
 *   backend only.
 * - PUSH STRENGTH 250 N, declared: stands for the horizontal force an adult man sustains pushing
 *   a load at shoulder height. Sensitivity: linear; a crate lighter than that force's worth of
 *   friction slides, a heavier one stays: `250 / (μ g)`, 36 kg where the crate's combined friction
 *   `μ` is 0.7. Physics backend only.
 */

/** What a character body reads on every tick; the controller publishes it as its settings. */
export interface CharacterSettings {
  walkSpeed: number
  sprintSpeed: number
  jumpSpeed: number
  gravity: number
  fallGravity: number
  airControl: number
  capsuleRadius: number
  capsuleHeight: number
  eyeHeight: number
  stepHeight: number
  maxSlope: number
  responseTime: number
  stopTime: number
  coyoteTime: number
  jumpBuffer: number
  headBob: number
  landingDip: number
  mass: number
  pushStrength: number
}

/** The friction of a rubber sole, what a character's feet grip with (see FLOOR FRICTION). */
export const SOLE_FRICTION = PHYSICS_MATERIALS.rubber.friction
/** The friction of the floor a character stands on without physics: stone. */
export const DECLARED_FLOOR = PHYSICS_MATERIALS.stone.friction

const STATURE = 1.75,
  GRAVITY = 9.80665,
  JUMP_APEX = 0.5

/** Steps per second of a running human, both feet counted, declared: 170 a minute stands for the
 *  cadence a relaxed runner keeps of its own accord. Runners go faster mostly by longer strides,
 *  not quicker ones, so the cadence holds from a jog up. Sensitivity: the head bob's rate is
 *  linear in it, one rise and fall a step, 2.83 Hz at the walk speed and above, in proportion to
 *  the speed below (`characterEye.ts`). */
export const RUN_CADENCE = 170 / 60

/** The settings that shape the body a physics backend holds: a change makes it again. */
export const RESHAPING = [
  'capsuleRadius',
  'capsuleHeight',
  'maxSlope',
  'stepHeight',
  'mass',
  'pushStrength',
] as const satisfies readonly (keyof CharacterSettings)[]

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
  maxSlope: QUARTER_PI,
  responseTime: 0.12,
  stopTime: 0.12,
  coyoteTime: 0.1,
  jumpBuffer: 0.1,
  headBob: 0.035,
  landingDip: 0.06,
  mass: 80,
  pushStrength: 250,
})

/** The fraction of the gap to the wished speed left after the response time: 95 % is closed. */
export const RESPONSE_LEFT = 0.05

/** What the player asks for: a horizontal wish of length at most 1, and the sprint key. */
export interface CharacterInput {
  wishX: number
  wishZ: number
  sprint: boolean
}

/** The moments a game answers with a sound or a shake. */
export interface CharacterEvents {
  /** Landed, `impact` being the downward speed in metres per second. */
  onLand?(impact: number): void
  /** Left the ground on a jump. */
  onJump?(): void
}
