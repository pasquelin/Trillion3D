/**
 * The road-vehicle builder: a handful of real dimensions become a bevelled body extruded from
 * its side profile (wheel arches cut in), a rounded glasshouse, bumpers, lamps, mirrors, seats
 * and full wheels with their physics anchors. The models are in `car-models.ts`.
 */
import type { Vec3 } from '../plan/contract.ts';
import { headlamp, sideProfile, type RoadVehicle } from './car-profile.ts';
import { SURFACES } from './surfaces.ts';
import type { VehicleDraft, VehiclePart, WheelAnchor } from './vehicle-spec.ts';
import { wheelParts } from './wheels.ts';

export function roadVehicle(v: RoadVehicle): VehicleDraft {
  const half = v.width / 2,
    tyre = Math.min(0.34, v.wheelRadius * 0.7),
    front = v.length / 2,
    belt = v.clearance + v.body,
    lampY = v.clearance + v.body * 0.62,
    rake = v.cabin.rake ?? v.cabin.height * 0.7,
    cz = v.cabin.z,
    cl = v.cabin.length / 2;
  const axles = [v.wheelbase / 2, -v.wheelbase / 2];
  // A tandem axle sits one arch and a hand's width behind the first.
  if (v.rearAxles === 2) axles.push(-v.wheelbase / 2 - 2 * (v.wheelRadius + 0.06) - 0.2);
  const wheels: WheelAnchor[] = axles.flatMap((z, a) =>
    [1, -1].map((side) => ({
      position: [side * (half - tyre / 2 - 0.03), v.wheelRadius, z] as Vec3,
      radius: v.wheelRadius,
      width: tyre,
      steers: a === 0,
      drives: a > 0,
    })),
  );
  const side = { rotation: [0, -Math.PI / 2, 0] as Vec3, size: [1, 1, 1] as Vec3, segments: 5 };
  const pair = (make: (s: number) => VehiclePart) => [1, -1].map(make);
  const parts: VehiclePart[] = [
    {
      shape: 'extrude',
      outline: sideProfile(v, axles),
      depth: v.width,
      bevel: 0.12,
      smooth: 3,
      position: [0, 0, 0],
      surface: 'paint',
      ...side,
    },
    {
      shape: 'extrude',
      outline: [
        [cz - cl, 0],
        [cz + cl, 0],
        [cz + cl - rake, v.cabin.height],
        [cz - cl + rake * 0.6, v.cabin.height],
      ],
      depth: v.width * 0.86,
      bevel: 0.1,
      smooth: 2,
      position: [0, belt - 0.03, 0],
      surface: 'glass',
      ...side,
    },
    {
      shape: 'rounded-box',
      size: [v.width * 0.8, 0.05, v.cabin.length - rake * 1.5],
      position: [0, belt + v.cabin.height - 0.01, cz - rake * 0.2],
      surface: 'paint',
      bevel: 0.02,
      segments: 2,
    },
    ...pair((end) => ({
      shape: 'rounded-box',
      size: [v.width * 0.98, 0.2, 0.18],
      position: [0, v.clearance + 0.12, end * (front - 0.08)],
      surface: 'trim',
      bevel: 0.07,
      segments: 4,
    })),
    {
      shape: 'rounded-box',
      size: [v.width * 0.45, v.body * 0.22, 0.05],
      position: [0, lampY - 0.05, front - 0.03],
      surface: 'trim',
      bevel: 0.02,
      segments: 2,
    },
    ...pair((s) => ({
      shape: 'sphere',
      size: [0.32, 0.13, 0.1],
      position: [s * (half - 0.28), lampY, front - 0.06],
      surface: 'headlight',
      segments: 20,
    })),
    ...pair((s) => ({
      shape: 'rounded-box',
      size: [0.34, 0.1, 0.06],
      position: [s * (half - 0.26), lampY, -front + 0.04],
      surface: 'taillight',
      bevel: 0.03,
      segments: 3,
    })),
    ...pair((s) => ({
      shape: 'rounded-box',
      size: [0.2, 0.11, 0.08],
      position: [s * (half + 0.06), belt + 0.08, cz + cl - 0.1],
      surface: 'paint',
      bevel: 0.035,
      segments: 3,
    })),
    ...pair((s) => ({
      shape: 'rounded-box',
      size: [0.5, 0.75, 0.55],
      position: [s * half * 0.45, belt - 0.05, cz + cl * 0.1],
      surface: 'trim',
      bevel: 0.1,
      segments: 3,
    })),
    {
      shape: 'cylinder',
      size: [0.08, 0.25, 0.08],
      position: [-half * 0.5, v.clearance + 0.05, -front - 0.02],
      rotation: [Math.PI / 2, 0, 0],
      surface: 'rim',
      segments: 16,
    },
    ...wheels.flatMap((wheel, i) => wheelParts(wheel, i)),
    ...(v.extra ?? []),
  ];
  return {
    id: v.id,
    kind: v.kind,
    mass: v.mass,
    surfaces: {
      paint: v.paint,
      glass: SURFACES.glass,
      trim: SURFACES.darkMetal,
      tyre: SURFACES.rubber,
      rim: SURFACES.steel,
      headlight: SURFACES.headlight,
      taillight: SURFACES.taillight,
      cargo: SURFACES.whitePaint,
    },
    parts,
    anchors: {
      wheels,
      eye: [half * 0.45, belt + v.cabin.height * 0.55, cz + cl * 0.1],
      chase: [0, belt + v.cabin.height + 1.6, -front - 5],
      lamps: [1, -1].map((s) =>
        headlamp(s > 0 ? 'left' : 'right', [s * (half - 0.28), lampY, front + 0.05]),
      ),
    },
  };
}
