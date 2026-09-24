import { CONTROL_SETTINGS, type ControlSetting } from './worldControlsSettings.ts';

type Settings = typeof CONTROL_SETTINGS;

/**
 * The character's settings of `world.controls`, one accessor each, kept like the others
 * (`worldControlsAccessors.ts`): a read returns what the handle keeps, a write is kept and handed
 * to the character in place. Every default is read from an adult human
 * (`sdk-core/src/collision/characterSettings.ts`).
 */
export function characterSettingAccessors(
  settings: Settings,
  setting: <K extends ControlSetting>(name: K, value: Settings[K]) => void,
) {
  return {
    /** Character only: metres per second on foot; 3.5 by default, a jog. */
    get walkSpeed() {
      return settings.walkSpeed;
    },
    set walkSpeed(value: number) {
      setting('walkSpeed', value);
    },
    /** Character only: metres per second with Shift held; 6.5 by default, an untrained adult's top speed. */
    get sprintSpeed() {
      return settings.sprintSpeed;
    },
    set sprintSpeed(value: number) {
      setting('sprintSpeed', value);
    },
    /** Character only: upward speed a jump starts with, m/s; `sqrt(2 g h)` reaches `h`, 0.5 m by default, a standing jump. */
    get jumpSpeed() {
      return settings.jumpSpeed;
    },
    set jumpSpeed(value: number) {
      setting('jumpSpeed', value);
    },
    /** Character only: downward acceleration while rising, m/s²; 9.80665 by default. */
    get gravity() {
      return settings.gravity;
    },
    set gravity(value: number) {
      setting('gravity', value);
    },
    /** Character only: downward acceleration while falling, m/s²; 1.6 g by default, so a jump does not float. */
    get fallGravity() {
      return settings.fallGravity;
    },
    set fallGravity(value: number) {
      setting('fallGravity', value);
    },
    /** Character only: how fast the keys steer in the air, as a fraction of the ground start; 0.05 by default, 0 is ballistic. */
    get airControl() {
      return settings.airControl;
    },
    set airControl(value: number) {
      setting('airControl', value);
    },
    /** Character only: seconds to reach 95 % of the wished speed on the ground; 0.12 by default. */
    get responseTime() {
      return settings.responseTime;
    },
    set responseTime(value: number) {
      setting('responseTime', value);
    },
    /** Character only: seconds to lose 95 % of the speed once no key is held, on the ground; 0.08 by default. */
    get stopTime() {
      return settings.stopTime;
    },
    set stopTime(value: number) {
      setting('stopTime', value);
    },
    /** Character only: radius of the body, metres; half a shoulder breadth (0.23 m) by default. */
    get capsuleRadius() {
      return settings.capsuleRadius;
    },
    set capsuleRadius(value: number) {
      setting('capsuleRadius', value);
    },
    /** Character only: height of the body, metres; 1.75 by default. */
    get capsuleHeight() {
      return settings.capsuleHeight;
    },
    set capsuleHeight(value: number) {
      setting('capsuleHeight', value);
    },
    /** Character only: height of the camera above the feet, metres; 1.64 by default. */
    get eyeHeight() {
      return settings.eyeHeight;
    },
    set eyeHeight(value: number) {
      setting('eyeHeight', value);
    },
    /** Character only: highest ledge climbed without a jump, metres; the knee height (0.5 m) by default. */
    get stepHeight() {
      return settings.stepHeight;
    },
    set stepHeight(value: number) {
      setting('stepHeight', value);
    },
    /** Character only: steepest floor stood on, radians from level; 45° by default. */
    get maxSlope() {
      return settings.maxSlope;
    },
    set maxSlope(value: number) {
      setting('maxSlope', value);
    },
    /** Character only: seconds after walking off an edge a jump is still granted; 0.1 by default. */
    get coyoteTime() {
      return settings.coyoteTime;
    },
    set coyoteTime(value: number) {
      setting('coyoteTime', value);
    },
    /** Character only: seconds a jump pressed before landing is kept for the landing; 0.1 by default. */
    get jumpBuffer() {
      return settings.jumpBuffer;
    },
    set jumpBuffer(value: number) {
      setting('jumpBuffer', value);
    },
    /** Character only: metres the eye rises and falls each step at a jog; 0.035 by default, 0 keeps it level. */
    get headBob() {
      return settings.headBob;
    },
    set headBob(value: number) {
      setting('headBob', value);
    },
    /** Character only: seconds from touch-down to the lowest point of the eye's landing dip, as deep as the impact is fast; 0.06 by default, 0 turns it off. */
    get landingDip() {
      return settings.landingDip;
    },
    set landingDip(value: number) {
      setting('landingDip', value);
    },
    /** Character only, with physics: kilograms the body presses on what it stands on; 80 by default. */
    get mass() {
      return settings.mass;
    },
    set mass(value: number) {
      setting('mass', value);
    },
    /** Character only, with physics: newtons the body pushes bodies with; 250 by default, an adult's sustained push. */
    get pushStrength() {
      return settings.pushStrength;
    },
    set pushStrength(value: number) {
      setting('pushStrength', value);
    },
    /** Character only: called on landing with the downward speed in m/s; `null` by default. */
    get onLand() {
      return settings.onLand;
    },
    set onLand(value: ((impact: number) => void) | null) {
      setting('onLand', value);
    },
    /** Character only: called when the body leaves the ground on a jump; `null` by default. */
    get onJump() {
      return settings.onJump;
    },
    set onJump(value: (() => void) | null) {
      setting('onJump', value);
    },
  };
}
