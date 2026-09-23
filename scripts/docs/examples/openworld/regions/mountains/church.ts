/**
 * The village church: a whitewashed nave under a slate roof laid tile by tile, stone quoins,
 * tall arched windows, a round apse, and a front tower with clock faces, louvred belfry
 * openings and a verdigris onion dome crowned by a gilt cross. The door faces +Z; origin at
 * the floor level, the stone plinth reaching `BASEMENT` below.
 */
import type { MeshPart, PropMesh } from '../../plan/contract.ts';
import {
  cone,
  cylinder,
  lathe,
  prop,
  sphere,
  SURFACES,
  transform,
  type PropLamp,
} from '../../props/index.ts';
import { BASEMENT } from './chalet.ts';
import { boxAt, gable, shingleRoof } from './parts.ts';
import { MOUNTAIN_SURFACES as S } from './surfaces.ts';

const NAVE = { width: 10, length: 18, height: 9 };
const TOWER = { side: 4.4, height: 24 };
const UPRIGHT = Math.PI / 2;

/** Stone quoins up the corners of a `w` × `d` block, `h` high, alternating long and short. */
function quoins(w: number, d: number, h: number, at: readonly [number, number] = [0, 0]) {
  const parts: MeshPart[] = [];
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ])
    for (let y = 0, k = 0; y < h - 0.3; y += 0.6, k++) {
      const long = k % 2 ? [0.9, 0.5] : [0.5, 0.9];
      parts.push(
        boxAt(S.stoneWall, [long[0], 0.55, long[1]], {
          at: [
            at[0] + sx * (w / 2 - long[0] / 2 + 0.06),
            y,
            at[1] + sz * (d / 2 - long[1] / 2 + 0.06),
          ],
        }),
      );
    }
  return parts;
}

/** A tall arched window facing +Z, its sill at y = 0. */
const archedWindow = (w: number, h: number): MeshPart[] => [
  boxAt(SURFACES.glass, [w, h, 0.04], { at: [0, 0, 0] }),
  transform(cylinder(SURFACES.glass, w / 2, 0.04, { segments: 14 }), {
    at: [0, h, 0],
    pitch: UPRIGHT,
  }),
  boxAt(S.stoneWall, [w + 0.3, 0.15, 0.2], { at: [0, -0.15, 0.05] }),
  boxAt(S.stoneWall, [0.15, h, 0.14], { at: [-w / 2 - 0.07, 0, 0.03] }),
  boxAt(S.stoneWall, [0.15, h, 0.14], { at: [w / 2 + 0.07, 0, 0.03] }),
];

/** Walls, windows, apse and roof of the nave. */
function nave(): MeshPart[] {
  const { width: w, length: l, height: h } = NAVE,
    parts = [
      boxAt(S.stoneWall, [w + 0.4, BASEMENT + 0.6, l + 0.4], { at: [0, -BASEMENT, 0] }),
      boxAt(S.whitewash, [w, h, l], { at: [0, 0.6, 0] }),
      ...quoins(w, l, h + 0.6),
      cylinder(S.whitewash, 4, 7.5, { segments: 32 }),
      transform(cone(SURFACES.slate, 4.5, 3.5, { segments: 32 }), { at: [0, 7.5, 0] }),
    ];
  parts[3] = transform(parts[3], { at: [0, 0.6, -l / 2] });
  parts[4] = transform(parts[4], { at: [0, 0.6, -l / 2] });
  for (const side of [-1, 1])
    for (let k = 0; k < 4; k++)
      parts.push(
        ...archedWindow(1.2, 3.4).map((p) =>
          transform(p, {
            at: [side * (w / 2 + 0.02), 3.2, -l / 2 + 3 + k * 4],
            yaw: side * UPRIGHT,
          }),
        ),
      );
  const overhang = 0.8,
    rise = 5.2,
    eave = h + 0.6 - (rise * overhang) / (w / 2 + overhang);
  parts.push(
    ...shingleRoof(SURFACES.slate, l, w, rise, { overhang, board: [0.5, 0.45] }).map((p) =>
      transform(p, { at: [0, eave + 0.1, 0], yaw: UPRIGHT }),
    ),
    ...gable(w, (rise * (w / 2)) / (w / 2 + overhang), S.whitewash).map((p) =>
      transform(p, { at: [0, h + 0.6, -l / 2 - 0.01], yaw: Math.PI }),
    ),
  );
  return parts;
}

