/**
 * The harbour's own props: a 300 m concrete quay (a solid wall from the sea bed, fenders and
 * bollards on its edges), a slewing harbour crane (a portal the page never moves and a jib the
 * page turns), a sawtooth-roofed warehouse, and a floodlight mast shared with the stadium, whose
 * lamps are declared on it (`floodlight.ts`). Quays and the crane's portal run along +Z, out to sea.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import { box, cylinder, prop, quads, SURFACES, transform, tube } from '../../props/index.ts';
import { CITY } from './surfaces.ts';

const { craneYellow, darkMetal, steel } = SURFACES;

/** Where the quays start, metres inland of the first sea point. */
export const ROOT = -20;
export const QUAY = { width: 50, length: 300, deck: 3, depth: 22 } as const;

export function quay(): PropMesh {
  const { width, length, deck, depth } = QUAY,
    parts: MeshPart[] = [
      transform(box(CITY.quay, [width, deck + depth, length]), { at: [0, -depth, length / 2] }),
    ];
  for (let z = 6; z < length; z += 12)
    for (const s of [-1, 1]) {
      parts.push(
        transform(box(CITY.fender, [0.6, 2.4, 1.6]), { at: [s * (width / 2 + 0.3), deck - 3, z] }),
      );
      parts.push(
        transform(cylinder(darkMetal, 0.3, 0.7, { top: 0.4, segments: 10 }), {
          at: [s * (width / 2 - 1), deck, z + 6],
        }),
      );
    }
  for (const s of [-1, 1])
    parts.push(
      transform(box(CITY.kerb, [0.5, 0.3, length]), {
        at: [s * (width / 2 - 0.25), deck, length / 2],
      }),
    );
  return prop('city/quay', parts);
}

/** The crane's fixed portal: four legs on rails, a slewing ring 24 m up. */
export function cranePortal(): PropMesh {
  const legs = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) =>
      tube(
        craneYellow,
        [
          [sx * 5, 0, sz * 5],
          [sx * 2, 22, sz * 2],
        ],
        0.5,
        { segments: 8, caps: true },
      ),
    ),
  );
  return prop('city/crane-portal', [
    ...legs,
    ...[-1, 1].map((s) => transform(box(darkMetal, [0.4, 0.3, 14]), { at: [s * 5, 0, 0] })),
    transform(box(craneYellow, [11, 1, 11]), { at: [0, 6, 0] }),
    transform(cylinder(craneYellow, 3.2, 2, { segments: 20 }), { at: [0, 22, 0] }),
  ]);
}

/** Height of the slewing ring the jib turns on (the jib's own origin). */
export const SLEW_HEIGHT = 24;

/** The part the page turns: a machine house, a cab, an A-frame and a 40 m lattice jib. */
export function craneJib(): PropMesh {
  const chords = [-1, 1].flatMap((s) => [
    tube(
      craneYellow,
      [
        [s * 0.9, 3, 2],
        [s * 0.4, 16, 40],
      ],
      0.2,
      { segments: 6 },
    ),
    tube(
      craneYellow,
      [
        [s * 0.9, 1.5, 2],
        [s * 0.4, 15, 40],
      ],
      0.2,
      { segments: 6 },
    ),
  ]);
  const lacing: MeshPart[] = [];
  for (let i = 0; i < 10; i++) {
    const t = i / 10,
      u = (i + 1) / 10;
    const at = (v: number, top: boolean): [number, number, number] => [
      0,
      (top ? 3 : 1.5) + v * (top ? 13 : 13.5),
      2 + v * 38,
    ];
    lacing.push(tube(craneYellow, [at(t, false), at(u, true)], 0.08, { segments: 4 }));
  }
  return prop('city/crane-jib', [
    transform(box(craneYellow, [6, 4, 9]), { at: [0, 0, -3] }),
    transform(box(darkMetal, [4, 2.5, 3]), { at: [0, 0, -9] }),
    transform(box(CITY.glassDark, [2.2, 2.2, 2.4]), { at: [2.4, 1.5, 2.5] }),
    tube(
      craneYellow,
      [
        [0, 4, -2],
        [0, 14, 0],
      ],
      0.35,
      { segments: 8 },
    ),
    tube(
      steel,
      [
        [0, 14, 0],
        [0, 16, 40],
      ],
      0.05,
      { segments: 4 },
    ),
    tube(
      steel,
      [
        [0, 14, 0],
        [0, 4, -7],
      ],
      0.05,
      { segments: 4 },
    ),
    ...chords,
    ...lacing,
    tube(
      steel,
      [
        [0, 15, 40],
        [0, 2, 40],
      ],
      0.03,
      { segments: 4 },
    ),
  ]);
}

/** A 60 × 30 m warehouse with a sawtooth roof of north lights, on a 4 m foundation. */
export function warehouse(): PropMesh {
  const slopes: Vec3[][] = [],
    lights: Vec3[][] = [],
    gables: Vec3[][] = [];
  for (let x = -30; x < 30; x += 10) {
    slopes.push([
      [x, 9, 15],
      [x + 10, 12, 15],
      [x + 10, 12, -15],
      [x, 9, -15],
    ]);
    lights.push([
      [x + 10, 9, 15],
      [x + 10, 9, -15],
      [x + 10, 12, -15],
      [x + 10, 12, 15],
    ]);
    gables.push([
      [x, 9, 15],
      [x + 10, 9, 15],
      [x + 10, 12, 15],
    ]);
    gables.push([
      [x + 10, 12, -15],
      [x + 10, 9, -15],
      [x, 9, -15],
    ]);
  }
  return prop('city/warehouse', [
    transform(box(CITY.renderGrey, [60.4, 4.6, 30.4]), { at: [0, -4, 0] }),
    transform(box(CITY.warehouse, [60, 8.4, 30]), { at: [0, 0.6, 0] }),
    quads(CITY.warehouse, [...slopes, ...gables]),
    quads(CITY.glassDark, lights),
    ...[-18, 0, 18].map((x) => transform(box(CITY.frame, [8, 6, 0.2]), { at: [x, 0.6, 15.05] })),
  ]);
}
