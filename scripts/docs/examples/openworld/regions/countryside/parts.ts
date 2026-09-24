/**
 * Building parts every countryside building shares: the stone plinth it stands on, framed
 * windows with shutters, doors, chimneys, and a gable roof along X. All in the building's frame,
 * front toward +Z, floor at y = 0.
 */
import type { MeshPart, Surface } from '../../plan/contract.ts';
import { box, quads, SURFACES, transform } from '../../props/index.ts';
import { LAND } from './ground.ts';
import { PLINTH } from './site.ts';

const { glass, whitePaint, wood } = SURFACES;

/** A stone plinth under a `width` × `depth` floor, from `PLINTH` below ground to 0.3 m above. */
export const plinth = (width: number, depth: number, surface: Surface = LAND.stone) =>
  transform(box(surface, [width + 0.3, PLINTH + 0.3, depth + 0.3]), { at: [0, -PLINTH, 0] });

/**
 * A window of `width` × `height` whose sill sits at `(x, y)` on a wall facing +Z at `z`: glass,
 * a white frame with a mullion, and a pair of open shutters when `shutters` is given.
 */
export function window(
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  shutters?: Surface,
): MeshPart[] {
  const bar = 0.08,
    parts = [
      transform(box(glass, [width, height, 0.06]), { at: [x, y, z] }),
      transform(box(whitePaint, [width + 2 * bar, bar, 0.14]), { at: [x, y - bar, z] }),
      transform(box(whitePaint, [width + 2 * bar, bar, 0.12]), { at: [x, y + height, z] }),
      transform(box(whitePaint, [bar * 0.6, height, 0.1]), { at: [x, y, z] }),
      ...[-1, 1].map((side) =>
        transform(box(whitePaint, [bar, height, 0.12]), {
          at: [x + (side * (width + bar)) / 2, y, z],
        }),
      ),
    ];
  if (shutters)
    for (const side of [-1, 1])
      parts.push(
        transform(box(shutters, [width / 2, height, 0.05]), {
          at: [x + side * (width * 0.75 + bar), y, z + 0.04],
        }),
      );
  return parts;
}

/** A door of `width` × `height` at `x` on a wall facing +Z at `z`, with a lintel and a step. */
export const door = (x: number, z: number, width = 1.1, height = 2.2, surface = wood) => [
  transform(box(surface, [width, height, 0.08]), { at: [x, 0.3, z] }),
  transform(box(LAND.stone, [width + 0.4, 0.25, 0.2]), { at: [x, 0.3 + height, z] }),
  transform(box(LAND.stone, [width + 0.6, 0.3, 0.6]), { at: [x, 0, z + 0.2] }),
];

/** A row of windows along one wall: `count` openings per floor, spread over `span`, every floor. */
function windowRow(
  span: number,
  z: number,
  floors: number,
  count: number,
  shutters?: Surface,
  skip = -1,
): MeshPart[] {
  const parts: MeshPart[] = [];
  for (let f = 0; f < floors; f++)
    for (let i = 0; i < count; i++)
      if (!(f === 0 && i === skip))
        parts.push(
          ...window(-span / 2 + (span * (i + 0.5)) / count, 1.2 + f * 2.9, z, 1, 1.35, shutters),
        );
  return parts;
}

/**
 * Windows on all four walls of a `width` × `depth` body: front and back rows along X, side rows
 * along Z, the front row leaving `door` free on the ground floor.
 */
export function facade(
  width: number,
  depth: number,
  floors: number,
  [front, side]: readonly [number, number],
  shutters?: Surface,
  doorSlot = -1,
): MeshPart[] {
  const along = (count: number, skip: number) =>
      windowRow(width - 1, depth / 2, floors, count, shutters, skip),
    across = windowRow(depth - 1, width / 2, floors, side, shutters);
  return [
    ...along(front, doorSlot),
    ...along(front, -1).map((p) => transform(p, { yaw: Math.PI })),
    ...[Math.PI / 2, -Math.PI / 2].flatMap((yaw) => across.map((p) => transform(p, { yaw }))),
  ];
}

/** A chimney stack of `height` above the roof line at `(x, z)`, from the wall top at `base`. */
export const chimney = (
  x: number,
  z: number,
  base: number,
  height: number,
  surface = SURFACES.brick,
) => [
  transform(box(surface, [0.7, height, 0.7]), { at: [x, base, z] }),
  transform(box(LAND.stone, [0.85, 0.15, 0.85]), { at: [x, base + height, z] }),
];

/** Walls of a `width` × `depth` × `height` body: four quads, open top and bottom. */
export function walls(surface: Surface, width: number, depth: number, height: number): MeshPart {
  const x = width / 2,
    z = depth / 2;
  return quads(surface, [
    [
      [-x, 0, z],
      [x, 0, z],
      [x, height, z],
      [-x, height, z],
    ],
    [
      [x, 0, -z],
      [-x, 0, -z],
      [-x, height, -z],
      [x, height, -z],
    ],
    [
      [x, 0, z],
      [x, 0, -z],
      [x, height, -z],
      [x, height, z],
    ],
    [
      [-x, 0, -z],
      [-x, 0, z],
      [-x, height, z],
      [-x, height, -z],
    ],
  ]);
}
