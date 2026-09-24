/**
 * A village's heart as one prop: a stone church with its bell tower and spire at the head of a
 * cobbled square, a well in the middle, benches and lanterns round it. The church stands on
 * -Z, the square opens toward +Z; the square's centre is `SQUARE_CENTRE` in the prop's frame.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import {
  box,
  cone,
  cylinder,
  lathe,
  prop,
  SURFACES,
  transform,
  type PropLamp,
} from '../../props/index.ts';
import { LAND } from './ground.ts';
import { door, plinth, walls, window } from './parts.ts';
import { COVERINGS, roof } from './roofs.ts';

const unit = ([x, y, z]: Vec3): Vec3 => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};

const { slate, wood, darkMetal, whitePaint, emissiveLamp, roofTile } = SURFACES;
const NAVE = { width: 11, length: 24, wall: 9 };
const TOWER = { side: 6, height: 26, spire: 14 };
/** Where the church's front meets the square, and the square's size. */
const FRONT = 2,
  SQUARE = { width: 34, depth: 30 };
export const SQUARE_CENTRE: Vec3 = [0, 0.35, FRONT + SQUARE.depth / 2];

function nave(): MeshPart[] {
  const { width, length, wall } = NAVE,
    at = { at: [0, 0.3, -length / 2 - TOWER.side + FRONT] as Vec3 };
  const side = [-8, -3, 2, 7].flatMap((z) => window(z, 3, width / 2 + 0.03, 1.4, 3.6));
  return [
    transform(walls(LAND.stone, width, length, wall), at),
    ...[Math.PI / 2, -Math.PI / 2].flatMap((yaw) =>
      side.map((p) => transform(transform(p, { yaw }), at)),
    ),
    ...roof(length, width, wall, 5.5, COVERINGS.slate, LAND.stone).map((p) =>
      transform(transform(p, { yaw: Math.PI / 2 }), at),
    ),
    // Buttresses between the windows.
    ...[-10.5, -5.5, -0.5, 4.5, 9.5].flatMap((z) =>
      [-1, 1].map((s) =>
        transform(box(LAND.stone, [0.8, 6, 1]), {
          at: [s * (width / 2 + 0.4) + at.at[0], 0.3, z + at.at[2]],
        }),
      ),
    ),
    // A round apse behind the altar.
    transform(
      lathe(
        LAND.stone,
        [
          [4.5, 0],
          [4.5, 7],
          [0, 10.5],
        ],
        { segments: 16 },
      ),
      { at: [0, 0.3, at.at[2] - length / 2] },
    ),
  ];
}

function tower(): MeshPart[] {
  const { side, height, spire } = TOWER,
    z = FRONT - side / 2,
    belfry = height - 4;
  const faces = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  return [
    transform(box(LAND.stone, [side, height, side]), { at: [0, 0.3, z] }),
    transform(box(LAND.stone, [side + 0.6, 0.5, side + 0.6]), { at: [0, height + 0.3, z] }),
    transform(cone(slate, side * 0.72, spire, { segments: 8 }), { at: [0, height + 0.8, z] }),
    transform(cylinder(darkMetal, 0.05, 2.5, { segments: 6 }), {
      at: [0, height + spire + 0.6, z],
    }),
    transform(box(darkMetal, [1.2, 0.08, 0.08]), { at: [0, height + spire + 2.4, z] }),
    ...faces.flatMap((yaw) =>
      [
        // Belfry openings and a clock face on each side.
        ...[-1, 1].map((s) =>
          transform(box(darkMetal, [1, 2.6, 0.1]), { at: [s * 1.2, belfry, side / 2] }),
        ),
        transform(cylinder(whitePaint, 1.1, 0.1, { segments: 20 }), {
          at: [0, belfry - 3.5, side / 2],
          pitch: Math.PI / 2,
        }),
        transform(box(darkMetal, [0.1, 0.8, 0.05]), { at: [0, belfry - 3.5, side / 2 + 0.12] }),
      ].map((p) => transform(p, { yaw, at: [0, 0, z] })),
    ),
    ...door(0, FRONT + 0.02, 2, 3.4, wood),
  ];
}

