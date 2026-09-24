/**
 * The terminal, built from 36 m bays laid side by side along X. A bay is 60 m deep, its airside
 * face (+Z) a full-height glass curtain wall on a grid of mullions and transoms; its landside
 * face (−Z) clad, with glazed entrances under a canopy over the curb. Inside: the arrivals hall,
 * the departures floor at 6 m behind a glass balustrade, gate lounges with rows of seats, and a
 * barrel-vaulted roof on steel arches, lit from beneath at night.
 */
import type { MeshPart, PropMesh } from '../../plan/contract.ts';
import { box, cylinder, prop, SURFACES, transform } from '../../props/index.ts';
import { AIRPORT, LIGHTS } from './palette.ts';
import { escalators, seatRow, shops, UPPER } from './interior.ts';
import { gable, latticeArch, member, repeat, vault } from './parts.ts';

export const BAY = {
  width: 36,
  depth: 60,
  eave: 16,
  rise: 4,
  canopy: 5,
  plinth: 3,
  upper: UPPER,
} as const;
const HALF = BAY.width / 2,
  Z = BAY.depth / 2;

/** A curtain wall `width` wide and `height` tall at z = 0, facing +Z: glass behind a grid. */
export function curtainWall(width: number, height: number, bayX: number, bayY: number) {
  const nx = Math.round(width / bayX),
    ny = Math.round(height / bayY),
    { mullion, curtain } = AIRPORT;
  return [
    transform(box(curtain, [width, height, 0.04]), { at: [0, 0, -0.1] }),
    ...Array.from({ length: nx + 1 }, (_, i) =>
      transform(box(mullion, [0.14, height, 0.3]), { at: [-width / 2 + (i * width) / nx, 0, 0] }),
    ),
    ...Array.from({ length: ny + 1 }, (_, j) =>
      transform(box(mullion, [width, 0.12, 0.22]), {
        at: [0, Math.min((j * height) / ny, height - 0.12), 0],
      }),
    ),
    // Point fixings at every node of the grid, and the slim caps that hold each pane.
    ...Array.from({ length: (nx + 1) * (ny + 1) }, (_, k) =>
      transform(box(AIRPORT.aluminium, [0.16, 0.16, 0.1]), {
        at: [
          -width / 2 + ((k % (nx + 1)) * width) / nx,
          Math.min((Math.floor(k / (nx + 1)) * height) / ny, height - 0.16),
          0.2,
        ],
      }),
    ),
    ...Array.from({ length: nx + 1 }, (_, i) =>
      transform(box(AIRPORT.aluminium, [0.06, height, 0.06]), {
        at: [-width / 2 + (i * width) / nx, 0, 0.18],
      }),
    ),
  ];
}

function roof(): MeshPart[] {
  const arches = Array.from({ length: 6 }, (_, i) => -Z + 5 + i * 10).flatMap((z) =>
    latticeArch(SURFACES.steel, {
      half: HALF,
      rise: BAY.rise,
      y: BAY.eave - 0.3,
      z,
      chord: 1.2,
      segments: 24,
    }),
  );
  return [
    ...vault(
      AIRPORT.roofMembrane,
      [HALF, BAY.rise, BAY.depth + 6, BAY.eave],
      16,
      AIRPORT.aluminium,
    ),
    ...[-1, 1].map((side) =>
      gable(AIRPORT.cladding, [HALF, BAY.rise, side * (Z + 3), BAY.eave], 16),
    ),
    ...arches,
    ...Array.from({ length: 12 }, (_, i) =>
      transform(box(LIGHTS.ceiling, [1.2, 0.05, 1.2]), {
        at: [((i % 3) - 1) * 10, BAY.eave + 2.2, -Z + 7.5 + Math.floor(i / 3) * 15],
      }),
    ),
  ];
}

function interior(): MeshPart[] {
  const columns = [-12, 0, 12].flatMap((x) =>
    [-Z + 10, 0, Z - 10].map((z) =>
      transform(cylinder(SURFACES.whitePaint, 0.45, BAY.eave, { segments: 16 }), { at: [x, 0, z] }),
    ),
  );
  const seats = [0, 1, 2, 3, 4, 5].flatMap((row) =>
    [-9, 9].flatMap((x) =>
      seatRow(14).map((part) => transform(part, { at: [x, BAY.upper, 6 + row * 3.4] })),
    ),
  );
  const counters = [-10, 0, 10].map((x) =>
    transform(box(AIRPORT.cladding, [6, 1.1, 1.2]), { at: [x, 0.2, -12] }),
  );
  return [
    transform(box(AIRPORT.floor, [BAY.width, 0.2, BAY.depth]), { at: [0, 0, 0] }),
    transform(box(AIRPORT.carpet, [BAY.width, 0.4, 44]), { at: [0, BAY.upper - 0.4, 8] }),
    transform(box(AIRPORT.curtain, [BAY.width, 1.1, 0.03]), { at: [0, BAY.upper, -14] }),
    transform(box(SURFACES.steel, [BAY.width, 0.06, 0.1]), { at: [0, BAY.upper + 1.1, -14] }),
    ...columns,
    ...seats,
    ...counters,
    ...escalators(0, -9),
    ...shops([-12, 12], 4),
    transform(box(LIGHTS.ceiling, [8, 1.2, 0.1]), { at: [0, 9, -13.9] }),
  ];
}

function landside(): MeshPart[] {
  const doors = [-9, 9].map((x) =>
    transform(box(AIRPORT.curtain, [6, 3.2, 0.2]), { at: [x, 0.2, -Z - 0.05] }),
  );
  const canopyPosts = [-15, -5, 5, 15].map((x) =>
    member(
      SURFACES.steel,
      [x, 0, -Z - BAY.canopy + 0.3],
      [x, 5, -Z - BAY.canopy + 0.3],
      [0.25, 0.25],
    ),
  );
  return [
    transform(box(SURFACES.concrete, [BAY.width, BAY.plinth + 0.2, BAY.depth]), {
      at: [0, -BAY.plinth, 0],
    }),
    transform(box(AIRPORT.cladding, [BAY.width, BAY.eave - 0.2, 0.3]), { at: [0, 0.2, -Z] }),
    transform(box(AIRPORT.curtain, [BAY.width - 2, 2.2, 0.1]), { at: [0, 9, -Z - 0.12] }),
    ...doors,
    ...[-1, 1].map((side) =>
      transform(box(AIRPORT.cladding, [0.3, BAY.eave, BAY.depth]), {
        at: [side * (HALF - 0.15), 0, 0],
      }),
    ),
    ...canopyPosts,
    transform(box(AIRPORT.curtain, [BAY.width, 0.08, BAY.canopy]), {
      at: [0, 5.2, -Z - BAY.canopy / 2],
    }),
    ...repeat(
      box(SURFACES.steel, [0.2, 0.3, BAY.canopy]),
      7,
      [-HALF + 0.1, 4.95, -Z - BAY.canopy / 2],
      [5.97, 0, 0],
    ),
  ];
}

export const terminalBay = (): PropMesh =>
  prop('airport/terminal-bay', [
    ...landside(),
    ...interior(),
    ...roof(),
    ...curtainWall(BAY.width, BAY.eave, 1.5, 2).map((part) => transform(part, { at: [0, 0, Z] })),
  ]);
