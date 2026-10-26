import type { CharacterEvents, CharacterInput } from './characterDrive.ts'
import { MOVEMENT_DEFAULTS, type CharacterMovementSettings } from './characterMovement.ts'
import type { CharacterMode } from './characterModes.ts'

/**
 * THE BODY A CHARACTER STARTS WITH: the engine's own character, every number its default unless
 * said declared. Lengths in metres, times in seconds, speeds in metres per second, angles in radians.
 *
 * - CAPSULE radius 0.34 m and half height 0.88 m (height 1.76 m), the engine's default capsule. The
 *   narrowest gap the body passes is twice the radius, 0.68 m.
 * - EYE HEIGHT 1.52 m above the feet: the engine's eye stands 0.64 m above the capsule's centre.
 * - STEP HEIGHT 0.45 m, the engine's default: the highest ledge climbed in one stride, without a
 *   jump. A higher one is a wall.
 * - MAX SLOPE acos(0.71) = 44.765°, the engine's default walkable floor (a floor normal's height of
 *   0.71): the steepest slope stood on.
 * - WALK 6 m/s, the engine's default (600 cm/s): the top speed on foot, crouched half of it. The time
 *   to cross a distance is inverse in it, the reach of a jump linear.
 * - GRAVITY SCALE 1: the body feels the world's gravity (`world.physics.gravity`, 9.80665 m/s² on
 *   Earth) as it is, rising and falling alike; a game lightens or heavies the body alone with
 *   another scale (0 floats it). Sensitivity: the rise, the apex of a given launch speed and the
 *   air time are inverse in it.
 * - TERMINAL VELOCITY 40 m/s, the engine's default: the fastest a body falls.
 * - JUMP 4.2 m/s, the engine's default (420 cm/s): the upward speed a jump starts with, never
 *   lowering a speed already higher. Under Earth's gravity the apex is 0.9 m, reached in 0.43 s.
 *   Sensitivity: the apex goes as the square of it, the air time linearly.
 * - GROUND MOVEMENT, the engine's own model (`characterMovement.ts`, `characterDrive.ts`): on a
 *   floor the velocity turns toward the wish by `groundFriction` (8 per second), gathers
 *   `maxAcceleration` (20.48 m/s²) up to the top speed, and with no key is braked by the friction
 *   (doubled, `brakingFrictionFactor`) and a constant `brakingDecelerationWalking` (20.48 m/s²), a
 *   stop dead under 0.1 m/s. A jog of 6 m/s stops in about 0.25 s, 0.6 m. The floor's own friction
 *   does not enter. In the air the same step runs with `fallingLateralFriction` (0) and
 *   `brakingDecelerationFalling` (0), so the sideways velocity is kept, and the wish pushes with
 *   `airControl` of its force.
 * - AIR CONTROL 0.05, the engine's default: the share of the wish's push a body in the air has,
 *   boosted by `airControlBoostMultiplier` (2) while its sideways speed is under 0.25 m/s, so a
 *   jump from rest can be steered. 0 is ballistic.
 * - JUMPS 1 (`jumpMaxCount`) of hold time 0 (`jumpMaxHoldTime`), the engine's defaults: a press jumps at
 *   most once before the next landing, from a floor only — a body that walked off an edge has no
 *   jump —, and is consumed by the step that reads it; with a hold time the jump speed is kept
 *   while the key is held.
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
 * - MASS 100 kg, the engine's default: the weight the body presses on what it stands on, `mass × g` =
 *   981 N. Physics backend only.
 * - PUSH STRENGTH 250 N, declared: stands for the horizontal force an adult man sustains pushing
 *   a load at shoulder height. Sensitivity: linear; a crate lighter than that force's worth of
 *   friction slides, a heavier one stays: `250 / (μ g)`, 36 kg where the crate's combined friction
 *   `μ` is 0.7. Physics backend only.
 */

