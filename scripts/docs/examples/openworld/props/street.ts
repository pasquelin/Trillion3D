/**
 * Street furniture at real size, standing on the origin, facing +Z (the side a driver reads):
 * street lamp (arm toward +X, its light in `STREET_LAMP_LIGHTS`), traffic light, road sign,
 * bench, fence segment (2.5 m along X, to be chained). Turned poles, bevelled edges.
 */
import type { PropMesh } from '../plan/contract.ts';
import { cylinder, lathe, sphere, tube, type ProfilePoint } from './round.ts';
import { bevelExtrude, roundedBox } from './smooth.ts';
import { SURFACES } from './surfaces.ts';
import { prop, transform } from './transform.ts';

const { darkMetal, steel, wood, emissiveLamp, whitePaint, signRed, concrete } = SURFACES;
const UPRIGHT = Math.PI / 2;

/** A turned pole `height` tall: a flared foot, a collar, a taper to `top`, a finial. */
function pole(height: number, foot: number, top: number, segments = 24) {
  const profile: ProfilePoint[] = [
    [foot * 1.6, 0],
    [foot * 1.6, 0.05],
    [foot * 1.25, 0.12],
    [foot * 1.05, 0.3],
    [foot * 1.3, 0.42],
    [foot * 1.3, 0.48],
    [foot, 0.56],
    ...Array.from({ length: 6 }, (_, i): ProfilePoint => {
      const t = (i + 1) / 6;
      return [foot + (top - foot) * t, 0.56 + (height - 0.66) * t];
    }),
    [top * 1.4, height - 0.06],
    [top * 0.6, height],
  ];
  return lathe(darkMetal, profile, { segments });
}

/** An 8 m pole, a curved arm reaching 1.6 m, a bevelled lamp head glowing underneath. */
const streetLamp = (): PropMesh =>
  prop('street-lamp', [
    transform(roundedBox(concrete, [0.5, 0.12, 0.5], 0.03, 2), { at: [0, -0.02, 0] }),
    pole(7.4, 0.1, 0.065),
    tube(
      darkMetal,
      Array.from({ length: 24 }, (_, i) => {
        const a = (Math.PI / 2) * (i / 23);
        return [
          0.55 * (1 - Math.cos(a)) + (i > 20 ? (i - 20) * 0.25 : 0),
          7.2 + 0.55 * Math.sin(a),
          0,
        ] as const;
      }),
      0.045,
      { segments: 12 },
    ),
    transform(roundedBox(darkMetal, [0.8, 0.16, 0.34], 0.06, 3), { at: [1.45, 7.8, 0] }),
    transform(roundedBox(emissiveLamp, [0.64, 0.03, 0.24], 0.012, 2), { at: [1.45, 7.78, 0] }),
  ]);

/** A 4.5 m signal pole, a bevelled three-lamp head facing +Z at 3.4 m, each lamp hooded. */
function trafficLight(): PropMesh {
  // Waiting on the engine: a per-node material switch, so one prop can show red, amber or green.
  const lamps = [SURFACES.signalRed, SURFACES.signalAmber, SURFACES.signalGreen].flatMap(
    (glow, i) => {
      const y = 4.2 - i * 0.33;
      return [
        transform(sphere(glow, 0.1, { segments: 20, rings: 10 }), {
          at: [0, y, 0.14],
          scale: [1, 1, 0.35],
        }),
        transform(cylinder(darkMetal, 0.13, 0.2, { segments: 20, caps: false }), {
          at: [0, y, 0.13],
          pitch: UPRIGHT,
        }),
      ];
    },
  );
  return prop('traffic-light', [
    pole(4.5, 0.08, 0.07, 20),
    transform(roundedBox(darkMetal, [0.36, 1.04, 0.26], 0.05, 3), { at: [0, 3.45, 0] }),
    transform(roundedBox(darkMetal, [0.56, 1.24, 0.03], 0.012, 2), { at: [0, 3.35, -0.14] }),
    ...lamps,
  ]);
}

/** A round prohibition sign on a 2.6 m post: bevelled red disc, white face, clamps. */
function roadSign(): PropMesh {
  const circle = (r: number) =>
    Array.from(
      { length: 48 },
      (_, k) =>
        [r * Math.cos((2 * Math.PI * k) / 48), r * Math.sin((2 * Math.PI * k) / 48)] as const,
    );
  return prop('road-sign', [
    pole(2.7, 0.035, 0.03, 16),
    transform(bevelExtrude(signRed, circle(0.35), 0.025, { bevel: 0.008, segments: 2 }), {
      at: [0, 2.3, 0.05],
    }),
    transform(bevelExtrude(whitePaint, circle(0.27), 0.012, { bevel: 0.004, segments: 1 }), {
      at: [0, 2.3, 0.065],
    }),
    ...[2.12, 2.48].map((y) =>
      transform(roundedBox(steel, [0.1, 0.05, 0.1], 0.01, 1), { at: [0, y, 0.02] }),
    ),
  ]);
}

/** A 1.8 m park bench: five bevelled slats on two cast legs, rolled armrests. */
function bench(): PropMesh {
  const leg = bevelExtrude(
      darkMetal,
      [
        [-0.28, 0],
        [-0.2, 0],
        [-0.05, 0.4],
        [0.2, 0],
        [0.28, 0],
        [0.1, 0.44],
        [-0.32, 0.9],
        [-0.38, 0.9],
        [-0.16, 0.44],
      ],
      0.06,
      { bevel: 0.012, segments: 2, smooth: 2 },
    ),
    slats = [0, 1, 2].map((i) =>
      transform(roundedBox(wood, [1.8, 0.04, 0.12], 0.012, 2), { at: [0, 0.42, -0.17 + i * 0.15] }),
    ),
    back = [0, 1].map((i) =>
      transform(roundedBox(wood, [1.8, 0.12, 0.04], 0.012, 2), {
        at: [0, 0.58 + i * 0.16, -0.28 + i * 0.04],
        pitch: -0.2,
      }),
    ),
    arms = [-0.8, 0.8].map((x) =>
      tube(
        darkMetal,
        [
          [x, 0.62, 0.22],
          [x, 0.64, 0],
          [x, 0.6, -0.22],
        ],
        0.02,
        { segments: 10 },
      ),
    );
  return prop('bench', [
    ...[-0.8, 0.8].map((x) => transform(leg, { at: [x, 0, 0], yaw: -UPRIGHT })),
    ...slats,
    ...back,
    ...arms,
  ]);
}

/** A 2.5 m timber fence bay along X: two bevelled posts with caps, two rails; chain bays. */
const fenceSegment = (): PropMesh =>
  prop('fence-segment', [
    ...[-1.2, 1.2].flatMap((x) => [
      transform(roundedBox(wood, [0.12, 1.2, 0.12], 0.015, 2), { at: [x, 0, 0] }),
      transform(roundedBox(wood, [0.15, 0.04, 0.15], 0.012, 2), { at: [x, 1.2, 0] }),
    ]),
    ...[0.45, 0.95].map((y) =>
      transform(roundedBox(wood, [2.5, 0.1, 0.04], 0.01, 2), { at: [0, y, 0.08] }),
    ),
  ]);

/** All street furniture. */
export const streetProps = (): PropMesh[] => [
  streetLamp(),
  trafficLight(),
  roadSign(),
  bench(),
  fenceSegment(),
];
