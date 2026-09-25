import type { Object3D } from '../world/object/object3d.ts';
import { GRAVITY_PRESETS } from './options.ts';
import { MAX_GEARS, TORQUE_POINTS } from './vehicleLayout.ts';
import { VEHICLE_SPECS, type VehicleSpec } from './vehicleSpec.ts';

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

/** The vehicles of the physics, each on Jolt's vehicle constraint. */
export type VehicleKind = 'car' | 'motorcycle' | 'tracked';

/** What `vehicle.*` accepts: the wheels, and any number of the machine's own (`VehicleSpec`). */
export interface VehicleOptions extends Partial<VehicleSpec> {
  /**
   * The wheels: meshes, children of the body, each placed at its centre as it rests on flat
   * ground, its axle along the body's x. Its radius and width are read from its bounds. The body
   * faces −z: the forward wheels steer.
   */
  wheels: readonly Object3D[];
}

/** The options a kind never reads (`vehicles.cpp`), and why: given, they would be ignored. */
const IGNORED: Readonly<Record<VehicleKind, Partial<Record<keyof VehicleSpec, string>>>> = {
  car: {
    trackTurn: 'it has no tracks',
    maxLean: 'it does not lean',
  },
  motorcycle: {
    drive: 'its rear wheel drives',
    trackTurn: 'it has no tracks',
    antiRoll: 'its two wheels are in line, on no shared axle',
  },
  tracked: {
    clutch: 'its engine drives its tracks',
    drive: 'the rearmost wheel of each track drives',
    turnRadius: 'it has no steered wheels, it steers by its tracks',
    antiRoll: 'its wheels carry no anti-roll bars',
    maxLean: 'it does not lean',
  },
};

/** Throws `RangeError` on what no vehicle of its kind can be made of, or an option it would
 *  ignore (`options`, as given; `IGNORED`). */
function refuse({ kind, body, wheels, spec }: Vehicle, options: Partial<VehicleSpec>) {
  const fail = (why: string) => {
    throw new RangeError(`A ${kind}: ${why}.`);
  };
  if (wheels.some((wheel) => wheel.parent !== body)) fail('its wheels are children of its body');
  if (wheels.some((wheel) => wheel.localBounds()?.isEmpty() ?? true)) fail('a wheel has no bounds');
  const side = (left: boolean) => wheels.filter((wheel) => wheel.position.x < 0 === left).length;
  if (kind === 'tracked' && (side(true) < 2 || side(false) < 2))
    fail('two wheels or more on each side');
  if (kind === 'car' && wheels.length < 3) fail('three wheels or more');
  if (kind === 'motorcycle' && wheels.length !== 2) fail('two wheels');
  if (spec.gears.length < 1 || spec.gears.length > MAX_GEARS) fail(`1 to ${MAX_GEARS} gears`);
  const points = spec.torqueCurve.length;
  if (points < 1 || points > TORQUE_POINTS) fail(`1 to ${TORQUE_POINTS} torque curve points`);
  for (const [option, why] of Object.entries(IGNORED[kind]))
    if (options[option as keyof VehicleSpec] !== undefined) fail(`no ${option}: ${why}`);
  // A spring sags `g / (2π f)²` under its share of the weight (the static deflection of a ride
  // frequency, on Earth); past its travel the body would rest on its bump stops.
  const sag = GRAVITY_PRESETS.earth / (2 * Math.PI * spec.suspensionFrequency) ** 2;
  if (!(sag < spec.suspensionTravel))
    fail(
      `a suspensionTravel longer than its sag, g / (2π suspensionFrequency)² = ${sag.toFixed(3)} m`,
    );
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

/**
 * A vehicle: a body carried on wheels by Jolt's vehicle constraint, with its engine, gearbox,
 * differentials, suspension and anti-roll bars, made by `vehicle.*` and added to the simulation
 * by `world.physics.add`. It is a `VehicleDriver`: `world.controls.vehicle = car` drives it.
 */
export class Vehicle implements VehicleDriver {
  private readonly _input: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  /** The world simulating this vehicle, set while it does: told when the input changes. */
  _host: { drive(vehicle: Vehicle): void } | null = null;
  /** The vehicle's id in the simulation (slot and generation), -1 outside one. */ _id = -1;
  private _speed = 0;
  private _rpm = 0;
  private _gear = 0;

  /** What the vehicle is. */ readonly kind: VehicleKind;
  /** The body the wheels carry. */ readonly body: Object3D;
  /** The wheels, children of the body. */ readonly wheels: readonly Object3D[];
  /** The machine: the kind's own (`VEHICLE_SPECS`), with the options over it. */
  readonly spec: Readonly<VehicleSpec>;

  constructor(kind: VehicleKind, body: Object3D, options: VehicleOptions) {
    const { wheels, ...spec } = options;
    this.kind = kind;
    this.body = body;
    this.wheels = [...wheels];
    this.spec = Object.freeze({ ...VEHICLE_SPECS[kind], ...spec });
    refuse(this, spec);
  }
  /** The pedals and the wheel it hears now. */
  get input(): Readonly<VehicleInput> {
    return this._input;
  }
  /** Metres per second forward after the last step, negative backward. */
  get speed() {
    return this._speed;
  }
  /** The engine's revolutions per minute after the last step. */
  get rpm() {
    return this._rpm;
  }
  /** The gear after the last step: 1 and up forward, −1 reverse, 0 neutral. */
  get gear() {
    return this._gear;
  }
  drive(input: Readonly<VehicleInput>) {
    const next = this._input;
    next.throttle = clamp(input.throttle, 0, 1);
    next.brake = clamp(input.brake, 0, 1);
    next.steer = clamp(input.steer, -1, 1);
    next.handbrake = !!input.handbrake;
    this._host?.drive(this);
  }
  /** The simulation's state after a step. */
  _state(speed: number, rpm: number, gear: number) {
    this._speed = speed;
    this._rpm = rpm;
    this._gear = gear;
  }
}

const make = (kind: VehicleKind) => (body: Object3D, options: VehicleOptions) =>
  new Vehicle(kind, body, options);

/** The `vehicle` family: a body and its wheels, driven by `world.controls` `'vehicle'`. */
export const vehicle = {
  /** Three wheels or more on two axles or more, the forward ones steered, `drive` driven. */
  car: make('car'),
  /** Two wheels, the forward one steered, the rear one driven; it keeps itself upright. */
  motorcycle: make('motorcycle'),
  /** Wheels on two tracks, left and right, each driven by its rearmost wheel; it steers by
   *  slowing one track, and turns on the spot at a standstill. */
  tracked: make('tracked'),
};
