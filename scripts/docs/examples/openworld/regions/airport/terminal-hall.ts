/**
 * The terminal's central hall, 72 m wide between the bays: a wave roof rolling over the whole
 * space on four steel trees, full-height glass on both faces, check-in islands with their belts
 * and queue lanes, an escalator bank up to the departures mezzanine, shops and flight boards.
 */
import type { MeshPart, PropMesh, Surface, Vec3 } from '../../plan/contract.ts';
import { box, lathe, meshPart, prop, quads, SURFACES, transform, tube } from '../../props/index.ts';
import { AIRPORT, LIGHTS } from './palette.ts';
import { checkIn, escalators, seatRow, shops } from './interior.ts';
import { repeat } from './parts.ts';
import { BAY, curtainWall } from './terminal.ts';

export const HALL = { width: 72, depth: BAY.depth, eave: 22, overhang: 8 } as const;
const HALF = HALL.width / 2,
  Z = HALL.depth / 2,
  /** Glass up to here; above, a band follows the roof. */
  GLASS = 18;

/** The roof's height at (x, z): an arch across the hall, rolling in two waves front to back. */
const roofY = (x: number, z: number) =>
  HALL.eave + 3 * Math.cos((x / HALF) * (Math.PI / 2)) + 1.2 * Math.sin((z / 36) * 2 * Math.PI);

/** The roof as a grid over the hall and its airside overhang, top face and soffit. */
function waveRoof(nx: number, nz: number): MeshPart[] {
  const z0 = -Z - 2,
    z1 = Z + HALL.overhang,
    positions: number[] = [],
    top: number[] = [],
    under: number[] = [];
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const x = -HALF + (HALL.width * i) / nx,
        z = z0 + ((z1 - z0) * j) / nz;
      positions.push(x, roofY(x, z), z);
    }
  const at = (i: number, j: number) => i * (nz + 1) + j;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const [a, b, c, d] = [at(i, j), at(i, j + 1), at(i + 1, j), at(i + 1, j + 1)];
      top.push(a, b, c, c, b, d);
      under.push(a, c, b, c, d, b);
    }
  const soffit = positions.map((v, k) => (k % 3 === 1 ? v - 0.6 : v));
  return [
    meshPart(AIRPORT.roofMembrane, positions, top),
    meshPart(AIRPORT.aluminium, soffit, under),
  ];
}

/** A two-sided band from `bottom` up to the roof's soffit along a wall from `a` to `b`. */
function band(surface: Surface, a: [number, number], b: [number, number], bottom: number) {
  const n = 24,
    faces = Array.from({ length: n }, (_, k): Vec3[] => {
      const [x0, z0] = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n],
        [x1, z1] = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n];
      return [
        [x0, bottom, z0],
        [x1, bottom, z1],
        [x1, roofY(x1, z1) - 0.6, z1],
        [x0, roofY(x0, z0) - 0.6, z0],
      ];
    });
  return quads(surface, [...faces, ...faces.map((face) => [...face].reverse())]);
}

/** A steel tree: a tapered trunk, four branches reaching up to the roof. */
function tree(x: number, z: number): MeshPart[] {
  const fork = 12;
  return [
    transform(
      lathe(
        SURFACES.whitePaint,
        [
          [0.9, 0],
          [0.6, fork - 1],
          [1.1, fork],
        ],
        { segments: 32 },
      ),
      { at: [x, 0, z] },
    ),
    ...[0, 1, 2, 3].map((k) => {
      const a = Math.PI / 4 + (k * Math.PI) / 2,
        tx = x + 9 * Math.cos(a),
        tz = z + 9 * Math.sin(a);
      return tube(
        SURFACES.whitePaint,
        [
          [x, fork, z],
          [x + 4 * Math.cos(a), fork + 5, z + 4 * Math.sin(a)],
          [tx, roofY(tx, tz) - 0.6, tz],
        ],
        [0.45, 0.35, 0.25],
        { segments: 16 },
      );
    }),
  ];
}

export const terminalHall = (): PropMesh =>
  prop('airport/terminal-hall', [
    transform(box(SURFACES.concrete, [HALL.width, BAY.plinth + 0.2, HALL.depth]), {
      at: [0, -BAY.plinth, 0],
    }),
    transform(box(AIRPORT.floor, [HALL.width, 0.2, HALL.depth]), { at: [0, 0, 0] }),
    transform(box(AIRPORT.carpet, [HALL.width, 0.4, 16]), { at: [0, BAY.upper - 0.4, 22] }),
    transform(box(AIRPORT.curtain, [HALL.width, 1.1, 0.03]), { at: [0, BAY.upper, 14] }),
    ...waveRoof(96, 80),
    ...[-1, 1].flatMap((side) => tree(side * 16, -8).concat(tree(side * 16, 12))),
    ...[-1, 1].map((side) =>
      transform(box(AIRPORT.cladding, [0.3, GLASS, HALL.depth]), {
        at: [side * (HALF - 0.15), 0, 0],
      }),
    ),
    ...[-1, 1].map((side) => band(AIRPORT.cladding, [side * HALF, -Z], [side * HALF, Z], GLASS)),
    ...curtainWall(HALL.width, GLASS, 1.5, 1.5).map((p) => transform(p, { at: [0, 0, Z] })),
    ...curtainWall(HALL.width, GLASS, 1.5, 1.5).map((p) =>
      transform(p, { at: [0, 0, -Z], yaw: Math.PI }),
    ),
    ...[-1, 1].map((side) => band(AIRPORT.curtain, [-HALF, side * Z], [HALF, side * Z], GLASS)),
    ...[-24, -12, 12, 24].flatMap(checkIn),
    ...escalators(0, -2),
    ...shops([-26, -14, 14, 26], 16).map((p) => transform(p, { at: [0, BAY.upper, 0] })),
    ...[0, 1, 2].flatMap((row) =>
      [-20, 0, 20].flatMap((x) =>
        seatRow(14).map((p) => transform(p, { at: [x, BAY.upper, 25 + row * 1.6] })),
      ),
    ),
    ...repeat(box(LIGHTS.ceiling, [5, 1.6, 0.15]), 3, [-12, 9, -Z + 12], [12, 0, 0]),
  ]);
