import { CONTROL_SETTINGS, type ControlSetting } from './worldControlsSettings.ts';

type Settings = typeof CONTROL_SETTINGS;

/**
 * The settings of `world.controls`, one accessor each: a read returns what the handle keeps, a
 * write goes through `setting`, which keeps it and hands it to the controller in place.
 */
export function controlSettingAccessors(
  settings: Settings,
  setting: <K extends ControlSetting>(name: K, value: Settings[K]) => void,
) {
  return {
    /** Closest a pivot controller brings the camera to `target`. */
    get minDistance() {
      return settings.minDistance;
    },
    set minDistance(value: number) {
      setting('minDistance', value);
    },
    /** Farthest a pivot controller takes the camera from `target`. */
    get maxDistance() {
      return settings.maxDistance;
    },
    set maxDistance(value: number) {
      setting('maxDistance', value);
    },
    /** Orbit only: smallest polar angle, in radians from straight up. */
    get minPolarAngle() {
      return settings.minPolarAngle;
    },
    set minPolarAngle(value: number) {
      setting('minPolarAngle', value);
    },
    /** Orbit only: largest polar angle; `Math.PI / 2` keeps the camera above the ground. */
    get maxPolarAngle() {
      return settings.maxPolarAngle;
    },
    set maxPolarAngle(value: number) {
      setting('maxPolarAngle', value);
    },
    /** Orbit only: start of the arc of azimuth allowed, in radians from +Z towards +X. */
    get minAzimuthAngle() {
      return settings.minAzimuthAngle;
    },
    set minAzimuthAngle(value: number) {
      setting('minAzimuthAngle', value);
    },
    /** Orbit only: end of that arc; it may be smaller than `minAzimuthAngle`. */
    get maxAzimuthAngle() {
      return settings.maxAzimuthAngle;
    },
    set maxAzimuthAngle(value: number) {
      setting('maxAzimuthAngle', value);
    },
    /** Orbit only: radians per second it turns around `target` on its own, until the first
     *  press or wheel notch; 0 by default. */
    get autoRotate() {
      return settings.autoRotate;
    },
    set autoRotate(value: number) {
      setting('autoRotate', value);
    },
    /** Flight and first person: world units per second at full stick; 1 by default. */
    get movementSpeed() {
      return settings.movementSpeed;
    },
    set movementSpeed(value: number) {
      setting('movementSpeed', value);
    },
    /** Flight, first person and character: radians the view turns per pixel the pointer moves;
     *  `null` (the default) keeps each one's own — 0.002 for a head, half a turn per canvas
     *  height for flight. */
    get lookSpeed() {
      return settings.lookSpeed;
    },
    set lookSpeed(value: number | null) {
      setting('lookSpeed', value);
    },
    /** First person and character: lowest the head looks, in radians (0 is the horizon, negative down). */
    get minPitch() {
      return settings.minPitch;
    },
    set minPitch(value: number) {
      setting('minPitch', value);
    },
    /** First person and character: highest the head looks, in radians above the horizon. */
    get maxPitch() {
      return settings.maxPitch;
    },
    set maxPitch(value: number) {
      setting('maxPitch', value);
    },
    /** Flight only: whether the pointer turns the view; false and the keys alone steer. */
    get pointerLook() {
      return settings.pointerLook;
    },
    set pointerLook(on: boolean) {
      setting('pointerLook', on);
    },
    /** Flight only: radians per second the keys roll, and pitch and yaw unless set apart. */
    get rollSpeed() {
      return settings.rollSpeed;
    },
    set rollSpeed(value: number) {
      setting('rollSpeed', value);
    },
    /** Flight only: radians per second the keys pitch; `null` (the default) is `rollSpeed`. */
    get pitchSpeed() {
      return settings.pitchSpeed;
    },
    set pitchSpeed(value: number | null) {
      setting('pitchSpeed', value);
    },
    /** Flight only: radians per second the keys yaw; `null` (the default) is `rollSpeed`. */
    get yawSpeed() {
      return settings.yawSpeed;
    },
    set yawSpeed(value: number | null) {
      setting('yawSpeed', value);
    },
    /** Flight only: seconds a turn key takes to full deflection and back; 0 is instant. */
    get inputResponse() {
      return settings.inputResponse;
    },
    set inputResponse(value: number) {
      setting('inputResponse', value);
    },
    /** Flight only: pitch stick in [-1, 1] (nose up), added to the arrow keys; 0 by default. */
    get pitchInput() {
      return settings.pitchInput;
    },
    set pitchInput(value: number) {
      setting('pitchInput', value);
    },
    /** Flight only: yaw stick in [-1, 1] (left), added to the arrow keys; 0 by default. */
    get yawInput() {
      return settings.yawInput;
    },
    set yawInput(value: number) {
      setting('yawInput', value);
    },
    /** Flight only: roll stick in [-1, 1] (left), added to Q and E; 0 by default. */
    get rollInput() {
      return settings.rollInput;
    },
    set rollInput(value: number) {
      setting('rollInput', value);
    },
    /** Orbit and trackball: how fast dragging turns; 1 by default. */
    get rotateSpeed() {
      return settings.rotateSpeed;
    },
    set rotateSpeed(value: number) {
      setting('rotateSpeed', value);
    },
    /** Pivot controllers: how fast the wheel and the pinch zoom; 1 by default. */
    get zoomSpeed() {
      return settings.zoomSpeed;
    },
    set zoomSpeed(value: number) {
      setting('zoomSpeed', value);
    },
    /** Flight only: flies forward at `movementSpeed` with no key, W faster, S to a halt. */
    get autoForward() {
      return settings.autoForward;
    },
    set autoForward(on: boolean) {
      setting('autoForward', on);
    },
  };
}
