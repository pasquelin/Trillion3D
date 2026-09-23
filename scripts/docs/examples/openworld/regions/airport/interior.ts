/**
 * Terminal interiors, shared by the hall and the bays: rows of linked seats, check-in islands
 * with desks, belts and queue lanes, an escalator bank up to the departures floor, shop fronts.
 * Each piece stands on y = 0 of the floor it is placed on.
 */
import type { MeshPart } from '../../plan/contract.ts';
import { box, cylinder, SURFACES, transform, tube } from '../../props/index.ts';
import { AIRPORT, LIGHTS } from './palette.ts';
import { member, repeat } from './parts.ts';

/** Height of the departures floor above the ground floor, where the jet bridges arrive. */
export const UPPER = 5;

/** A row of `n` linked seats facing +Z on a beam, 0.6 m apart. */
export function seatRow(n: number): MeshPart[] {
  const { seat } = AIRPORT;
  return [
    transform(box(SURFACES.steel, [n * 0.6, 0.06, 0.08]), { at: [0, 0.38, 0] }),
    ...repeat(
      box(SURFACES.steel, [0.06, 0.38, 0.5]),
      2,
      [-(n - 1) * 0.3, 0, 0],
      [(n - 1) * 0.6, 0, 0],
    ),
    ...Array.from({ length: n }, (_, i) => {
      const x = -(n * 0.6) / 2 + 0.3 + i * 0.6;
      return [
        transform(box(seat, [0.52, 0.06, 0.48]), { at: [x, 0.44, 0.02] }),
        transform(box(seat, [0.52, 0.5, 0.06]), { at: [x, 0.48, -0.24], pitch: -0.12 }),
      ];
    }).flat(),
  ];
}

/** A check-in island along Z: desks both sides, the belt behind, a queue lane in front. */
export function checkIn(x: number): MeshPart[] {
  const desks = [-1, 1].flatMap((side) =>
    Array.from({ length: 8 }, (_, i) => [
      transform(box(AIRPORT.cladding, [1.2, 1.05, 1.6]), {
        at: [x + side * 2.4, 0.2, -18 + i * 2.2],
      }),
      transform(box(LIGHTS.ceiling, [0.05, 0.4, 0.8]), {
        at: [x + side * 3.05, 1.8, -18 + i * 2.2],
      }),
      transform(box(SURFACES.darkMetal, [0.05, 0.4, 0.6]), {
        at: [x + side * 3.0, 1.25, -18 + i * 2.2],
      }),
    ]).flat(),
  );
  const posts = Array.from({ length: 10 }, (_, i) =>
    transform(cylinder(SURFACES.steel, 0.03, 1, { segments: 6 }), {
      at: [x + 5.5, 0.2, -19 + i * 2],
    }),
  );
  return [
    ...desks,
    transform(box(SURFACES.rubber, [1.2, 0.7, 18]), { at: [x, 0.2, -10.3] }),
    transform(box(AIRPORT.cladding, [5, 3, 1]), { at: [x, 0.2, -20.5] }),
    ...posts,
    tube(
      SURFACES.signBlue,
      [
        [x + 5.5, 1.1, -19],
        [x + 5.5, 1.1, -1],
      ],
      0.03,
      { segments: 4 },
    ),
  ];
}

/** Three escalators from the ground floor at (x0, z0) up to the departures floor. */
export function escalators(x0: number, z0: number): MeshPart[] {
  return [x0 - 3, x0, x0 + 3].flatMap((x) => [
    member(SURFACES.steel, [x, 0.2, z0], [x, UPPER, z0 + 9], [1.3, 0.9]),
    member(AIRPORT.curtain, [x - 0.7, 1.1, z0], [x - 0.7, UPPER + 0.9, z0 + 9], [0.04, 0.9]),
    member(AIRPORT.curtain, [x + 0.7, 1.1, z0], [x + 0.7, UPPER + 0.9, z0 + 9], [0.04, 0.9]),
    tube(
      SURFACES.rubber,
      [
        [x - 0.7, 1.2, z0 - 0.5],
        [x - 0.7, UPPER + 1, z0 + 9],
        [x - 0.7, UPPER + 1, z0 + 10],
      ],
      0.05,
      { segments: 6 },
    ),
    tube(
      SURFACES.rubber,
      [
        [x + 0.7, 1.2, z0 - 0.5],
        [x + 0.7, UPPER + 1, z0 + 9],
        [x + 0.7, UPPER + 1, z0 + 10],
      ],
      0.05,
      { segments: 6 },
    ),
  ]);
}

/** Shop fronts facing −Z along z, their fascia signs lit. */
export function shops(xs: readonly number[], z: number): MeshPart[] {
  return xs.flatMap((x, i) => [
    transform(box(AIRPORT.cladding, [10, 4, 8]), { at: [x, 0, z + 4] }),
    transform(box(AIRPORT.curtain, [9, 3, 0.1]), { at: [x, 0, z - 0.05] }),
    transform(box(i % 2 ? SURFACES.emissiveWindow : LIGHTS.ceiling, [6, 0.8, 0.1]), {
      at: [x, 3.1, z - 0.1],
    }),
  ]);
}
