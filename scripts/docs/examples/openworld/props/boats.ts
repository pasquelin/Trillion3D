/**
 * Boats at real size, bow toward +Z, origin on the waterline at mid-length: a 10 m sailboat,
 * a 7 m motorboat, a 180 m container ship. The page floats them along the region's paths.
 */
import type { MeshPart, PropMesh } from '../plan/contract.ts';
import { hull } from './hull.ts';
import { hash01 } from './noise.ts';
import { lathe } from './round.ts';
import { rails, sailboat } from './sailboat.ts';
import { box } from './shapes.ts';
import { bevelExtrude, roundedBox } from './smooth.ts';
import { SURFACES } from './surfaces.ts';
import { prop, transform } from './transform.ts';

const { hullWhite, hullRed, whitePaint, glass, darkMetal, wood } = SURFACES;

function motorboat(): PropMesh {
  const beam = (z: number) => 1.15 * Math.sqrt(Math.max(0.05, 1 - Math.max(0, z / 3.5) ** 2));
  return prop('motorboat', [
    hull(hullWhite, { length: 7, beam: 2.5, draft: 0.5, freeboard: 0.7, fullness: 0.7 }),
    transform(roundedBox(whitePaint, [1.3, 0.9, 1.1], 0.12, 4), { at: [0, 0.65, 0.2] }),
    transform(
      bevelExtrude(
        glass,
        [
          [-0.7, 0],
          [0.7, 0],
          [0.55, 0.45],
          [-0.55, 0.45],
        ],
        0.05,
        { bevel: 0.015, segments: 2 },
      ),
      { at: [0, 1.5, 0.75], pitch: -0.5 },
    ),
    ...[-0.5, 0.5].flatMap((x) => [
      transform(roundedBox(wood, [0.6, 0.35, 0.6], 0.08, 3), { at: [x, 0.7, -0.9] }),
      transform(roundedBox(wood, [0.6, 0.5, 0.12], 0.05, 3), { at: [x, 1.0, -1.25] }),
    ]),
    transform(roundedBox(wood, [2.0, 0.4, 0.7], 0.08, 3), { at: [0, 0.7, -2.6] }),
    transform(roundedBox(darkMetal, [0.45, 0.6, 0.55], 0.12, 4), { at: [0, 0.6, -3.65] }),
    transform(
      lathe(
        darkMetal,
        [
          [0.08, -0.6],
          [0.1, 0],
          [0.06, 0.6],
        ],
        { segments: 16 },
      ),
      { at: [0, 0.2, -3.7] },
    ),
    ...rails(-2.8, 2.6, beam, 0.75),
  ]);
}

/** A container ship: hull, a deck stacked with container blocks, a bridge house and funnel aft. */
function cargoShip(seed: number): PropMesh {
  const stacks: MeshPart[] = [];
  for (let bay = 0; bay < 11; bay++)
    for (let row = 0; row < 3; row++) {
      const tiers = 2 + Math.floor(hash01(seed, bay, row) * 3),
        livery = hash01(seed, bay, row, 1) < 0.5 ? SURFACES.containerRed : SURFACES.containerBlue;
      for (let tier = 0; tier < tiers; tier++)
        stacks.push(
          transform(box(livery, [7.6, 2.55, 12.1]), {
            at: [(row - 1) * 7.9, 8 + tier * 2.59, -44 + bay * 12.6],
          }),
        );
    }
  const windows = Array.from({ length: 5 }, (_, i) =>
    transform(box(glass, [24.2, 0.9, 10.2]), { at: [0, 10 + i * 2.8, -64] }),
  );
  return prop('cargo-ship', [
    hull(hullRed, {
      length: 180,
      beam: 30,
      draft: 10,
      freeboard: 8,
      around: 72,
      along: 120,
      fullness: 0.9,
    }),
    ...stacks,
    transform(roundedBox(whitePaint, [24, 14, 10], 0.4, 2), { at: [0, 8, -64] }),
    ...windows,
    transform(roundedBox(whitePaint, [32, 2.6, 8], 0.3, 2), { at: [0, 22, -64] }),
    transform(box(glass, [32.2, 1.2, 8.2]), { at: [0, 22.8, -64] }),
    transform(
      lathe(
        darkMetal,
        [
          [2.6, 0],
          [2.8, 8],
          [2.4, 12],
          [2.2, 12.4],
        ],
        { segments: 32 },
      ),
      { at: [0, 20, -76] },
    ),
    ...rails(-86, 80, (z) => 14.8 * Math.sqrt(Math.max(0.05, 1 - Math.max(0, z / 90) ** 2)), 8),
  ]);
}

/** All boats. */
export const boats = (seed: number): PropMesh[] => [sailboat(), motorboat(), cargoShip(seed)];
