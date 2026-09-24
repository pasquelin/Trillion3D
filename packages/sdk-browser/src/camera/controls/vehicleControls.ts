import { createControlBase } from './base.ts';
import { axisOf, trackKeys, type KeyAxis } from './input.ts';
import { controlPose } from './pose.ts';
import type { VehicleDriver, VehicleInput } from '../../../../sdk-core/src/physics/vehicle.ts';
import type { CameraControlBase, ControlCamera } from './types.ts';

/**
 * A VEHICLE'S PEDALS AND WHEEL on the keyboard, by `KeyboardEvent.code` so every layout plays the
 * same keys: W or the up arrow is the accelerator, S or the down arrow the brake, A/D or the side
 * arrows the wheel, Space the handbrake. Keys are all or nothing, so each is 0 or 1. The input is
 * handed to `vehicle` each time it changes, never polled: a vehicle held still costs nothing. The
 * controls do not move the camera; a page follows the vehicle with it.
 */
export interface VehicleCameraControls extends CameraControlBase {
  /** What the keys drive; `null` drives nothing. */
  vehicle: VehicleDriver | null;
  /** The input as the keys last set it. */
  readonly input: Readonly<VehicleInput>;
}

const WHEEL: KeyAxis = [
    ['KeyD', 'ArrowRight'],
    ['KeyA', 'ArrowLeft'],
  ],
  THROTTLE = ['KeyW', 'ArrowUp'],
  BRAKE = ['KeyS', 'ArrowDown'],
  HANDBRAKE = 'Space';

/** The pedals and wheel `pressed` keys (`KeyboardEvent.code`) ask for, written into `into`. */
function vehicleInputOf(pressed: Set<string>, into: VehicleInput) {
  into.throttle = THROTTLE.some((code) => pressed.has(code)) ? 1 : 0;
  into.brake = BRAKE.some((code) => pressed.has(code)) ? 1 : 0;
  into.steer = axisOf(pressed, ...WHEEL);
  into.handbrake = pressed.has(HANDBRAKE);
  return into;
}

export function createVehicleCameraControls(
  camera: ControlCamera,
  surface: HTMLElement,
): VehicleCameraControls {
  const base = createControlBase(),
    input: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  const api: VehicleCameraControls = {
    ...base.api,
    object: controlPose(camera).object,
    vehicle: null,
    input,
  };
  const keys = trackKeys(
    surface,
    base,
    () => {
      vehicleInputOf(keys, input);
      api.vehicle?.drive(input);
    },
    [WHEEL, THROTTLE, BRAKE, [HANDBRAKE]],
  );
  return api;
}
