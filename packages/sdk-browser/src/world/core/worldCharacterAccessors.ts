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
    /** Character only: metres per second on foot; 4.5 by default, a steady run. */
    get walkSpeed() {
      return settings.walkSpeed;
    },
    set walkSpeed(value: number) {
      setting('walkSpeed', value);
    },
    /** Character only: metres per second with Shift held; 7 by default. */
    get sprintSpeed() {
      return settings.sprintSpeed;
    },
    set sprintSpeed(value: number) {
      setting('sprintSpeed', value);
    },
    /** Character only: upward speed a jump starts with, m/s; `sqrt(2 g h)` reaches `h`, 1.1 m by default. */
    get jumpSpeed() {
      return settings.jumpSpeed;
    },
    set jumpSpeed(value: number) {
      setting('jumpSpeed', value);
    },
    /** Character only: downward acceleration, m/s²; 9.80665 by default. */
    get gravity() {
      return settings.gravity;
    },
    set gravity(value: number) {
      setting('gravity', value);
    },
    /** Character only: how fast the keys steer in the air, as a fraction of the ground response; 0.3 by default, 0 is ballistic. */
    get airControl() {
      return settings.airControl;
    },
    set airControl(value: number) {
      setting('airControl', value);
    },
    /** Character only: seconds to reach 95 % of the wished speed, or to stop, on the ground; one gait step (1 / 1.8 s) by default. */
    get responseTime() {
      return settings.responseTime;
    },
    set responseTime(value: number) {
      setting('responseTime', value);
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
