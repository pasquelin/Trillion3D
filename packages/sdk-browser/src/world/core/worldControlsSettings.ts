/**
 * What `world.controls` keeps and drives: the settings it hands to every controller it makes,
 * and the shape of those controllers as it sees them.
 */
import { FIRST_PERSON_PITCH } from '../../camera/controls/firstPersonControls.ts';
import type { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import type { worldControls } from './worldCamera.ts';

/** The limits and speeds the handle keeps for its controller, at the controllers' own defaults. */
export const CONTROL_SETTINGS = {
  minDistance: 0,
  maxDistance: Infinity,
  minPolarAngle: 0,
  maxPolarAngle: Math.PI,
  minAzimuthAngle: -Infinity,
  maxAzimuthAngle: Infinity,
  movementSpeed: 1,
  lookSpeed: 0.002,
  minPitch: FIRST_PERSON_PITCH[0],
  maxPitch: FIRST_PERSON_PITCH[1],
  rollSpeed: 0.4,
  pitchSpeed: null as number | null,
  yawSpeed: null as number | null,
  inputResponse: 0,
  pitchInput: 0,
  yawInput: 0,
  rollInput: 0,
  rotateSpeed: 1,
  zoomSpeed: 1,
  autoForward: false,
  pointerLook: true,
};
export type ControlSetting = keyof typeof CONTROL_SETTINGS;

/** A controller as the world drives it: a pivot one carries a `target`, a steered one integrates
 *  over a delta in `update`. */
export type Controller = NonNullable<ReturnType<typeof worldControls>> & {
  target?: Vector3;
  update?: (delta?: number) => boolean;
};
