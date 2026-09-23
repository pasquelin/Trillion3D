/**
 * Where the plan's water goes (#332), found on a height grid: the airport platform first (rivers
 * keep clear of it), the three rivers down to their mouths on the south shore, and two lakes in basins, one in the
 * countryside and one in the mountains, clear of the rivers.
 */
import type { Lake } from './carve.ts';
import { WORLD } from './contract.ts';
import { REGION_BOUNDS } from './layout.ts';
import type { Relief } from './relief.ts';
import { planRivers } from './rivers.ts';
import type { HeightGrid } from './route.ts';
import { airportPlatform, basinLake } from './sites.ts';

export function planWaters(
  grid: HeightGrid,
  height: (x: number, z: number) => number,
  relief: Relief,
) {
  const platform = airportPlatform(grid),
    onPlatform = (x: number, z: number) =>
      x > platform.minX - 300 &&
      x < platform.maxX + 300 &&
      z > platform.minZ - 300 &&
      z < platform.maxZ + 300,
    // The main river reaches the sea in the city, the east river in the coast region.
    mouth = [-1_500, relief.southCoastZ(-1_500)] as const,
    eastMouth = 2_800,
    rivers = planRivers(
      grid,
      height,
      {
        south: [mouth[0], mouth[1] + 300],
        east: [eastMouth, relief.southCoastZ(eastMouth) + 300],
      },
      onPlatform,
    );
  const nearRiver = (x: number, z: number, margin: number) =>
    rivers.some(({ river }) => river.points.some((p) => Math.hypot(p[0] - x, p[2] - z) < margin));
  // A lake keeps its whole rim on the map.
  const inland = (x: number, z: number) =>
    Math.max(Math.abs(x), Math.abs(z)) < WORLD.size / 2 - 600;
  const lakes = [
    basinLake(
      grid,
      'lake-countryside',
      REGION_BOUNDS.countryside,
      350,
      (x, z, h) => h > 20 && inland(x, z) && !onPlatform(x, z) && !nearRiver(x, z, 500),
    ),
    basinLake(
      grid,
      'lake-alpine',
      REGION_BOUNDS.mountains,
      250,
      (x, z, h) => h > 900 && h < 1_800 && inland(x, z) && !nearRiver(x, z, 400),
    ),
  ];
  return { platform, onPlatform, mouth, rivers, lakes };
}

/** `lake` in its place, its level read again on `grid`: the lowest point of its rim. */
export const relevel = (grid: HeightGrid, lake: Lake): Lake =>
  basinLake(
    grid,
    lake.id,
    { minX: lake.x, maxX: lake.x, minZ: lake.z, maxZ: lake.z },
    lake.radius,
    () => true,
  );
