/** The character's settings of `world.controls`, kept like the others (`worldControlsAccessors.ts`):
 *  every default is read from an adult human (`sdk-core/src/collision/characterSettings.ts`). */
export interface CharacterSettings {
  /** Character only: metres per second on foot; 3.5 by default, a jog. */
  walkSpeed: number
  /** Character only: metres per second with Shift held; 6.5 by default, an untrained adult's top speed. */
  sprintSpeed: number
  /** Character only: upward speed a jump starts with, m/s; `sqrt(2 g h)` reaches `h`, 0.5 m by default, a standing jump. */
  jumpSpeed: number
  /** Character only: downward acceleration while rising, m/s²; 9.80665 by default. */
  gravity: number
  /** Character only: downward acceleration while falling, m/s²; 1.6 g by default, so a jump does not float. */
  fallGravity: number
  /** Character only: how fast the keys steer in the air, as a fraction of the ground start; 0.05 by default, 0 is ballistic. */
  airControl: number
  /** Character only: seconds the legs take to reach 95 % of the wished speed on the ground; 0.12 by
   *  default. The floor's friction bounds the start first: a sole pushes at most `μ g`, `μ` a
   *  rubber sole's grip on the floor's `material.physics` (stone until the physics names one), so a jog is
   *  reached in 0.45 s on stone and 2.2 s on ice. */
  responseTime: number
  /** Character only: seconds the legs take to lose 95 % of the speed once no key is held, on the
   *  ground; 0.12 by default. The floor's friction bounds the stop first: a jog glides
   *  `v² / (2 μ g)`, 0.8 m on stone and 3.8 m on ice; a longer time brakes more gently. */
  stopTime: number
  /** Character only: radius of the body, metres; half a shoulder breadth (0.23 m) by default. */
  capsuleRadius: number
  /** Character only: height of the body, metres; 1.75 by default. */
  capsuleHeight: number
  /** Character only: height of the camera above the feet, metres; 1.64 by default. */
  eyeHeight: number
  /** Character only: highest ledge climbed without a jump, metres; the knee height (0.5 m) by default. */
  stepHeight: number
  /** Character only: steepest floor stood on, radians from level; 45° by default. */
  maxSlope: number
  /** Character only: seconds after walking off an edge a jump is still granted; 0.1 by default. */
  coyoteTime: number
  /** Character only: seconds a jump pressed before landing is kept for the landing; 0.1 by default. */
  jumpBuffer: number
  /** Character only: metres the eye rises and falls each step at a jog; 0.035 by default, 0 keeps it level. */
  headBob: number
  /** Character only: seconds from touch-down to the lowest point of the eye's landing dip, as deep as the impact is fast; 0.06 by default, 0 turns it off. */
  landingDip: number
  /** Character only, with physics: kilograms the body presses on what it stands on; 80 by default. */
  mass: number
  /** Character only, with physics: newtons the body pushes bodies with; 250 by default, an adult's sustained push. */
  pushStrength: number
  /** Character only: called on landing with the downward speed in m/s; `null` by default. */
  onLand: ((impact: number) => void) | null
  /** Character only: called when the body leaves the ground on a jump; `null` by default. */
  onJump: (() => void) | null
}
