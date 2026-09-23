/**
 * Night life and smoke: neon blade signs hung on shop fronts (a dark box with glowing tubes on
 * both faces, in four colours) and an industrial brick chimney with banded rings. The page's
 * `neon-glow` and `smoke` emitters sit on them; the glow itself waits on bloom.
 */
import type { MeshPart, PropMesh, Surface, Vec3 } from '../../plan/contract.ts';
import { box, cylinder, lathe, prop, transform, tube, SURFACES } from '../../props/index.ts';
import { CITY } from './surfaces.ts';

export const NEON = [
  ['pink', CITY.neonPink],
  ['cyan', CITY.neonCyan],
  ['amber', CITY.neonAmber],
  ['green', CITY.neonGreen],
] as const;

/** Glyph strokes of a sign face, in the blade's (z, y) plane: a frame and three marks. */
const strokes = (variant: number): [number, number][][] => [
  [
    [0.15, 0.2],
    [1.05, 0.2],
    [1.05, 5.8],
    [0.15, 5.8],
    [0.15, 0.2],
  ],
  ...[0, 1, 2].map((k): [number, number][] => {
    const y = 1 + k * 1.6;
    return variant % 2
      ? [
          [0.35, y],
          [0.85, y + 0.6],
          [0.35, y + 1.2],
        ]
      : [
          [0.85, y],
          [0.35, y],
          [0.35, y + 1.2],
          [0.85, y + 1.2],
        ];
  }),
];

/** A 6 m blade sign sticking 1.2 m out of a wall along +Z, its tubes on both faces. */
function neonSign(colour: string, glow: Surface, variant: number): PropMesh {
  const tubes: MeshPart[] = [];
  for (const side of [-1, 1])
    for (const line of strokes(variant))
      tubes.push(
        tube(
          glow,
          line.map(([z, y]): Vec3 => [side * 0.2, y, z]),
          0.035,
          { segments: 5 },
        ),
      );
  return prop(`city/neon-${colour}`, [
    transform(box(CITY.railing, [0.3, 6, 1.2]), { at: [0, 0, 0.6] }),
    ...[1.5, 4.5].map((y) => transform(box(SURFACES.steel, [0.1, 0.1, 0.4]), { at: [0, y, 0.1] })),
    ...tubes,
  ]);
}

export const neonSigns = (): PropMesh[] => NEON.map(([name, glow], i) => neonSign(name, glow, i));

/** Height of the chimney's mouth, where the smoke emitter sits. */
export const CHIMNEY_TOP = 62;

/** A 62 m brick chimney on a square base, banded with steel rings, a sooty crown. */
export function chimney(): PropMesh {
  const rings = [12, 24, 36, 48, 58].map((y) => {
    const r = 3.2 - (y / CHIMNEY_TOP) * 1.2 + 0.08;
    return transform(cylinder(SURFACES.darkMetal, r, 0.4, { segments: 20, caps: false }), {
      at: [0, y, 0],
    });
  });
  return prop('city/chimney', [
    box(CITY.brickStack, [8, 6, 8]),
    transform(box(CITY.brickStack, [8, 4, 8]), { at: [0, -4, 0] }),
    lathe(
      CITY.brickStack,
      [
        [3.2, 6],
        [2, CHIMNEY_TOP - 1.5],
        [2.3, CHIMNEY_TOP - 1],
        [2.3, CHIMNEY_TOP],
      ],
      {
        segments: 20,
        caps: false,
      },
    ),
    transform(cylinder(SURFACES.darkMetal, 2.32, 1.2, { segments: 20, caps: false }), {
      at: [0, CHIMNEY_TOP - 1.2, 0],
    }),
    ...rings,
  ]);
}
