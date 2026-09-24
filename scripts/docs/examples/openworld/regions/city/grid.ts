/**
 * The city's grid. Square cells of one block each, laid on the grid heading around the city
 * centre; a cell is built when its whole block lies inside the settlement, on dry land, clear of
 * the plan's roads, and flat enough for a plinth. Each cell gets a district by its distance from
 * the centre (downtown, mid-rise, suburb), a few become parks, and one 2 × 2 group the stadium.
 */
import { hash01 } from '../../props/index.ts';
import { superblockSize } from './catalog.ts';
import type { Vec3 } from '../../plan/contract.ts';
import { corners, turn, type Obb, type Xz } from './frame.ts';
import { KERB } from './ground-props.ts';
import { TOUCH } from './placement.ts';
import { FOUNDATION } from './tower-kit.ts';
import { dry, groundUnder, inBounds, type Site } from './site.ts';

type District = 'downtown' | 'midrise' | 'suburb' | 'park' | 'stadium';

export type Cell = {
  i: number;
  j: number;
  box: Obb;
  /** Distance from the city centre over the settlement radius. */
  d: number;
  district: District;
  /** Top of the block's plinth before the kerb: the highest ground under it. */
  base: number;
  /** The stadium's 2 × 2 group, by its lowest (i, j), when the cell belongs to it. */
  group?: string;
};

/** Where cell-local offsets `(u, v)` from the grid origin land in the world. */
export const gridPoint = (site: Site, [u, v]: Xz): Xz => {
  const [x, z] = turn([u, v], site.yaw);
  return [site.origin[0] + x, site.origin[1] + z];
};

/** Downtown ends at this share of the radius, mid-rise at the next: an old core, then rings. */
/**
 * The most a block's ground may fall across it: its plinth stands on the highest point, and its
 * foundation must still reach the lowest one under the kerb.
 */
const STEP = FOUNDATION - KERB;

/** Ground samples under a plinth, metres apart: finer than a road's earthwork shoulder. */
export const SAMPLE = 5;

export const RINGS = { downtown: 0.28, midrise: 0.5 } as const;

export function layCells(site: Site, seed: number): Map<string, Cell> {
  const cells = new Map<string, Cell>(),
    { pitch } = site,
    n = Math.ceil(site.city.radius / pitch) + 2,
    half = site.block / 2;
  for (let i = -n; i < n; i++)
    for (let j = -n; j < n; j++) {
      const centre = gridPoint(site, [(i + 0.5) * pitch, (j + 0.5) * pitch]),
        box: Obb = { centre, half: [half, half], yaw: site.yaw },
        d =
          Math.hypot(centre[0] - site.city.centre[0], centre[1] - site.city.centre[2]) /
          site.city.radius;
      if (d > 1 || !inBounds(site, centre, pitch)) continue;
      const ground = groundUnder(site, box, SAMPLE);
      if (Math.max(...ground) - Math.min(...ground) > STEP) continue;
      if (![...corners(box), box.centre].every((p) => dry(site, p))) continue;
      if (site.roads.hits(box, TOUCH).length) continue;
      const ring = d + (hash01(seed, i, j) - 0.5) * 0.08;
      const district: District =
        ring < RINGS.downtown ? 'downtown' : ring < RINGS.midrise ? 'midrise' : 'suburb';
      cells.set(key(i, j), { i, j, box, d, district, base: Math.max(...ground) });
    }
  for (const cell of cells.values())
    if (cell.district !== 'downtown' && hash01(seed + 1, cell.i, cell.j) < 0.05)
      cell.district = 'park';
  placeStadium(site, cells);
  return cells;
}

export const key = (i: number, j: number) => `${i},${j}`;

/** The stadium takes the 2 × 2 group of built, non-downtown cells nearest mid-radius. */
function placeStadium(site: Site, cells: Map<string, Cell>) {
  let best: Cell[] | undefined,
    score = Infinity;
  for (const cell of cells.values()) {
    const group = [
      cell,
      cells.get(key(cell.i + 1, cell.j)),
      cells.get(key(cell.i, cell.j + 1)),
      cells.get(key(cell.i + 1, cell.j + 1)),
    ];
    const s = Math.abs(cell.d - RINGS.midrise);
    if (s >= score || group.some((c) => !c || c.district === 'downtown')) continue;
    const plinth = superblock(site, cell),
      ground = groundUnder(site, plinth, SAMPLE);
    if (site.roads.hits(plinth, TOUCH).length || Math.max(...ground) - Math.min(...ground) > STEP)
      continue;
    [best, score] = [group as Cell[], s];
  }
  if (!best) return;
  const base = Math.max(...groundUnder(site, superblock(site, best[0]), SAMPLE));
  for (const cell of best)
    Object.assign(cell, { district: 'stadium', group: key(best[0].i, best[0].j), base });
}

/** The stadium's plinth: two blocks and the street between, from cell `(i, j)` to `(i+1, j+1)`. */
export const superblock = (site: Site, { i, j }: { i: number; j: number }): Obb => ({
  centre: gridPoint(site, [(i + 1) * site.pitch, (j + 1) * site.pitch]),
  half: [superblockSize(site) / 2, superblockSize(site) / 2],
  yaw: site.yaw,
});

/** A cell-local point `(u, v)` from the block centre, in the world, at height `y`. */
export const inCell = (placer: { site: Site }, cell: { box: Obb }, [u, v]: Xz, y: number): Vec3 => {
  const [x, z] = turn([u, v], placer.site.yaw);
  return [cell.box.centre[0] + x, y, cell.box.centre[1] + z];
};

/** A footprint in the cell's frame, turned `yaw` past the grid. */
export const footprint = (
  placer: { site: Site },
  cell: { box: Obb },
  at: Xz,
  half: Xz,
  yaw = 0,
): Obb => {
  const [x, , z] = inCell(placer, cell, at, 0);
  return { centre: [x, z], half, yaw: placer.site.yaw + yaw };
};
