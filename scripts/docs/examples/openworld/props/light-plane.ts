/**
 * The player's plane: a 9 m-span high-wing single-engine tourer as a spec, nose toward +Z,
 * origin on the ground under the centre of gravity, tricycle gear. The propeller parts carry
 * the role `propeller`; the page spins them about `anchors.spinner`.
 */
import type { Vec3 } from '../plan/contract.ts';
import {
  ALONG_Z,
  COMMON,
  crisp,
  FLAT,
  gear,
  landingLight,
  part,
  UPRIGHT,
  wheel,
} from './aircraft-parts.ts';
import { paint, SURFACES } from './surfaces.ts';
import type { VehicleDraft } from './vehicle-spec.ts';

export function lightPlane(): VehicleDraft {
  const wheels = [
      wheel([0, 0.22, 2.0], 0.22, 0.14, true),
      wheel([1.15, 0.28, 0.1], 0.28, 0.16, false),
      wheel([-1.15, 0.28, 0.1], 0.28, 0.16, false),
    ],
    hub: Vec3 = [0, 1.35, 3.45],
    blade = crisp(
      [
        [-0.06, 0.1],
        [0.08, 0.1],
        [0.07, 0.95],
        [-0.02, 0.98],
      ],
      0.03,
    ),
    fuselage: [number, number][] = [
      [0.05, -5.0],
      [0.18, -4.6],
      [0.3, -3.6],
      [0.45, -2.4],
      [0.58, -1.2],
      [0.62, 0],
      [0.62, 1.2],
      [0.58, 2.2],
      [0.5, 3.0],
      [0.38, 3.35],
    ];
  return {
    id: 'light-plane',
    kind: 'plane',
    mass: 1100,
    surfaces: {
      ...COMMON,
      livery: SURFACES.whitePaint,
      accent: paint('plane-red', [0.5, 0.03, 0.02]),
    },
    parts: [
      part('lathe', [1.1, 1.25, 1], [0, 1.45, 0], 'livery', {
        rotation: ALONG_Z,
        segments: 64,
        profile: fuselage,
      }),
      part('lathe', [1, 1, 1], [0, 1.45, 2.3], 'accent', {
        rotation: ALONG_Z,
        segments: 64,
        profile: [
          [0.6, 0],
          [0.62, 0.4],
          [0.55, 0.9],
          [0.4, 1.15],
        ],
      }),
      part('rounded-box', [1.14, 0.62, 1.7], [0, 2.05, 0.9], 'glass', { bevel: 0.2, segments: 5 }),
      part('extrude', [1, 1, 1], [0, 2.45, 0], 'livery', {
        rotation: FLAT,
        outline: crisp(
          [
            [-4.5, 1.45],
            [4.5, 1.45],
            [4.5, -0.05],
            [-4.5, -0.05],
          ],
          0.25,
        ),
        depth: 0.2,
        bevel: 0.09,
        segments: 6,
        smooth: 5,
      }),
      part('extrude', [1, 1, 1], [0, 1.75, 0], 'livery', {
        rotation: FLAT,
        outline: crisp(
          [
            [-1.7, -4.2],
            [1.7, -4.2],
            [1.6, -5.0],
            [-1.6, -5.0],
          ],
          0.15,
        ),
        depth: 0.1,
        bevel: 0.045,
        segments: 4,
        smooth: 3,
      }),
      part('extrude', [1, 1, 1], [0, 1.7, 0], 'accent', {
        rotation: UPRIGHT,
        outline: crisp(
          [
            [-3.9, 0],
            [-4.9, 1.3],
            [-5.4, 1.3],
            [-5.1, 0],
          ],
          0.1,
        ),
        depth: 0.08,
        bevel: 0.035,
        segments: 4,
        smooth: 3,
      }),
      ...[1, -1].map((s) =>
        part('rounded-box', [0.05, 1.25, 0.1], [s * 1.35, 1.8, 0.8], 'metal', {
          rotation: [0, 0, s * 0.8],
          bevel: 0.02,
          segments: 2,
        }),
      ),
      ...[1, -1].map((s) =>
        part(
          'sphere',
          [0.12, 0.12, 0.12],
          [s * 4.5, 2.45, 0.6],
          s > 0 ? 'portLight' : 'starboardLight',
          { segments: 16 },
        ),
      ),
      ...[1, 2].map((i) =>
        part('lathe', [1, 1, 1], [wheels[i].position[0], 0.32, 0.1], 'accent', {
          rotation: ALONG_Z,
          segments: 32,
          profile: [
            [0.02, -0.5],
            [0.2, -0.2],
            [0.18, 0.3],
            [0.02, 0.5],
          ],
        }),
      ),
      ...gear(wheels[0], 0, 1.0),
      ...gear(wheels[1], 1, 0.9),
      ...gear(wheels[2], 2, 0.9),
      part('lathe', [1, 1, 1], hub, 'metal', {
        rotation: ALONG_Z,
        segments: 32,
        profile: [
          [0.2, -0.1],
          [0.19, 0.12],
          [0.1, 0.3],
          [0.02, 0.36],
        ],
        role: 'propeller',
      }),
      part('extrude', [1, 1, 1], hub, 'trim', {
        outline: blade,
        depth: 0.04,
        bevel: 0.018,
        segments: 3,
        smooth: 3,
        rotation: [0, 0.3, 0],
        repeat: { count: 2, turn: { axis: 'z', pivot: hub, angle: Math.PI } },
        role: 'propeller',
      }),
    ],
    anchors: {
      wheels,
      eye: [0.28, 2.05, 0.9],
      chase: [0, 3.5, -14],
      lamps: [landingLight('landing', [1.6, 2.3, 1.5])],
      spinner: { position: hub, axis: [0, 0, 1], radius: 0.98 },
    },
  };
}
