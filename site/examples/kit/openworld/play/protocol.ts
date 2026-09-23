import type { Marker, Mover, Road, Settlement, Wheel } from './types.ts';

/**
 * The messages between the page and the simulation worker, and the layout of the pose snapshot
 * the worker sends after every step. Positions in the snapshot are relative to the physics
 * origin it carries (a multiple of the tile, exact in float32), so centimetres survive ±25 km.
 */
export const MODES = ['foot', 'car', 'plane'] as const;
export const STEP = 1 / 60;

/** What the simulation needs of the world, cloned once into the worker. */
export type SimWorld = {
  seed: number;
  size: number;
  tile: number;
  heightSamples: number;
  roads: readonly Road[];
  settlements: readonly Settlement[];
  markers: readonly Marker[];
  movers: readonly Mover[];
  /** The player's car as the physics needs it: wheels (front pair first) and mass. */
  car: { wheels: readonly Wheel[]; mass?: number };
};

export type SimLimits = { radius: number; traffic: number; pedestrians: number };

/** Held keys and look, sent every frame; `use`, `jump` and `camera` count presses. */
export type Inputs = {
  forward: number;
  right: number;
  run: boolean;
  crouch: boolean;
  jump: number;
  use: number;
  brake: boolean;
  throttle: number;
  pitch: number;
  roll: number;
  yaw: number;
  lookYaw: number;
  lookPitch: number;
};

export const idleInputs = (): Inputs => ({
  forward: 0,
  right: 0,
  run: false,
  crouch: false,
  jump: 0,
  use: 0,
  brake: false,
  throttle: 0,
  pitch: 0,
  roll: 0,
  yaw: 0,
  lookYaw: 0,
  lookPitch: 0,
});

export type ToWorker =
  | {
      type: 'start';
      world: SimWorld;
      limits: SimLimits;
      heights: string;
      colliders: string | null;
      jolt: string;
      buffers: ArrayBuffer[];
    }
  | { type: 'inputs'; inputs: Inputs }
  | { type: 'teleport'; name: string }
  | { type: 'buffer'; buffer: ArrayBuffer };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'snapshot'; buffer: ArrayBuffer }
  | { type: 'error'; message: string };

/** Header slots of a snapshot. */
export const H = {
  time: 0,
  mode: 1,
  originX: 2,
  originZ: 3,
  /** The player: feet on foot, the body's origin in a vehicle. */
  x: 4,
  y: 5,
  z: 6,
  qx: 7,
  qy: 8,
  qz: 9,
  qw: 10,
  speed: 11,
  ground: 12,
  flags: 13,
  stamina: 14,
  throttle: 15,
  carSpawn: 16,
  planeSpawn: 17,
  bodies: 18,
  cached: 19,
  stepMs: 20,
  traffic: 21,
  pedestrians: 22,
  propeller: 23,
  size: 24,
} as const;

export const FLAG = {
  grounded: 1,
  loading: 2,
  stalled: 4,
  asphalt: 8,
  crouched: 16,
  running: 32,
} as const;

/** Floats per entry of each block after the header. */
export const BLOCK = {
  /** Car body pose, then four wheels' local poses: position and quaternion each. */
  car: 7 + 4 * 7,
  plane: 7,
  /** Traffic car: position, yaw, braking (0 or 1). */
  traffic: 5,
  /** Pedestrian: position, yaw, stride phase, gait (0 idle, 1 walk, 2 hurry). */
  pedestrian: 6,
  mover: 7,
} as const;

export type Layout = {
  car: number;
  plane: number;
  traffic: number;
  pedestrians: number;
  movers: number;
  length: number;
};

/** Where each block starts, for a world of `movers` movers and the given limits. */
export function layout(limits: SimLimits, movers: number): Layout {
  const car = H.size;
  const plane = car + BLOCK.car;
  const traffic = plane + BLOCK.plane;
  const pedestrians = traffic + limits.traffic * BLOCK.traffic;
  const moversAt = pedestrians + limits.pedestrians * BLOCK.pedestrian;
  const length = moversAt + movers * BLOCK.mover;
  return { car, plane, traffic, pedestrians, movers: moversAt, length };
}

/** How near a vehicle the walker must stand to get in, metres. */
export const REACH = { car: 6, plane: 14 } as const;

/** The spawn markers, in the order the snapshot's spawn indices count them. */
export const spawnsOf = (markers: readonly Marker[], vehicle: 'car' | 'plane') =>
  markers.filter(
    (marker): marker is Extract<Marker, { kind: 'spawn' }> =>
      marker.kind === 'spawn' && marker.vehicle === vehicle,
  );