/** A clock face on the tower's +Z side, centred at height `y`. */
function clock(y: number, face: number): MeshPart[] {
  const parts = [
    transform(cylinder(S.whitewash, 1.1, 0.1, { segments: 28 }), {
      at: [0, y, face],
      pitch: UPRIGHT,
    }),
    transform(cylinder(S.darkWood, 1.25, 0.08, { segments: 28 }), {
      at: [0, y, face - 0.02],
      pitch: UPRIGHT,
    }),
    boxAt(S.darkRock, [0.08, 0.8, 0.03], { at: [0, y, face + 0.12], roll: 0.5 }),
    boxAt(S.darkRock, [0.1, 0.55, 0.03], { at: [0, y, face + 0.14], roll: -2.1 }),
  ];
  for (let hour = 0; hour < 12; hour++) {
    const a = (hour / 12) * Math.PI * 2;
    parts.push(
      boxAt(S.gilt, [0.08, 0.2, 0.03], {
        at: [Math.sin(a) * 0.9, y + Math.cos(a) * 0.9 - 0.1, face + 0.11],
        roll: -a,
      }),
    );
  }
  return parts;
}

/** The front tower with clocks, belfry and onion dome. */
function tower(): MeshPart[] {
  const { side: t, height: h } = TOWER,
    z = NAVE.length / 2 + t / 2 - 0.2,
    parts = [
      boxAt(S.whitewash, [t, h - 0.6, t], { at: [0, 0.6, z] }),
      ...quoins(t, t, h, [0, z]),
      boxAt(S.stoneWall, [t + 0.5, 0.4, t + 0.5], { at: [0, h, z] }),
      boxAt(S.darkWood, [1.6, 2.8, 0.1], { at: [0, 0.6, z + t / 2] }),
      transform(cylinder(S.darkWood, 0.8, 0.1, { segments: 14 }), {
        at: [0, 3.4, z + t / 2],
        pitch: UPRIGHT,
      }),
    ];
  for (let k = 0; k < 4; k++) {
    const turn = (m: MeshPart) =>
      transform(transform(m, { at: [0, 0, t / 2 + 0.01] }), { at: [0, 0, z], yaw: k * UPRIGHT });
    const face = [...clock(h - 6, 0)];
    face.push(boxAt(S.tunnelDark, [1.4, 2.4, 0.05], { at: [0, h - 3.2, 0] }));
    for (let y = h - 3.1; y < h - 0.9; y += 0.3)
      face.push(boxAt(S.darkWood, [1.4, 0.05, 0.2], { at: [0, y, 0.1], pitch: -0.6 }));
    parts.push(...face.map(turn));
  }
  const dome = lathe(
    S.verdigris,
    [
      [2.3, 0],
      [2.8, 0.8],
      [3.0, 1.5],
      [2.7, 2.4],
      [1.8, 3.2],
      [0.8, 3.8],
      [0.45, 4.3],
      [0.45, 5.3],
      [0.9, 5.8],
      [0.8, 6.4],
      [0.3, 7.0],
      [0.12, 7.8],
      [0, 9],
    ],
    { segments: 24 },
  );
  parts.push(
    transform(dome, { at: [0, h + 0.4, z] }),
    transform(sphere(S.gilt, 0.25, { segments: 12, rings: 8 }), { at: [0, h + 9.4, z] }),
    boxAt(S.gilt, [0.1, 1.6, 0.1], { at: [0, h + 9.5, z] }),
    boxAt(S.gilt, [0.8, 0.1, 0.1], { at: [0, h + 10.5, z] }),
  );
  return parts;
}

export const church = (): PropMesh => prop('mountains/church', [...nave(), ...tower()]);

/** A lantern over the church door, lit at night. */
export const CHURCH_LAMPS: readonly PropLamp[] = [
  {
    id: 'door-lamp',
    type: 'point',
    offset: [0, 3.2, NAVE.length / 2 + TOWER.side + 0.4],
    color: [1, 0.75, 0.5],
    intensity: 250,
    range: 14,
    night: true,
  },
];
