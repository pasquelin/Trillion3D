/**
 * Painted markings as thin meshes laid a hair above the pavement (ICAO Annex 14 dimensions),
 * each read along +Z, the direction an aircraft lands. Runway paint is white, taxiway and apron
 * paint yellow; none of it glows.
 */
// Waiting on the engine: decals, so paint could be projected onto the terrain's road ribbon.
import type { MeshPart, PropMesh } from '../../plan/contract.ts';
import { prop } from '../../props/index.ts';
import { glyph } from './glyphs.ts';
import { PAINT } from './palette.ts';
import { stripe } from './parts.ts';

const { white, yellow } = PAINT;
const mirrored = (xs: readonly number[], make: (x: number) => MeshPart) =>
  xs.flatMap((x) => [make(x), make(-x)]);

/** Threshold "piano keys": 12 stripes 30 m long, 1.8 m wide, from z = 0 to z = 30. */
const piano = () =>
  mirrored(
    Array.from({ length: 6 }, (_, i) => 2.7 + 3.4 * i),
    (x) => stripe(white, x, 15, 1.8, 30),
  );

/** Touchdown-zone marks: `n` stripes 22.5 × 3 m each side, 18 m apart in the middle. */
const touchdown = (n: number) =>
  mirrored(
    Array.from({ length: n }, (_, i) => 10.5 + 4.5 * i),
    (x) => stripe(white, x, 0, 3, 22.5),
  );

/** Lead-in line and stop bar of a stand, the nose wheel's path to its parking spot. */
function standLines(): MeshPart[] {
  return [
    stripe(yellow, 0, -30, 0.15, 90),
    stripe(yellow, 0, 15.6, 6, 0.3),
    ...[-18, 18].map((x) => stripe(PAINT.white, x, -12, 0.2, 48)),
  ];
}

/** Holding position (pattern A): two solid lines, then two dashed ones, across 23 m. */
function holding(): MeshPart[] {
  const solid = [0, 0.3].map((z) => stripe(yellow, 0, z, 23, 0.15));
  const dashed = [0.6, 0.9].flatMap((z) =>
    Array.from({ length: 12 }, (_, i) => stripe(yellow, -11 + i * 2, z, 1, 0.15)),
  );
  return [...solid, ...dashed];
}

/** A row of 20 car bays, 2.5 × 5 m, along +X, their open end toward +Z. */
const bays = () => [
  ...Array.from({ length: 21 }, (_, i) => stripe(white, -25 + i * 2.5, 0, 0.12, 5)),
  stripe(white, 0, -2.5, 50, 0.12),
];

/** An apron service lane: two dashed white edges 8 m apart, 60 m long. */
const lane = () =>
  [-4, 4].flatMap((x) =>
    Array.from({ length: 10 }, (_, i) => stripe(white, x, -27 + i * 6, 0.15, 3)),
  );

export function markingProps(characters: readonly string[]): PropMesh[] {
  return [
    prop('airport/mark-piano', piano()),
    prop('airport/mark-dash', [stripe(white, 0, 0, 0.9, 30)]),
    prop('airport/mark-edge', [stripe(white, 0, 0, 0.9, 100)]),
    prop(
      'airport/mark-aiming',
      mirrored([14], (x) => stripe(white, x, 0, 10, 60)),
    ),
    ...[1, 2, 3].map((n) => prop(`airport/mark-tdz-${n}`, touchdown(n))),
    prop('airport/mark-taxi', [stripe(yellow, 0, 0, 0.15, 30)]),
    prop('airport/mark-holding', holding()),
    prop('airport/mark-stand', standLines()),
    prop('airport/mark-bays', bays()),
    prop('airport/mark-lane', lane()),
    ...[...new Set(characters)].map((c) => prop(`airport/glyph-${c}`, glyph(white, c))),
  ];
}
