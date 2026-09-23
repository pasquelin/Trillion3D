/**
 * Loose desert stone at real size: sandstone boulders banded like their cliffs, hoodoos (a soft
 * column under a hard cap), scree for the talus and cracked mud plates for the wadi floor.
 */
import type { MeshPart, PropMesh, Surface } from '../../plan/contract.ts';
import { between, blob, extrude, hash01, prop, transform } from '../../props/index.ts';
import { DESERT, STRATA } from './palette.ts';

/** Boulder variants, so neighbours differ. */
const BOULDERS = 6;

/** A boulder of two or three banded lumps, 2–4 m across at scale 1. */
function boulder(id: string, seed: number): PropMesh {
  const bands = 2 + Math.floor(hash01(seed, 1) * 2),
    parts = Array.from({ length: bands }, (_, k) => {
      const r = between(seed, 10 + k, 1, 1.8) * (1 - k * 0.18),
        y = k * 0.9;
      return transform(
        blob(STRATA[(seed + k) % 4], [r, 0.6, r * 0.85], seed + k * 17, {
          detail: 5,
          roughness: 0.14,
        }),
        {
          at: [between(seed, 20 + k, -0.3, 0.3), y, 0],
          yaw: k,
        },
      );
    });
  return prop(id, parts);
}

/** A hoodoo: soft banded column narrowing under a hard cap, `height` metres. */
function hoodoo(id: string, height: number, seed: number): PropMesh {
  const beds = 6,
    parts: MeshPart[] = [];
  for (let k = 0; k < beds; k++) {
    const y = (k / beds) * height * 0.85,
      r = height * 0.12 * (1 - 0.35 * Math.sin((Math.PI * k) / beds)) + hash01(seed, k) * 0.4;
    parts.push(
      transform(
        blob(STRATA[k % 4], [r, (height * 0.85) / beds / 1.6, r], seed + k, {
          detail: 4,
          roughness: 0.12,
        }),
        { at: [0, y, 0] },
      ),
    );
  }
  parts.push(
    transform(
      blob(DESERT.darkRock, [height * 0.16, height * 0.06, height * 0.14], seed + 99, {
        detail: 4,
      }),
      { at: [0, height * 0.86, 0] },
    ),
  );
  return prop(id, parts);
}

/** Talus scree: `count` angular stones strewn over a 6 m patch. */
function scree(id: string, count: number, seed: number): PropMesh {
  const stones = Array.from({ length: count }, (_, i) => {
    const r = between(seed, i, 0.25, 0.8);
    return transform(
      blob(STRATA[i % 4], [r, r * 0.6, r * 0.8], seed + i * 3, { detail: 2, roughness: 0.3 }),
      {
        at: [between(seed + 1, i, -3, 3), 0, between(seed + 2, i, -3, 3)],
        yaw: i,
      },
    );
  });
  return prop(id, stones);
}

/** Cracked mud of a dry riverbed: polygon plates curling at the edges over a 5 m patch. */
function mudPlates(id: string, surface: Surface, seed: number): PropMesh {
  const plates: MeshPart[] = [];
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++) {
      const cx = -2 + i + between(seed, i * 5 + j, -0.1, 0.1),
        cz = -2 + j + between(seed + 1, i * 5 + j, -0.1, 0.1),
        sides = 5 + ((i + j) % 2),
        outline = Array.from({ length: sides }, (_, k) => {
          const a = (2 * Math.PI * k) / sides,
            r = 0.42 + hash01(seed + 2, i * 5 + j, k) * 0.08;
          return [cx + Math.cos(a) * r, cz + Math.sin(a) * r] as const;
        });
      plates.push(extrude(surface, outline, 0.05 + hash01(seed + 3, i, j) * 0.04, { caps: 'top' }));
    }
  return prop(id, plates);
}

/** Every loose stone prop, seeded. */
export const stoneProps = (seed: number): PropMesh[] => [
  ...Array.from({ length: BOULDERS }, (_, k) => boulder(`desert/boulder-${k}`, seed + k * 7)),
  hoodoo('desert/hoodoo-tall', 14, seed + 100),
  hoodoo('desert/hoodoo-squat', 8, seed + 110),
  scree('desert/scree-a', 14, seed + 300),
  scree('desert/scree-b', 9, seed + 320),
  mudPlates('desert/mud-plates', DESERT.mudPlaster, seed + 400),
];
