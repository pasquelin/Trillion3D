/**
 * Rooftop equipment, placed as their own nodes on the flat roofs of towers and blocks: a timber
 * water tank on a steel stand, a telecom mast with dishes, a condenser unit with two fans, and
 * a raised helipad with its marking and edge lights. Each stands on y = 0 (the roof).
 */
import type { MeshPart, PropMesh } from '../../plan/contract.ts';
import {
  box,
  cone,
  cylinder,
  prop,
  quads,
  SURFACES,
  sphere,
  transform,
  tube,
} from '../../props/index.ts';
import { CITY } from './surfaces.ts';

const { steel, darkMetal } = SURFACES;

/** A vertical steel strut from `a` to `b` (both on the ground plane at heights ya, yb). */
const strut = (x: number, z: number, y0: number, y1: number, r = 0.08): MeshPart =>
  tube(
    steel,
    [
      [x, y0, z],
      [x, y1, z],
    ],
    r,
    { segments: 6 },
  );

const waterTank = (): PropMesh =>
  prop('city/water-tank', [
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => strut(sx * 1.6, sz * 1.6, 0, 4.2, 0.12))),
    transform(box(steel, [3.8, 0.25, 3.8]), { at: [0, 4, 0] }),
    transform(cylinder(CITY.tank, 2.3, 4.5, { top: 2.15, segments: 20 }), { at: [0, 4.25, 0] }),
    ...[0.6, 2.2, 3.8].map((y) =>
      transform(cylinder(darkMetal, 2.34, 0.08, { segments: 20, caps: false }), {
        at: [0, 4.25 + y, 0],
      }),
    ),
    transform(cone(CITY.tank, 2.4, 1.5, { segments: 20 }), { at: [0, 8.75, 0] }),
    tube(
      steel,
      [
        [2.2, 0, 0],
        [2.2, 9, 0],
      ],
      0.04,
      { segments: 4 },
    ),
  ]);

const antennaMast = (): PropMesh => {
  const legs = [0, 1, 2].map((i) => {
    const a = (i * 2 * Math.PI) / 3;
    return tube(
      steel,
      [
        [Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2],
        [Math.cos(a) * 0.3, 18, Math.sin(a) * 0.3],
      ],
      0.07,
      { segments: 5 },
    );
  });
  const braces = [3, 7, 11, 15].map((y) =>
    transform(cylinder(steel, 1.2 - (y / 18) * 0.9, 0.08, { segments: 3, caps: false }), {
      at: [0, y, 0],
    }),
  );
  const dishes = [0, 2.1, 4.2].map((a, i) =>
    transform(cone(CITY.aircon, 0.7, 0.35, { segments: 14 }), {
      at: [Math.cos(a) * 0.6, 10 + i * 2.5, Math.sin(a) * 0.6],
      roll: Math.PI / 2,
      yaw: a,
    }),
  );
  return prop('city/antenna-mast', [
    ...legs,
    ...braces,
    ...dishes,
    transform(cylinder(steel, 0.08, 8, { top: 0.03, segments: 6 }), { at: [0, 18, 0] }),
    transform(sphere(CITY.aviation, 0.25, { segments: 8, rings: 4 }), { at: [0, 26.1, 0] }),
  ]);
};

const acUnit = (): PropMesh =>
  prop('city/ac-unit', [
    box(CITY.aircon, [4, 1.6, 2]),
    ...[-1, 1].flatMap((s) => [
      transform(cylinder(darkMetal, 0.75, 0.12, { segments: 16 }), { at: [s, 1.6, 0] }),
      transform(box(steel, [1.5, 0.05, 0.08]), { at: [s, 1.75, 0], yaw: s }),
    ]),
    transform(box(darkMetal, [3.8, 1.2, 0.04]), { at: [0, 0.2, 1.01] }),
  ]);

/** A 20 m deck 5 m over the roof on eight legs, a yellow circle and H, amber edge lamps. */
const helipad = (): PropMesh => {
  const legs = [-1, 0, 1].flatMap((sx) =>
    [-1, 1].map((sz) => strut(sx * 8.5, sz * 8.5, 0, 5, 0.2)),
  );
  const ring = Array.from({ length: 24 }, (_, i) => {
    const a = (i * Math.PI * 2) / 24,
      b = ((i + 1) * Math.PI * 2) / 24;
    const p = (r: number, t: number) => [r * Math.cos(t), 5.46, r * Math.sin(t)] as const;
    return [p(7, a), p(6.4, a), p(6.4, b), p(7, b)];
  });
  const h = [
    [-2.2, -3, -1.4, 3],
    [1.4, -3, 2.2, 3],
    [-1.4, -0.4, 1.4, 0.4],
  ].map(
    ([x0, z0, x1, z1]) =>
      [
        [x0, 5.46, z0],
        [x0, 5.46, z1],
        [x1, 5.46, z1],
        [x1, 5.46, z0],
      ] as const,
  );
  const lamps = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return transform(sphere(SURFACES.signalAmber, 0.15, { segments: 6, rings: 4 }), {
      at: [Math.cos(a) * 9.6, 5.6, Math.sin(a) * 9.6],
    });
  });
  return prop('city/helipad', [
    ...legs,
    transform(box(CITY.helipad, [20, 0.45, 20]), { at: [0, 5, 0] }),
    quads(CITY.heliMark, [...ring, ...h]),
    ...lamps,
    ...[-1, 1].map((s) =>
      transform(box(CITY.railing, [20, 0.08, 0.08]), { at: [0, 6.1, s * 10.1] }),
    ),
  ]);
};

export const rooftopProps = (): PropMesh[] => [waterTank(), antennaMast(), acUnit(), helipad()];
