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
  /**
   * What the keys drive. `world.controls` never runs these controls without one (`NO_VEHICLE`);
   * made alone, `null` drives nothing. A vehicle set here hears the keys held now at once; the
   * one it replaces, like the one in place when the controls are disposed or paused, hears its
   * keys let go.
   */
  vehicle: VehicleDriver | null;
}

const WHEEL: KeyAxis = [
    ['KeyD', 'ArrowRight'],
    ['KeyA', 'ArrowLeft'],
  ],
  THROTTLE = ['KeyW', 'ArrowUp'],
  BRAKE = ['KeyS', 'ArrowDown'],
  HANDBRAKE = 'Space';

/** Every key let go. */
const RELEASED: Readonly<VehicleInput> = { throttle: 0, brake: 0, steer: 0, handbrake: false };

export function createVehicleCameraControls(
  camera: ControlCamera,
  surface: HTMLElement,
): VehicleCameraControls {
  const base = createControlBase(),
    input: VehicleInput = { ...RELEASED };
  let vehicle: VehicleDriver | null = null;
  /** A vehicle let go of hears its keys released, unless none was held. */
  const release = () => {
    if (input.throttle || input.brake || input.steer || input.handbrake)
      vehicle?.drive({ ...RELEASED });
  };
  const api: VehicleCameraControls = {
    ...base.api,
    object: controlPose(camera).object,
    get vehicle() {
      return vehicle;
    },
    set vehicle(next) {
      if (next === vehicle) return;
      release();
      vehicle = next;
      vehicle?.drive(input);
    },
  };
  base.undo(release);
  const keys = trackKeys(
    surface,
    base,
    () => {
      // The pedals and the wheel the keys (`KeyboardEvent.code`) ask for.
      input.throttle = THROTTLE.some((code) => keys.has(code)) ? 1 : 0;
      input.brake = BRAKE.some((code) => keys.has(code)) ? 1 : 0;
      input.steer = axisOf(keys, ...WHEEL);
      input.handbrake = keys.has(HANDBRAKE);
      vehicle?.drive(input);
    },
    [WHEEL, THROTTLE, BRAKE, [HANDBRAKE]],
  );
  return api;
}
