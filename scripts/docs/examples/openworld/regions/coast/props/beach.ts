/**
 * The beach: a parasol with two loungers, striped changing huts, a lifeguard tower. Real sizes,
 * standing on the sand at the origin, facing +Z (the sea).
 */
import type { MeshPart, PropMesh, Surface, Vec3 } from '../../../plan/contract.ts';
import {
  box,
  cylinder,
  prop,
  quads,
  roofPrism,
  SURFACES,
  transform,
  tube,
} from '../../../props/index.ts';
import { COAST } from '../surfaces.ts';

/** A striped canopy of `gores` panels, alternating two cloths, apex at `height`. */
export function canopy(a: Surface, b: Surface, radius: number, height: number, drop: number) {
  const gores = 16,
    parts: MeshPart[] = [];
  for (let i = 0; i < gores; i++) {
    const at = (k: number, r: number, y: number): Vec3 => {
      const angle = (k / gores) * Math.PI * 2;
      return [Math.cos(angle) * r, y, Math.sin(angle) * r];
    };
    const cloth = i % 2 ? a : b;
    parts.push(
      quads(cloth, [
        [
          at(i + 1, radius * 0.5, height - drop * 0.4),
          at(i, radius * 0.5, height - drop * 0.4),
          [0, height, 0],
        ],
        [
          at(i + 1, radius, height - drop),
          at(i, radius, height - drop),
          at(i, radius * 0.5, height - drop * 0.4),
          at(i + 1, radius * 0.5, height - drop * 0.4),
        ],
        [
          at(i, radius, height - drop),
          at(i + 1, radius, height - drop),
          at(i + 1, radius, height - drop - 0.2),
          at(i, radius, height - drop - 0.2),
        ],
      ]),
    );
  }
  return parts;
}

/** A lounger 1.9 m long along Z: frame, slats, a raised back. */
function lounger(x: number): MeshPart[] {
  const parts: MeshPart[] = [];
  for (const side of [-0.3, 0.3])
    parts.push(transform(box(SURFACES.wood, [0.05, 0.05, 1.9]), { at: [x + side, 0.3, 0] }));
  for (const [dx, dz] of [
    [-0.3, -0.85],
    [0.3, -0.85],
    [-0.3, 0.85],
    [0.3, 0.85],
  ])
    parts.push(transform(box(SURFACES.wood, [0.05, 0.3, 0.05]), { at: [x + dx, 0, dz] }));
  for (let i = 0; i < 9; i++)
    parts.push(
      transform(box(SURFACES.wood, [0.62, 0.03, 0.12]), { at: [x, 0.35, 0.8 - i * 0.16] }),
    );
  for (let i = 0; i < 4; i++)
    parts.push(
      transform(box(SURFACES.wood, [0.62, 0.03, 0.12]), {
        at: [x, 0.4 + i * 0.12, -0.7 - i * 0.07],
        pitch: -0.9,
      }),
    );
  parts.push(transform(box(COAST.canvasWhite, [0.55, 0.02, 1.2]), { at: [x, 0.38, 0.25] }));
  return parts;
}

/** A parasol between two loungers, in two liveries. */
const parasolSet = (id: string, a: Surface, b: Surface): PropMesh =>
  prop(id, [
    cylinder(SURFACES.wood, 0.03, 2.5, { segments: 8 }),
    ...canopy(a, b, 1.3, 2.45, 0.55),
    ...lounger(-0.9),
    ...lounger(0.9),
  ]);