/** What a character body reads on every tick; the controller publishes it as its settings. */
export interface CharacterSettings extends CharacterMovementSettings {
  /** Character only: metres per second on foot; 6 by default. */
  walkSpeed: number
  /** Character only: upward speed a jump starts with, m/s; 4.2 by default (a 0.9 m apex on Earth). */
  jumpSpeed: number
  /** Character only: the share of the world's gravity (`world.physics.gravity`) the body feels; 1 by default, 0 is weightless. */
  gravityScale: number
  /** Character only: the share of the keys' push a body in the air has; 0.05 by default, 0 is ballistic. */
  airControl: number
  /** Character only: radius of the body, metres; 0.34 by default. */
  capsuleRadius: number
  /** Character only: height of the body, metres; 1.76 by default. */
  capsuleHeight: number
  /** Character only: height of the camera above the feet, metres; 1.52 by default. */
  eyeHeight: number
  /** Character only: highest ledge climbed without a jump, metres; 0.45 by default. */
  stepHeight: number
  /** Character only: steepest floor stood on, radians from level; acos(0.71), 44.765°, by default. */
  maxSlope: number
  /** Character only: metres the eye rises and falls each step at a jog; 0.035 by default, 0 keeps it level. */
  headBob: number
  /** Character only: seconds from touch-down to the lowest point of the eye's landing dip, as deep as the impact is fast; 0.06 by default, 0 turns it off. */
  landingDip: number
  /** Character only, with physics: kilograms the body presses on what it stands on; 100 by default. */
  mass: number
  /** Character only, with physics: newtons the body pushes bodies with; 250 by default, an adult's sustained push. */
  pushStrength: number
  /** Character only, with physics: whether the crouch key shrinks the body; false by default. */
  canCrouch: boolean
  /** Character only: total height of the body crouched, metres; 0.8 by default (a half height of 0.4 m). It never goes under the body's width. */
  crouchedHeight: number
  /** Character only: metres per second on foot crouched; half the walk speed by default. */
  crouchedSpeed: number
  /** Character only: whether a crouch keeps the body's base where it was (else its centre, and the feet rise); false by default. */
  crouchKeepsBase: boolean
  /** Character only: whether water carries the body, which then swims; true by default. */
  canSwim: boolean
  /** Character only: top speed swimming, metres per second; 3 by default. */
  swimSpeed: number
  /** Character only: top speed flying, metres per second; 6 by default. */
  flySpeed: number
  /** Character only: whether the body flies, free of gravity; false by default. Setting it false again lets the body fall. */
  flying: boolean
  /** Character only: the share of its weight the water lifts a fully submerged body by; 1 by default, a body that floats in place. */
  buoyancy: number
  /** Character only: the friction of the fluid a body swims or flies through, per second; 0.3 by default. */
  fluidFriction: number
  /** Character only: metres per second squared the body gathers speed by on a floor, in the air, swimming and flying; 20.48 by default. */
  maxAcceleration: number
  /** Character only: metres per second squared the body brakes by swimming with no key held, on top of the water's friction; 0 by default. */
  swimBraking: number
  /** Character only: the same flying; 0 by default. */
  flyBraking: number
}

/** Steps per second of a running human, both feet counted, declared: 170 a minute stands for the
 *  cadence a relaxed runner keeps of its own accord. Runners go faster mostly by longer strides,
 *  not quicker ones, so the cadence holds from a jog up. Sensitivity: the head bob's rate is
 *  linear in it, one rise and fall a step, 2.83 Hz at the walk speed and above, in proportion to
 *  the speed below (`characterEye.ts`). */
export const RUN_CADENCE = 170 / 60

/** The downward pull on a body, m/s²: the world's gravity along the vertical, `worldY` its y
 *  component, times the body's `gravityScale`; none from a gravity that points up. */
export const characterGravity = (worldY: number, gravityScale: number) =>
  Math.max(0, -worldY * gravityScale)

/** The settings that shape the body a physics backend holds: a change makes it again. */
export const RESHAPING = [
  'capsuleRadius',
  'capsuleHeight',
  'maxSlope',
  'stepHeight',
  'mass',
  'pushStrength',
  'crouchedHeight',
  'crouchKeepsBase',
] as const satisfies readonly (keyof CharacterSettings)[]

/** The engine's defaults the body is built from: the walk speed, the capsule's half height and the
 *  eye's height over its centre. */
const WALK_SPEED = 6,
  HALF_HEIGHT = 0.88,
  EYE_ABOVE_CENTRE = 0.64

export const HUMAN_BODY: Readonly<CharacterSettings> = Object.freeze({
  ...MOVEMENT_DEFAULTS,
  walkSpeed: WALK_SPEED,
  jumpSpeed: 4.2,
  gravityScale: 1,
  airControl: 0.05,
  capsuleRadius: 0.34,
  capsuleHeight: 2 * HALF_HEIGHT,
  eyeHeight: HALF_HEIGHT + EYE_ABOVE_CENTRE,
  stepHeight: 0.45,
  maxSlope: Math.acos(0.71),
  headBob: 0.035,
  landingDip: 0.06,
  mass: 100,
  pushStrength: 250,
  // The movement modes' numbers are the engine's defaults: a crouch to a 0.4 m half height at
  // half the walk, a swim of 3 m/s and a flight of 6 m/s through a fluid of friction 0.3, the
  // water lifting by the whole weight, 20.48 m/s² of acceleration and no braking of its own.
  canCrouch: false,
  crouchedHeight: 0.8,
  crouchedSpeed: 0.5 * WALK_SPEED,
  crouchKeepsBase: false,
  canSwim: true,
  swimSpeed: 3,
  flySpeed: 6,
  flying: false,
  buoyancy: 1,
  fluidFriction: 0.3,
  maxAcceleration: 20.48,
  swimBraking: 0,
  flyBraking: 0,
})

/** What a character's controller drives: the body the world's physics makes to meet the world. */
export interface CharacterBody {
  /** The lowest point of the capsule, as last moved. */
  readonly feet: Float64Array
  /** Metres per second. */
  readonly velocity: Float64Array
  readonly onGround: boolean
  /** How the body moves now; a body with no physics only stands. */
  readonly mode?: CharacterMode
  /** Whether the body is crouched. */
  readonly crouched?: boolean
  place(x: number, y: number, z: number): void
  pressJump(): void
  advance(delta: number, input: CharacterInput, events?: CharacterEvents): Float64Array
  /** Releases what the body holds outside the page. */
  dispose?(): void
}

/** Makes a character's body under `settings`, read live: how the world's physics hands the
 *  controller its body (`world.controls` gives it). */
export type CharacterBodyFactory = (settings: CharacterSettings) => CharacterBody
