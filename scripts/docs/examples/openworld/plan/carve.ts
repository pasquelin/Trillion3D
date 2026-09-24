/**
 * What rivers, lakes, the airport platform and roads do to the ground (#332). Each is one pure
 * function of (x, z, height below it), continuous everywhere, so the terrain has no step and two
 * tiles that sample one point read one height.
 */
import type { Road } from './contract.ts';
import { lerp, smoothstep } from './noise.ts';
import { REPOSE, type RiverCourse } from './rivers.ts';
import { STEP, type HeightGrid } from './route.ts';
import { SegmentIndex, type Hit } from './segments.ts';

/** The widest a river valley opens on each side, metres: most of a tile. */
const VALLEY = 600;

/** The highest grid height within `margin` of a segment's bounding box. */
function highest(grid: HeightGrid, ax: number, az: number, bx: number, bz: number, margin: number) {
  let top = -Infinity;
  for (let z = Math.min(az, bz) - margin; z <= Math.max(az, bz) + margin; z += STEP)
    for (let x = Math.min(ax, bx) - margin; x <= Math.max(ax, bx) + margin; x += STEP)
      top = Math.max(top, grid.at(x, z));
  return top;
}

export type Lake = {
  id: string;
  x: number;
  z: number;
  radius: number;
  level: number;
  depth: number;
};
export type Platform = { minX: number; minZ: number; maxX: number; maxZ: number; level: number };
/**
 * A planned road and, per segment, whether it is a bridge span the ground passes under or a
 * tunnel bored through the ground over it: either way the ground there is left alone.
 */
export type RoadCourse = { road: Road; bridge: readonly boolean[]; tunnel: readonly boolean[] };

/** Carves river channels (a rounded bed, banks at the angle of repose) and lake basins. */
export function waterCarver(
  courses: readonly RiverCourse[],
  lakes: readonly Lake[],
  grid: HeightGrid,
) {
  const index = new SegmentIndex(),
    owner: [RiverCourse, number][] = [];
  for (const course of courses) {
    const { points, widths } = course.river;
    for (let at = 0; at < points.length - 1; at++) {
      // A bank rises at the angle of repose until it meets the land: the valley the cut opens
      // reaches as far as the highest land nearby stands above the water.
      const [a, b] = [points[at], points[at + 1]],
        land = highest(grid, a[0], a[2], b[0], b[2], VALLEY),
        water = Math.min(a[1], b[1]),
        reach =
          Math.max(widths[at], widths[at + 1]) / 2 + Math.max(0, land + STEP - water) / REPOSE;
      index.add(a[0], a[2], b[0], b[2], Math.min(reach, VALLEY));
      owner.push([course, at]);
    }
  }
  const hits: Hit[] = [];
  return (x: number, z: number, height: number) => {
    let ground = height;
    for (const { segment, t, distance } of index.near(x, z, hits)) {
      const [course, at] = owner[segment],
        half = lerp(course.river.widths[at], course.river.widths[at + 1], t) / 2,
        bed = lerp(course.beds[at], course.beds[at + 1], t),
        depth = lerp(course.depths[at], course.depths[at + 1], t),
        target =
          distance < half
            ? bed + depth * (distance / half) ** 2
            : bed + depth + (distance - half) * REPOSE;
      // Faded over the last fifth of the reach, so a valley that stops never leaves a step.
      const reach = index.reach[segment],
        faded = lerp(target, height, smoothstep(reach * 0.8, reach, distance));
      if (faded < ground) ground = faded;
    }
    for (const lake of lakes) {
      const r = Math.hypot(x - lake.x, z - lake.z),
        target =
          r < lake.radius
            ? lake.level - lake.depth * (1 - (r / lake.radius) ** 2)
            : lake.level + (r - lake.radius) * REPOSE;
      if (target < ground) ground = target;
    }
    return ground;
  };
}

/**
 * Earthworks toward a level `surface` at `outside` metres from its edge: land above the cut line
 * or below the fill line, both at the angle of repose, is brought onto it; beyond `cap` (where a
 * real work would stand on a retaining wall) the land is left alone, faded smoothly.
 */
function earthwork(land: number, surface: number, outside: number, cap: number) {
  const slope = outside * REPOSE,
    shaped = Math.min(surface + slope, Math.max(surface - slope, land));
  return lerp(shaped, land, smoothstep(0, cap, outside));
}

/** Levels the airport platform: a flat rectangle whose shoulders run to the land. */
export function platformLeveller(platform: Platform, cap: number) {
  return (x: number, z: number, height: number) => {
    const dx = Math.max(platform.minX - x, 0, x - platform.maxX),
      dz = Math.max(platform.minZ - z, 0, z - platform.maxZ);
    return earthwork(height, platform.level, Math.hypot(dx, dz), cap);
  };
}

/**
 * Levels the ground under every road to its surface with cut and fill shoulders; a bridge span
 * or a tunnel leaves the ground alone. A shoulder reaches four road widths: a work wider than that is a
 * retaining wall. Where roads meet, their earthworks blend by closeness.
 */
export function roadLeveller(courses: readonly RoadCourse[]) {
  const index = new SegmentIndex(),
    owner: [Road, number][] = [],
    // The segment before and after each one along its road, -1 at an end or a bridge.
    previous: number[] = [],
    next: number[] = [];
  for (const { road, bridge, tunnel } of courses)
    for (let at = 0; at < road.points.length - 1; at++) {
      if (bridge[at] || tunnel[at]) continue;
      const [a, b] = [road.points[at], road.points[at + 1]],
        segment = index.add(a[0], a[2], b[0], b[2], road.width * 4.5),
        joined = at > 0 && !bridge[at - 1] && !tunnel[at - 1];
      owner.push([road, at]);
      previous.push(joined ? segment - 1 : -1);
      next.push(-1);
      if (joined) next[segment - 1] = segment;
    }
  const hits: Hit[] = [];
  return (x: number, z: number, height: number) => {
    let strongest = 0,
      sum = 0,
      weights = 0;
    for (const { segment, t, distance } of index.near(x, z, hits)) {
      // A joint belongs to one segment only: the next one covers its start, and a point beside
      // the previous segment's span is that segment's, so no stretch pulls on its neighbours.
      if (t >= 1 && next[segment] >= 0) continue;
      if (t <= 0 && previous[segment] >= 0 && index.project(previous[segment], x, z).t < 1)
        continue;
      const [road, at] = owner[segment],
        surface = lerp(road.points[at][1], road.points[at + 1][1], t),
        half = road.width / 2,
        weight = smoothstep(road.width * 4.5, half, distance) ** 4;
      if (weight <= 0) continue;
      const cap = road.width * 4,
        shaped = distance <= half ? surface : earthwork(height, surface, distance - half, cap);
      strongest = Math.max(strongest, weight);
      sum += weight * (shaped - height);
      weights += weight;
    }
    return weights > 0 ? height + (Math.sqrt(Math.sqrt(strongest)) * sum) / weights : height;
  };
}