/** A 2 × 2 m changing hut: vertical boards in two colours, pitched roof, a door. */
function beachHut(id: string, stripe: Surface): PropMesh {
  const parts: MeshPart[] = [
    transform(box(COAST.weatheredWood, [2.2, 0.35, 2.2]), { at: [0, -0.1, 0] }),
    transform(roofPrism(COAST.whitewash, 2, 2, 0.8, { overhang: 0.2 }), {
      at: [0, 2.45, 0],
      yaw: Math.PI / 2,
    }),
  ];
  const boards = 10;
  for (let side = 0; side < 4; side++)
    for (let i = 0; i < boards; i++) {
      const board = transform(box(i % 2 ? stripe : COAST.whitewash, [0.2, 2.2, 0.06]), {
        at: [-0.9 + i * 0.2, 0.25, 0.97],
      });
      parts.push(transform(board, { yaw: (side * Math.PI) / 2 }));
    }
  parts.push(
    transform(box(COAST.weatheredWood, [0.8, 1.8, 0.04]), { at: [0, 0.3, 1.02] }),
    transform(box(SURFACES.darkMetal, [0.05, 0.05, 0.06]), { at: [0.3, 1.2, 1.05] }),
  );
  return prop(id, parts);
}

/** A lifeguard tower: four legs, a platform with a rail, a cabin, a ladder and a flag. */
function lifeguardTower(): PropMesh {
  const parts: MeshPart[] = [];
  for (const [x, z] of [
    [-1.2, -1.2],
    [1.2, -1.2],
    [-1.2, 1.2],
    [1.2, 1.2],
  ] as const) {
    parts.push(transform(box(COAST.whitewash, [0.15, 3, 0.15]), { at: [x, 0, z] }));
    parts.push(
      tube(
        COAST.whitewash,
        [
          [x, 0.2, z],
          [-x * 0.2, 2.8, z],
        ],
        0.04,
        { segments: 5 },
      ),
    );
  }
  parts.push(
    transform(box(COAST.deckWood, [3, 0.15, 3]), { at: [0, 3, 0] }),
    transform(box(COAST.lifeRed, [2, 2, 2]), { at: [0, 3.15, -0.3] }),
    transform(box(SURFACES.glass, [1.6, 0.8, 0.05]), { at: [0, 4.1, 0.72] }),
    transform(roofPrism(COAST.lifeRed, 2.2, 2.2, 0.5, { overhang: 0.2 }), { at: [0, 5.15, -0.3] }),
    ...[-1.45, 1.45].map((x) =>
      transform(box(COAST.whitewash, [0.05, 1, 3]), { at: [x, 3.15, 0] }),
    ),
    transform(box(COAST.whitewash, [3, 0.06, 0.05]), { at: [0, 4.1, 1.45] }),
    cylinder(SURFACES.steel, 0.03, 8, { segments: 6 }),
    transform(
      quads(COAST.lifeRed, [
        [
          [0, 7.9, 0],
          [0, 7.1, 0],
          [0, 7.1, 1.2],
          [0, 7.9, 1.2],
        ],
      ]),
      { at: [0, 0, 0.05] },
    ),
  );
  for (let i = 0; i < 9; i++)
    parts.push(
      transform(box(COAST.whitewash, [0.8, 0.05, 0.12]), {
        at: [0, 0.3 + i * 0.33, 1.6 + i * 0.12],
      }),
    );
  for (const x of [-0.42, 0.42])
    parts.push(
      tube(
        COAST.whitewash,
        [
          [x, 0, 1.55],
          [x, 3.1, 2.6],
        ],
        0.04,
        { segments: 5 },
      ),
    );
  return prop('coast-lifeguard-tower', parts);
}

/** Every beach prop. */
export const beachProps = (): PropMesh[] => [
  parasolSet('coast-parasol-red', COAST.canvasRed, COAST.canvasWhite),
  parasolSet('coast-parasol-blue', COAST.canvasBlue, COAST.canvasWhite),
  parasolSet('coast-parasol-yellow', COAST.canvasYellow, COAST.canvasWhite),
  beachHut('coast-hut-blue', COAST.canvasBlue),
  beachHut('coast-hut-red', COAST.canvasRed),
  beachHut('coast-hut-yellow', COAST.canvasYellow),
  lifeguardTower(),
];
