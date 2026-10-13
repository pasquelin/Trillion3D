import { CONTROL_SETTINGS, type ControlSetting } from './worldControlsSettings.ts'
import type { CharacterSettings } from './worldCharacterAccessors.ts'

type Settings = typeof CONTROL_SETTINGS

/** The settings of `world.controls` every controller but the character reads: limits, speeds and
 *  the look, at the controllers' own defaults (`CONTROL_SETTINGS`). */
export interface ControlSettings {
  /** Closest a pivot controller brings the camera to `target`. */
  minDistance: number
  /** Farthest a pivot controller takes the camera from `target`. */
  maxDistance: number
  /** Orbit only: smallest polar angle, in radians from straight up. */
  minPolarAngle: number
  /** Orbit only: largest polar angle; `Math.PI / 2` keeps the camera above the ground. */
  maxPolarAngle: number
  /** Orbit only: start of the arc of azimuth allowed, in radians from +Z towards +X. */
  minAzimuthAngle: number
  /** Orbit only: end of that arc; it may be smaller than `minAzimuthAngle`. */
  maxAzimuthAngle: number
  /** Orbit only: radians per second it turns around `target` on its own, until the first
   *  press or wheel notch; 0 by default. */
  autoRotate: number
  /** Flight and first person: world units per second at full stick; 1 by default. */
  movementSpeed: number
  /** Flight, first person and character: radians the view turns per pixel the pointer moves;
   *  `null` (the default) keeps each one's own — 0.002 for a head, half a turn per canvas
   *  height for flight. */
  lookSpeed: number | null
  /** First person and character: lowest the head looks, in radians (0 is the horizon, negative down). */
  minPitch: number
  /** First person and character: highest the head looks, in radians above the horizon. */
  maxPitch: number
  /** Flight only: whether the pointer turns the view; false and the keys alone steer. */
  pointerLook: boolean
  /** Flight only: radians per second the keys roll, and pitch and yaw unless set apart. */
  rollSpeed: number
  /** Flight only: radians per second the keys pitch; `null` (the default) is `rollSpeed`. */
  pitchSpeed: number | null
  /** Flight only: radians per second the keys yaw; `null` (the default) is `rollSpeed`. */
  yawSpeed: number | null
  /** Flight only: seconds a turn key takes to full deflection and back; 0 is instant. */
  inputResponse: number
  /** Flight only: pitch stick in [-1, 1] (nose up), added to the arrow keys; 0 by default. */
  pitchInput: number
  /** Flight only: yaw stick in [-1, 1] (left), added to the arrow keys; 0 by default. */
  yawInput: number
  /** Flight only: roll stick in [-1, 1] (left), added to Q and E; 0 by default. */
  rollInput: number
  /** Orbit and trackball: how fast dragging turns; 1 by default. */
  rotateSpeed: number
  /** Pivot controllers: how fast the wheel and the pinch zoom; 1 by default. */
  zoomSpeed: number
  /** Flight only: flies forward at `movementSpeed` with no key, W faster, S to a halt. */
  autoForward: boolean
}

/**
 * The settings of `world.controls`, one accessor each: a read returns what the handle keeps, a
 * write goes through `setting`, which keeps it and hands it to the controller in place.
 */
export function controlSettingAccessors(
  settings: Settings,
  setting: <K extends ControlSetting>(name: K, value: Settings[K]) => void,
) {
  const accessors = {} as ControlSettings & CharacterSettings
  for (const name of Object.keys(CONTROL_SETTINGS) as ControlSetting[])
    Object.defineProperty(accessors, name, {
      get: () => settings[name],
      set: (value: Settings[typeof name]) => setting(name, value),
      enumerable: true,
      configurable: true,
    })
  return accessors
}
