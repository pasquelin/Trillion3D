/**
 * A light helicopter as a spec: a rounded cabin under a glass canopy, a tapered tail boom, skids,
 * and a four-blade main rotor and two-blade tail rotor the page spins (roles `rotor`,
 * `tail-rotor`; the main hub is `anchors.spinner`).
 */
import type { Vec3 } from '../plan/contract.ts';
import { ALONG_Z, COMMON, crisp, landingLight, part, UPRIGHT } from './aircraft-parts.ts';
import { paint, SURFACES } from './surfaces.ts';
import type { VehicleDraft } from './vehicle-spec.ts';

export function helicopter(): VehicleDraft {
  const mast: Vec3 = [0, 3.1, 0.3],
    tail: Vec3 = [0.3, 2.55, -6.9],
    rotorBlade = crisp(
      [
        [0.3, -0.16],
        [5.6, -0.14],
        [5.6, 0.14],
        [0.3, 0.16],
      ],
      0.05,
    );
  return {
    id: 'helicopter',
    kind: 'helicopter',
    mass: 2400,
    surfaces: {
      ...COMMON,
      livery: paint('rescue-orange', [0.8, 0.2, 0.02]),
      skid: SURFACES.darkMetal,
    },
    parts: [
      part('sphere', [2.1, 2.1, 4.3], [0, 1.75, 0.4], 'livery', { segments: 96 }),
      part('sphere', [1.8, 1.4, 2.2], [0, 2.0, 1.4], 'glass', { segments: 64 }),
      part('rounded-box', [1.4, 0.7, 2.2], [0, 2.85, -0.2], 'livery', { bevel: 0.25, segments: 5 }),
      part('lathe', [1, 1, 1], [0, 2.2, -1.4], 'livery', {
        rotation: [Math.PI / 2 + 0.06, Math.PI, 0],
        segments: 32,
        profile: [
          [0.42, 0],
          [0.3, 1.5],
          [0.16, 5.4],
          [0.12, 5.9],
        ],
      }),
      part('extrude', [1, 1, 1], [0, 2.3, 0], 'livery', {
        rotation: UPRIGHT,
        outline: crisp(
          [
            [-6.3, 0],
            [-7.2, 1.3],
            [-7.6, 1.3],
            [-7.3, -0.3],
          ],
          0.08,
        ),
        depth: 0.1,
        bevel: 0.04,
        segments: 4,
        smooth: 3,
      }),
      ...[1, -1].flatMap((s) => [
        part('cylinder', [0.1, 3.6, 0.1], [s * 1.05, 0.08, 0.3], 'skid', {
          rotation: ALONG_Z,
          segments: 16,
        }),
        part('cylinder', [0.07, 0.9, 0.07], [s * 0.85, 0.5, 1.1], 'skid', {
          rotation: [0, 0, -s * 0.4],
          segments: 12,
        }),
        part('cylinder', [0.07, 0.9, 0.07], [s * 0.85, 0.5, -0.6], 'skid', {
          rotation: [0, 0, -s * 0.4],
          segments: 12,
        }),
      ]),
      part('cylinder', [0.2, 0.5, 0.2], [0, 3.3, 0.3], 'metal', { segments: 20 }),
      part('lathe', [1, 1, 1], mast, 'metal', {
        segments: 32,
        profile: [
          [0.02, 0.2],
          [0.35, 0.3],
          [0.4, 0.45],
          [0.25, 0.6],
          [0.02, 0.7],
        ],
        role: 'rotor',
      }),
      part('extrude', [1, 1, 1], [mast[0], mast[1] + 0.5, mast[2]], 'trim', {
        rotation: [Math.PI / 2, 0, 0],
        outline: rotorBlade,
        depth: 0.06,
        bevel: 0.025,
        segments: 3,
        smooth: 3,
        repeat: { count: 4, turn: { axis: 'y', pivot: mast, angle: Math.PI / 2 } },
        role: 'rotor',
      }),
      part('extrude', [1, 1, 1], tail, 'trim', {
        rotation: [0, Math.PI / 2, 0],
        outline: crisp(
          [
            [-0.06, 0.05],
            [0.06, 0.05],
            [0.05, 0.8],
            [-0.05, 0.8],
          ],
          0.02,
        ),
        depth: 0.03,
        bevel: 0.012,
        segments: 2,
        smooth: 3,
        repeat: { count: 2, turn: { axis: 'x', pivot: tail, angle: Math.PI } },
        role: 'tail-rotor',
      }),
    ],
    anchors: {
      wheels: [],
      eye: [0.35, 2.1, 1.6],
      chase: [0, 5, -18],
      lamps: [landingLight('search', [0, 0.6, 1.8])],
      spinner: { position: mast, axis: [0, 1, 0], radius: 5.6 },
    },
  };
}
