/**
 * Seven tower archetypes, each at several heights so the skyline never repeats a silhouette:
 * a setback slab with a flat roof, a tapering round tower with a spire, an Art Deco stepped
 * tower with a lantern, a twisting tower, a plain office block, and (`highrise.ts`) a diagrid
 * drum and a residential tower with balconies. Heights are real-world
 * downtown heights (40 – 310 m).
 */
import type { MeshPart } from '../../plan/contract.ts';
import { cone, cylinder, lathe, sphere, transform, tube, SURFACES } from '../../props/index.ts';
import { polygon, rectangle } from './facade.ts';
import { CITY } from './surfaces.ts';
import { diagridTower, residentialTower } from './highrise.ts';
import { flatRoof, towerProp, twist, type Tower } from './tower-kit.ts';

/** A spire: a tapering mast and a red aviation light at its tip. */
const spire = (base: number, height: number): MeshPart[] => [
  cone(CITY.mullion, base, height, { segments: 16 }),
  transform(sphere(CITY.aviation, 0.6, { segments: 10, rings: 6 }), { at: [0, height + 0.3, 0] }),
];

function slab(height: number, seed: number): Tower {
  const shares = [0.6, 0.25, 0.15];
  const sizes: [number, number][] = [
    [44, 28],
    [38, 24],
    [30, 20],
  ];
  return towerProp({
    id: `city/tower-slab-${height}`,
    glass: CITY.glassBlue,
    mullion: CITY.mullion,
    bay: 3,
    podium: [27, 19],
    sections: sizes.map(([w, d], i) => ({ outline: rectangle(w, d), height: height * shares[i] })),
    crown: () => flatRoof(30, 20, CITY.mullion),
    roof: [15, 10],
    lit: 0.22,
    seed,
  });
}

function round(height: number, seed: number): Tower {
  const radii = [21, 19.5, 18, 16, 13];
  const body = height * 0.84;
  return towerProp({
    id: `city/tower-round-${height}`,
    glass: CITY.glassTeal,
    mullion: CITY.mullion,
    bay: 8,
    podium: [26, 26],
    sections: radii.map((r) => ({ outline: polygon(24, r), height: body / radii.length })),
    crown: () => [
      lathe(
        CITY.mullion,
        [
          [13, 0],
          [11, 4],
          [6, 10],
          [2.5, 14],
        ],
        { segments: 24 },
      ),
      ...spire(2.5, height - body - 20).map((p) => transform(p, { at: [0, 14, 0] })),
    ],
    lit: 0.18,
    seed,
  });
}

function deco(height: number, seed: number): Tower {
  const steps = [36, 31, 26, 20];
  const shares = [0.5, 0.2, 0.15, 0.15];
  return towerProp({
    id: `city/tower-deco-${height}`,
    glass: CITY.glassBronze,
    mullion: CITY.stone,
    bay: 4.5,
    podium: [22, 22],
    sections: steps.map((s, i) => ({
      outline: rectangle(s, s, s / 8),
      height: height * 0.85 * shares[i],
    })),
    crown: () => [
      ...[16, 12, 8].map((s, i) =>
        transform(
          lathe(
            CITY.stone,
            [
              [s * 0.75, 0],
              [s * 0.7, 4],
            ],
            { segments: 8 },
          ),
          {
            at: [0, i * 4, 0],
            yaw: Math.PI / 8,
          },
        ),
      ),
      transform(cylinder(CITY.officeLit, 3.5, 6, { segments: 8 }), { at: [0, 12, 0] }),
      ...spire(1.6, height * 0.15 - 8).map((p) => transform(p, { at: [0, 18, 0] })),
    ],
    lit: 0.3,
    seed,
  });
}

function twisted(height: number, seed: number): Tower {
  const levels = Math.round(height / 16),
    base = rectangle(32, 32, 3);
  return towerProp({
    id: `city/tower-twist-${height}`,
    glass: CITY.glassSilver,
    mullion: CITY.mullion,
    bay: 3.2,
    podium: [24, 24],
    sections: Array.from({ length: levels }, (_, i) => ({
      outline: twist(base, (i / levels) * (Math.PI / 2)),
      height: height / levels,
    })),
    crown: () => [
      tube(
        SURFACES.steel,
        polygon(24, 18)
          .map(([x, z]) => [x, 3, z] as const)
          .concat([[18, 3, 0]]),
        0.5,
      ),
      ...spire(1.2, 18),
    ],
    lit: 0.2,
    seed,
  });
}

function office(height: number, seed: number): Tower {
  return towerProp({
    id: `city/tower-office-${height}`,
    glass: CITY.glassDark,
    mullion: CITY.mullionDark,
    bay: 2.6,
    podium: [18, 16],
    sections: [{ outline: rectangle(32, 28, 2), height: height - 8 }],
    crown: () => flatRoof(32, 28, CITY.mullionDark),
    roof: [16, 14],
    lit: 0.35,
    seed,
  });
}

/** Every tower prop, tallest-first per archetype, and a label of the archetype. */
export function towers(seed: number): Tower[] {
  return [
    ...[230, 170, 110].map((h, i) => slab(h, seed + i)),
    ...[310, 240, 150].map((h, i) => round(h, seed + 10 + i)),
    ...[250, 190, 120].map((h, i) => deco(h, seed + 20 + i)),
    ...[280, 220, 160].map((h, i) => twisted(h, seed + 30 + i)),
    ...[105, 85, 65, 45].map((h, i) => office(h, seed + 40 + i)),
    ...[280, 200].map((h, i) => diagridTower(h, seed + 50 + i)),
    residentialTower(120, CITY.render, seed + 60),
    residentialTower(90, CITY.renderTerracotta, seed + 61),
  ];
}
