/** What a road vehicle is made from: its dimensions, its side profile, its headlamps. */
import type { Surface, Vec3 } from '../plan/contract.ts';
import type { PropLamp } from './lamps.ts';
import type { VehiclePart, VehicleSpec } from './vehicle-spec.ts';

export type RoadVehicle = {
  id: string;
  kind: VehicleSpec['kind'];
  mass: number;
  paint: Surface;
  /** Overall length, width, body height (sill to belt line), ground clearance. */
  length: number;
  width: number;
  body: number;
  clearance: number;
  wheelRadius: number;
  wheelbase: number;
  /** Glasshouse: length, height, z of its centre, and how far the screens lean in (m). */
  cabin: { length: number; height: number; z: number; rake?: number };
  /** Rear axles: 1, or 2 close together (a truck's tandem). */
  rearAxles?: 1 | 2;
  /** Anything else on the body (a truck's cargo box). */
  extra?: readonly VehiclePart[];
};

/** Low-beam headlight: ≈ 20 000 cd on axis, dipped slightly toward the road. */
export const headlamp = (id: string, offset: Vec3): PropLamp => ({
  id,
  type: 'spot',
  offset,
  direction: [0, -0.06, 1],
  cone: 0.45,
  color: [1, 0.96, 0.9],
  intensity: 20000,
  range: 80,
  night: true,
});

type Pt = readonly [number, number];

/** The side profile (z forward, y up): an arch over every axle, a sloped nose and tail. */
export function sideProfile(v: RoadVehicle, axles: readonly number[]): Pt[] {
  const front = v.length / 2,
    c = v.clearance,
    top = c + v.body,
    // The arch clears the tyre by 6 cm, and never reaches the belt line.
    arch = Math.min(v.wheelRadius + 0.06, top - v.wheelRadius - 0.1),
    bottom: Pt[] = [[-front + 0.2, c]];
  for (const z of [...axles].sort((a, b) => a - b)) {
    bottom.push([z - arch, c]);
    for (let k = 0; k <= 8; k++) {
      const a = Math.PI * (1 - k / 8);
      bottom.push([z + arch * Math.cos(a), v.wheelRadius + arch * Math.sin(a)]);
    }
    bottom.push([z + arch, c]);
  }
  return [
    ...bottom,
    [front - 0.15, c],
    [front, c + v.body * 0.3],
    [front - 0.06, c + v.body * 0.75],
    [front - 0.4, top - 0.02],
    [-front + 0.3, top],
    [-front + 0.02, c + v.body * 0.75],
    [-front, c + v.body * 0.3],
  ];
}
