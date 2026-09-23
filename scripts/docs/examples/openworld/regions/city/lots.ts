/**
 * The contents of one block, in the block's own frame (`u` along the grid, `v` across, origin at
 * the block centre, at least ±45 m of it inside the sidewalk): a mid-rise courtyard block, and a
 * suburban garden lot.
 */
import { hash01 } from '../../props/index.ts';
import type { CityCatalog } from './catalog.ts';
import type { Xz } from './frame.ts';
import { KERB } from './ground-props.ts';
import { footprint, inCell, type Cell } from './grid.ts';
import { RANK, type Placer } from './placement.ts';
import { neon, onProp } from './mounts.ts';
import { FOUNDATION } from './tower-kit.ts';

/** Four mid-rise blocks around a courtyard, their fronts on the streets. */
export function midriseBlock(placer: Placer, cell: Cell, catalog: CityCatalog, seed: number) {
  const y = cell.base + KERB;
  for (const [u, side] of [
    [-22.5, 1],
    [22.5, 1],
    [-22.5, -1],
    [22.5, -1],
  ] as const) {
    const pick =
        catalog.midrise[
          Math.floor(hash01(seed, cell.i * 4 + u, cell.j, side) * catalog.midrise.length)
        ],
      v = side * (45 - pick.half[1] - 0.5),
      turnBy = side > 0 ? 0 : Math.PI,
      yaw = placer.site.yaw + turnBy,
      at = inCell(placer, cell, [u, v], y);
    const item = placer.place(
      pick.prop.id,
      at,
      yaw,
      'solid',
      RANK.structure,
      footprint(placer, cell, [u, v], pick.half, turnBy),
      {
        support: y - FOUNDATION,
      },
    );
    if (!item) continue;
    if (hash01(seed + 3, cell.i, cell.j, u * side) < 0.5)
      placer.place(
        'city/water-tank',
        onProp(at, yaw, [-pick.half[0] * 0.5, 0], pick.roof),
        yaw,
        'solid',
        RANK.furniture,
      );
    const draw = hash01(seed + 4, cell.i, cell.j, u * side);
    if (draw < 0.6) neon(placer, at, yaw, pick.half[1] - 0.3, draw, seed);
  }
  for (const u of [-12, 12])
    placer.place(
      'tree-birch-large',
      inCell(placer, cell, [u, 0], y),
      u,
      'solid',
      RANK.garden,
      footprint(placer, cell, [u, 0], [1.5, 1.5]),
      { support: cell.base - FOUNDATION },
    );
}

/** One of a suburban block's eight lots: a house facing its street, a fence, a garden tree. */
export function house(placer: Placer, cell: Cell, catalog: CityCatalog, lot: number, seed: number) {
  const col = lot % 4,
    side = lot < 4 ? 1 : -1,
    u = -33.75 + col * 22.5,
    y = cell.base + KERB,
    support = cell.base - FOUNDATION,
    pick = catalog.house[Math.floor(hash01(seed, cell.i * 8 + lot, cell.j) * catalog.house.length)],
    turnBy = side > 0 ? 0 : Math.PI,
    v = side * (37 - pick.half[1]);
  placer.place(
    pick.prop.id,
    inCell(placer, cell, [u - side * pick.shift, v], y),
    placer.site.yaw + turnBy,
    'solid',
    RANK.structure,
    footprint(placer, cell, [u, v], pick.half, turnBy),
    { support: y - FOUNDATION },
  );
  const fence = (uv: Xz, across: boolean) =>
    placer.place(
      'city/garden-fence',
      inCell(placer, cell, uv, y),
      placer.site.yaw + (across ? Math.PI / 2 : 0),
      'solid',
      RANK.garden,
      footprint(placer, cell, uv, [11.25, 0.15], across ? Math.PI / 2 : 0),
      { support },
    );
  if (side > 0) fence([u, 0], false);
  if (col > 0) for (const along of [11.25, 33.75]) fence([u - 11.25, side * along], true);
  const tree = ['tree-oak-small', 'tree-birch-small', 'bush-round'][
      Math.floor(hash01(seed + 5, cell.i * 8 + lot, cell.j) * 3)
    ],
    at: Xz = [u + (hash01(seed + 6, cell.i * 8 + lot, cell.j) - 0.5) * 8, side * 12];
  placer.place(
    tree,
    inCell(placer, cell, at, y),
    lot,
    'solid',
    RANK.garden,
    footprint(placer, cell, at, [1.2, 1.2]),
    { support },
  );
}
