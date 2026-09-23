/**
 * The ridge observatory: a white drum on a stone plinth, a railed catwalk around it, a mast
 * with a red beacon, and a dome with its observing slit and the telescope inside. The dome is
 * a prop of its own, turned by a `spin` mover; it sits at `DOME_HEIGHT` above the base's origin.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import {
  cylinder,
  lathe,
  prop,
  quads,
  sphere,
  SURFACES,
  transform,
  tube,
  type PropLamp,
} from '../../props/index.ts';
import { BASEMENT } from './chalet.ts';
import { boxAt } from './parts.ts';
import { MOUNTAIN_SURFACES as S } from './surfaces.ts';

const DRUM = 7;
export const DOME_HEIGHT = 8.2;
const MAST: Vec3 = [-9.5, 0, -3];

/** A circle of `n` points of radius `r` at height `y`. */
const ring = (r: number, y: number, n: number): Vec3[] =>
  Array.from({ length: n + 1 }, (_, i): Vec3 => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });

export function observatoryBase(): PropMesh {
  const parts: MeshPart[] = [
    transform(cylinder(S.stoneWall, DRUM + 1, BASEMENT + 1, { segments: 48 }), {
      at: [0, -BASEMENT, 0],
    }),
    transform(cylinder(S.domeWhite, DRUM, DOME_HEIGHT - 1, { segments: 48 }), { at: [0, 1, 0] }),
    lathe(
      S.concrete,
      [
        [DRUM, 5.8],
        [DRUM + 1.4, 5.8],
        [DRUM + 1.4, 6.0],
        [DRUM, 6.0],
      ],
      { segments: 48 },
    ),
    boxAt(S.darkWood, [1.4, 2.4, 0.2], { at: [0, 1, DRUM - 0.05] }),
    boxAt(S.concrete, [2.2, 0.2, 1.4], { at: [0, 3.5, DRUM + 0.5] }),
  ];
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    parts.push(
      boxAt(SURFACES.steel, [0.06, 1.1, 0.06], {
        at: [Math.cos(a) * (DRUM + 1.3), 6, Math.sin(a) * (DRUM + 1.3)],
      }),
    );
  }
  for (const y of [6.55, 7.1])
    parts.push(tube(SURFACES.steel, ring(DRUM + 1.3, y, 64), 0.035, { segments: 5 }));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    parts.push(
      boxAt(SURFACES.glass, [1.0, 0.8, 0.05], {
        at: [Math.cos(a) * (DRUM + 0.01), 3, Math.sin(a) * (DRUM + 0.01)],
        yaw: Math.PI / 2 - a,
      }),
    );
  }
  parts.push(
    transform(cylinder(SURFACES.steel, 0.12, 14, { top: 0.06, segments: 8 }), { at: MAST }),
    transform(sphere(S.beacon, 0.2, { segments: 10, rings: 6 }), { at: [MAST[0], 14.2, MAST[2]] }),
    boxAt(S.concrete, [1.4, 1, 1.4], { at: [MAST[0], -0.5, MAST[2]] }),
  );
  for (const y of [5, 9, 13])
    parts.push(boxAt(SURFACES.steel, [1.4, 0.05, 0.05], { at: [MAST[0], y, MAST[2]] }));
  return prop('mountains/observatory', parts);
}

/** The dome: a hemisphere of quads with its slit (toward +Z, over the top), ribs and telescope. */
export function observatoryDome(): PropMesh {
  const r = DRUM + 0.15,
    lon = 64,
    lat = 20,
    slit = 0.8,
    at = (i: number, j: number): Vec3 => {
      const a = (i / lon) * Math.PI * 2,
        b = (j / lat) * (Math.PI / 2);
      return [Math.sin(a) * Math.cos(b) * r, Math.sin(b) * r, Math.cos(a) * Math.cos(b) * r];
    };
  const faces: Vec3[][] = [];
  for (let i = 0; i < lon; i++)
    for (let j = 0; j < lat; j++) {
      const corners = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)],
        cx = corners.reduce((s, p) => s + p[0], 0) / 4,
        cz = corners.reduce((s, p) => s + p[2], 0) / 4;
      if (Math.abs(cx) < slit && cz > -1.5) continue;
      faces.push(j + 1 === lat ? corners.slice(0, 3) : corners);
    }
  const parts: MeshPart[] = [
    quads(S.domeWhite, faces),
    lathe(
      SURFACES.darkMetal,
      [
        [r, -0.3],
        [r + 0.2, -0.3],
        [r + 0.2, 0.2],
        [r, 0.2],
      ],
      { segments: 64 },
    ),
  ];
  for (const side of [-1, 1]) {
    const edge = Array.from({ length: 13 }, (_, k): Vec3 => {
      const b = (k / 12) * (Math.PI / 2 + 0.2);
      return [side * (slit + 0.1), Math.sin(b) * (r + 0.1), Math.cos(b) * (r + 0.1)];
    });
    parts.push(tube(SURFACES.darkMetal, edge, 0.12, { segments: 6 }));
  }
  parts.push(
    transform(cylinder(SURFACES.darkMetal, 0.6, 1.5, { segments: 16 }), {
      at: [0, -DOME_HEIGHT + 1, 0],
    }),
    boxAt(SURFACES.darkMetal, [1.6, 1.2, 1.2], { at: [0, -DOME_HEIGHT + 2.5, 0] }),
    transform(cylinder(S.domeWhite, 0.55, 5.5, { top: 0.5, segments: 20 }), {
      at: [0, -DOME_HEIGHT + 3.4, -1.6],
      pitch: 0.75,
    }),
  );
  return prop('mountains/observatory-dome', parts);
}

export const OBSERVATORY_LAMPS: readonly PropLamp[] = [
  {
    id: 'beacon',
    type: 'point',
    offset: [MAST[0], 14.2, MAST[2]],
    color: [1, 0.05, 0.02],
    intensity: 60,
    range: 30,
    night: true,
  },
  {
    id: 'door',
    type: 'point',
    offset: [0, 3.3, DRUM + 0.9],
    color: [1, 0.8, 0.6],
    intensity: 150,
    range: 12,
    night: true,
  },
];
