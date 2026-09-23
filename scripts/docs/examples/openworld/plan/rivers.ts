/**
 * The river network (#332): three rivers born below the northern crests, routed downhill over the
 * natural relief to the sea. The main river reaches the south coast where the city stands, a
 * second one the shore of the coast region, and a tributary joins the main river from the west. Each
 * course carries a bed profile that only ever descends, so water never climbs.
 */
import { WORLD, type River, type Vec3 } from './contract.ts';
import { chaikin, resample, type Point2 } from './polyline.ts';
import { node, nodeX, nodeZ, route, STEP, type HeightGrid } from './route.ts';

/** Resampling step of a river course, metres. */
const RIVER_STEP = 100;
/**
 * Slope of a bank or a cut, rise over run: the angle of repose of loose soil (about 33°), the
 * steepest slope earth keeps without a wall.
 */
export const REPOSE = Math.tan((33 * Math.PI) / 180);

export type RiverCourse = { river: River; beds: readonly number[]; depths: readonly number[] };

type Window = { minX: number; maxX: number; minZ: number; maxZ: number };

/** The highest grid node in a window that lies below the crests: where a spring rises. */
function spring(grid: HeightGrid, window: Window): Point2 {
  let best: Point2 = [window.minX, window.minZ],
    top = -Infinity;
  for (let z = window.minZ; z <= window.maxZ; z += STEP)
    for (let x = window.minX; x <= window.maxX; x += STEP) {
      const h = grid.at(x, z);
      if (h <= WORLD.peak * 0.65 && h > top) [best, top] = [[x, z], h];
    }
  return best;
}

/** Bed, depth and water level along a course: the bed never rises downstream. */
function profile(
  id: string,
  points: readonly Point2[],
  height: (x: number, z: number) => number,
  widths: readonly [number, number],
): RiverCourse {
  const beds: number[] = [],
    depths: number[] = [],
    riverWidths: number[] = [],
    water: Vec3[] = [];
  const cut = points.findIndex(([x, z]) => height(x, z) < 0),
    course = cut > 0 ? points.slice(0, cut + 1) : points;
  course.forEach(([x, z], index) => {
    const along = index / Math.max(1, course.length - 1),
      width = widths[0] + (widths[1] - widths[0]) * along ** 0.7,
      depth = 1.5 + width / 15,
      natural = height(x, z) - depth,
      bed = index ? Math.min(beds[index - 1] - RIVER_STEP * 5e-4, natural) : natural,
      level = index ? Math.min(water[index - 1][1], bed + depth) : bed + depth;
    beds.push(bed);
    depths.push(depth);
    riverWidths.push(width);
    water.push([x, level, z]);
  });
  return { river: { id, points: water, widths: riverWidths }, beds, depths };
}

/**
 * Routes the rivers over `grid` (the natural relief) and profiles them with `height`. `avoid`
 * says where a river may not flow (the airport platform).
 */
export function planRivers(
  grid: HeightGrid,
  height: (x: number, z: number) => number,
  mouths: { south: Point2; east: Point2 },
  avoid: (x: number, z: number) => boolean,
): RiverCourse[] {
  const cost = (_: number, to: number, length: number, rise: number) =>
    avoid(nodeX(to), nodeZ(to)) ? Infinity : length + 40 * Math.max(0, rise);
  const trace = (source: Point2, goal: Point2 | ((index: number) => boolean)) => {
    const path = route(grid, source, goal, cost);
    if (!path) throw new Error(`No river course from ${source.join(', ')}`);
    return resample(chaikin(path, 3), RIVER_STEP);
  };
  const main = trace(spring(grid, { minX: -2_500, maxX: -1_000, minZ: -3_200, maxZ: -2_500 }), [
      mouths.south[0],
      mouths.south[1],
    ]),
    east = trace(spring(grid, { minX: 2_000, maxX: 3_500, minZ: -3_200, maxZ: -2_500 }), [
      mouths.east[0],
      mouths.east[1],
    ]),
    mainNodes = new Set(main.map(([x, z]) => node(x, z))),
    joins = (index: number) => mainNodes.has(index),
    tributary = trace(
      spring(grid, { minX: -3_800, maxX: -3_000, minZ: -3_200, maxZ: -2_500 }),
      joins,
    );
  return [
    profile('river-main', main, height, [8, 40]),
    profile('river-east', east, height, [6, 25]),
    profile('river-west', tributary, height, [5, 15]),
  ];
}
