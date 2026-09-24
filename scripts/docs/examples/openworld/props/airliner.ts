/**
 * A 39 m twin-jet airliner (35 m span) as a spec, nose toward +Z, origin on the ground under
 * the centre of gravity, gear down: turned fuselage and nacelles, bevelled swept wings and
 * tail, window rows, a two-tyre nose gear and four-tyre main gear.
 */
import {
  ALONG_Z,
  COMMON,
  crisp,
  gear,
  landingLight,
  part,
  UPRIGHT,
  wheel,
} from './aircraft-parts.ts';
import { AXIS, wing } from './airliner-wing.ts';
import { paint, SURFACES } from './surfaces.ts';
import type { VehicleDraft } from './vehicle-spec.ts';

/** Fuselage radius along its length, tail (−22 m) to nose (+17.4 m). */
function fuselage(): [number, number][] {
  const profile: [number, number][] = [[0.02, -22.2]];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    profile.push([0.35 + 1.65 * Math.sin((t * Math.PI) / 2), -22 + 10 * t]);
  }
  for (let i = 1; i <= 8; i++) profile.push([2, -12 + 2.9 * i]);
  for (let i = 1; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    profile.push([2 * Math.cos(a) ** 0.8, 11.2 + 6.2 * Math.sin(a)]);
  }
  return profile;
}

export function airliner(): VehicleDraft {
  const wheels = [
    wheel([0, 0.45, 13], 0.45, 0.35, true),
    wheel([3.8, 0.6, -1], 0.6, 0.45, false),
    wheel([-3.8, 0.6, -1], 0.6, 0.45, false),
  ];
  return {
    id: 'airliner',
    kind: 'airliner',
    mass: 64000,
    surfaces: {
      ...COMMON,
      livery: SURFACES.whitePaint,
      accent: paint('airline-blue', [0.02, 0.08, 0.3]),
    },
    parts: [
      part('lathe', [1, 1, 1], [0, AXIS, 0], 'livery', {
        rotation: ALONG_Z,
        segments: 160,
        profile: fuselage(),
      }),
      part('extrude', [1, 1, 1], [0, AXIS + 1.4, 0], 'accent', {
        rotation: UPRIGHT,
        outline: crisp(
          [
            [-14.8, 0],
            [-18.5, 6.8],
            [-20.6, 6.8],
            [-21.2, 0],
          ],
          0.25,
        ),
        depth: 0.45,
        bevel: 0.2,
        segments: 5,
        smooth: 3,
      }),
      part('rounded-box', [2.4, 0.5, 0.9], [0, AXIS + 0.9, 15.9], 'glass', {
        rotation: [-0.5, 0, 0],
        bevel: 0.2,
        segments: 4,
      }),
      part('rounded-box', [4.2, 0.9, 9], [0, 1.45, -0.5], 'livery', { bevel: 0.4, segments: 4 }),
      ...wing(1),
      ...wing(-1),
      ...gear(wheels[0], 0, AXIS - 1.6, 2),
      ...gear(wheels[1], 1, 2.2, 2),
      ...gear(wheels[2], 2, 2.2, 2),
    ],
    anchors: {
      wheels,
      eye: [0.5, AXIS + 1.1, 15.4],
      chase: [0, 12, -55],
      lamps: [
        landingLight('landing-left', [2.6, 2.2, 2]),
        landingLight('landing-right', [-2.6, 2.2, 2]),
      ],
      exhausts: [
        [5.9, 1.6, 0],
        [-5.9, 1.6, 0],
      ],
    },
  };
}
