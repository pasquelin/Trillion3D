/** One side of the airliner: wing, tailplane, winglet, engine and pylon, flap fairings, windows. */
import type { Vec3 } from '../plan/contract.ts';
import { ALONG_Z, crisp, FLAT, part, UPRIGHT } from './aircraft-parts.ts';
import type { VehiclePart } from './vehicle-spec.ts';

/** Height of the fuselage axis above the ground, gear down. */
export const AXIS = 3.3;

/** The parts of one side, `side` = 1 for the left (+X), −1 for the right. */
export function wing(side: number): VehiclePart[] {
  const x = (v: number) => side * v,
    planform = crisp(
      [
        [x(1.8), 3.2],
        [x(8), -0.4],
        [x(17.2), -5.4],
        [x(17.6), -6.9],
        [x(8), -3.9],
        [x(1.8), -3.6],
      ],
      0.35,
    ),
    tail = crisp(
      [
        [x(1.2), -16.6],
        [x(6.4), -19.6],
        [x(6.6), -20.9],
        [x(1.2), -20.4],
      ],
      0.2,
    );
  const nacelle: Vec3 = [x(5.9), 1.6, 2.4];
  return [
    part('extrude', [1, 1, 1], [0, 2.3, 0], 'livery', {
      rotation: FLAT,
      outline: planform,
      depth: 0.55,
      bevel: 0.25,
      segments: 6,
      smooth: 3,
    }),
    part('extrude', [1, 1, 1], [0, AXIS + 0.9, 0], 'livery', {
      rotation: FLAT,
      outline: tail,
      depth: 0.3,
      bevel: 0.13,
      segments: 5,
      smooth: 3,
    }),
    part('extrude', [1, 1, 1], [x(17.4), 2.4, 0], 'accent', {
      rotation: [0, -Math.PI / 2, x(-0.3)],
      outline: crisp(
        [
          [-6.9, 0],
          [-5.4, 0],
          [-6.4, 2.2],
          [-7.0, 2.2],
        ],
        0.08,
      ),
      depth: 0.12,
      bevel: 0.05,
      segments: 3,
      smooth: 2,
    }),
    part('lathe', [1, 1, 1], nacelle, 'metal', {
      rotation: ALONG_Z,
      segments: 48,
      profile: [
        [0.95, -2.3],
        [1.08, -1.6],
        [1.12, 0],
        [1.05, 1.4],
        [1.0, 2.2],
        [1.04, 2.35],
        [0.92, 2.3],
      ],
    }),
    part('cylinder', [1.9, 0.1, 1.9], [nacelle[0], nacelle[1], 4.5], 'trim', {
      rotation: ALONG_Z,
      segments: 48,
    }),
    part('lathe', [1, 1, 1], [nacelle[0], nacelle[1], 4.5], 'trim', {
      rotation: ALONG_Z,
      segments: 32,
      profile: [
        [0.35, 0],
        [0.25, 0.35],
        [0.02, 0.6],
      ],
    }),
    part('lathe', [1, 1, 1], [nacelle[0], nacelle[1], 0.1], 'trim', {
      rotation: ALONG_Z,
      segments: 32,
      profile: [
        [0.02, -0.9],
        [0.45, -0.2],
        [0.55, 0],
      ],
    }),
    part('extrude', [1, 1, 1], [x(5.9), 2.4, 0], 'livery', {
      rotation: UPRIGHT,
      outline: crisp(
        [
          [0.4, -0.2],
          [4.6, -0.2],
          [3.6, 0.6],
          [1.2, 0.6],
        ],
        0.1,
      ),
      depth: 0.35,
      bevel: 0.12,
      segments: 3,
      smooth: 2,
    }),
    ...[3.5, 9, 13].map((span) =>
      part('lathe', [1, 1, 1], [x(span), 2.1, -3.2 - span * 0.35], 'livery', {
        rotation: ALONG_Z,
        segments: 24,
        profile: [
          [0.02, -2.2],
          [0.4, -1],
          [0.4, 0.8],
          [0.02, 1.5],
        ],
      }),
    ),
    part(
      'sphere',
      [0.3, 0.3, 0.3],
      [x(17.7), 2.5, -7.2],
      side > 0 ? 'portLight' : 'starboardLight',
      { segments: 16 },
    ),
    part('rounded-box', [0.05, 0.34, 0.24], [x(1.98), AXIS + 0.55, -9], 'glass', {
      bevel: 0.08,
      segments: 2,
      repeat: { count: 36, step: [0, 0, 0.53] },
    }),
    part('rounded-box', [0.06, 1.9, 0.95], [x(1.96), AXIS - 0.2, 9.5], 'livery', {
      bevel: 0.1,
      segments: 2,
    }),
  ];
}
