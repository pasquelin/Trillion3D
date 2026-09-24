/**
 * What a driver asks of a vehicle: the pedals and the wheel, as the keys of `world.controls`
 * `'vehicle'` set them (`sdk-browser/src/camera/controls/vehicleControls.ts`). The vehicle's own
 * physics — engine, wheels, suspension — answers them; this contract is all the controls know.
 */
export interface VehicleInput {
  /** Accelerator, 0 to 1. */
  throttle: number;
  /** Brake pedal, 0 to 1. */
  brake: number;
  /** Wheel, −1 full left to 1 full right. */
  steer: number;
  /** Whether the handbrake is pulled. */
  handbrake: boolean;
}

/** Anything `world.controls.vehicle` can drive: it hears the input each time it changes. */
export interface VehicleDriver {
  /** Hears the pedals and the wheel, each time a key changes them, when it starts to be driven,
   *  and all released when it stops being driven. */
  drive(input: Readonly<VehicleInput>): void;
}