/** The square: cobbles, a well, four benches and four lanterns. */
function square(): [MeshPart[], PropLamp[]] {
  const { width, depth } = SQUARE,
    [cx, , cz] = SQUARE_CENTRE,
    corners = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => [cx + sx * (width / 2 - 2), cz + sz * (depth / 2 - 2)] as const),
    );
  const parts = [
    transform(box(LAND.cobble, [width, 0.06, depth]), { at: [cx, 0.3, cz] }),
    transform(
      lathe(
        LAND.stone,
        [
          [1.4, 0],
          [1.4, 0.9],
          [1.1, 0.9],
          [1.1, 0.1],
          [0, 0.1],
        ],
        { segments: 18 },
      ),
      { at: [cx, 0.35, cz] },
    ),
    ...[-1, 1].map((s) =>
      transform(box(wood, [0.15, 2.4, 0.15]), { at: [cx + s * 1.25, 0.35, cz] }),
    ),
    transform(box(roofTile, [3.2, 0.1, 2.2]), { at: [cx, 2.75, cz] }),
    ...corners.flatMap(([x, z]) => [
      transform(cylinder(darkMetal, 0.07, 3.4, { segments: 8 }), { at: [x, 0.35, z] }),
      transform(box(emissiveLamp, [0.3, 0.4, 0.3]), { at: [x, 3.75, z] }),
      transform(cone(darkMetal, 0.28, 0.3, { segments: 4 }), { at: [x, 4.15, z] }),
    ]),
    ...[-1, 1].flatMap((s) =>
      [5, -5].flatMap((d) => [
        transform(box(wood, [2, 0.08, 0.5]), { at: [cx + s * 6, 0.8, cz + d] }),
        ...[-0.8, 0.8].map((o) =>
          transform(box(darkMetal, [0.08, 0.45, 0.45]), { at: [cx + s * 6 + o, 0.35, cz + d] }),
        ),
      ]),
    ),
  ];
  // A square lantern: about 1 500 lm all round, 1 500 / 4π ≈ 120 cd.
  const lights = corners.map(([x, z], i): PropLamp => ({
    id: `lantern-${i}`,
    type: 'point',
    offset: [x, 3.95, z],
    color: [1, 0.8, 0.55],
    intensity: 120,
    range: 15,
    night: true,
  }));
  return [parts, lights];
}

/** The church square prop and its lamps: four lanterns and two floodlights on the tower. */
export function churchSquare(): [PropMesh, PropLamp[]] {
  const [squareParts, lanterns] = square(),
    depth = NAVE.length + TOWER.side + SQUARE.depth + 5,
    centreZ = FRONT + SQUARE.depth - depth / 2;
  // Floodlights on the square's front edge, aimed up at the tower: ≈ 5 000 lm into 0.77 sr.
  const flood = [-1, 1].map((s): PropLamp => ({
    id: `flood-${s < 0 ? 'west' : 'east'}`,
    type: 'spot',
    offset: [s * 5, 0.6, FRONT + 8],
    direction: unit([-s * 5, 19.4, -11]),
    cone: 0.5,
    color: [1, 0.86, 0.7],
    intensity: 6500,
    range: 45,
    night: true,
  }));
  return [
    prop('countryside/church-square', [
      transform(plinth(Math.max(SQUARE.width, NAVE.width + 2), depth), { at: [0, 0, centreZ] }),
      ...nave(),
      ...tower(),
      ...squareParts,
      ...flood.map((f) => transform(box(darkMetal, [0.4, 0.3, 0.3]), { at: f.offset })),
    ]),
    [...lanterns, ...flood],
  ];
}
