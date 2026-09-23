/**
 * Where things stand (#332): lakes in basins, the airport platform on flat ground, the city at
 * the main river's mouth, towns and villages on the flattest land around a seeded spot. Every
 * site is found by searching the relief, so a new seed or a new region refinement moves it to
 * ground that suits it.
 */
import { type Bounds, type RegionName, type Settlement, type Vec3 } from './contract.ts';
import type { Lake, Platform } from './carve.ts';
import { REGION_BOUNDS } from './layout.ts';
import { hash2 } from './noise.ts';
import { STEP, type HeightGrid } from './route.ts';

/** The grid's steepest rise to a neighbour, rise over run: how flat a node's ground is. */
export function slopeAt(grid: HeightGrid, x: number, z: number): number {
  const h = grid.at(x, z);
  return Math.max(
    ...[
      [STEP, 0],
      [-STEP, 0],
      [0, STEP],
      [0, -STEP],
    ].map(([dx, dz]) => Math.abs(grid.at(x + dx, z + dz) - h) / STEP),
  );
}

/** The grid node inside `area` with the highest score, or `null` when every score is -∞. */
export function best(
  grid: HeightGrid,
  area: Bounds,
  score: (x: number, z: number, h: number) => number,
) {
  let found: Vec3 | null = null,
    top = -Infinity;
  const snap = (value: number) => Math.ceil(value / STEP) * STEP;
  for (let z = snap(area.minZ); z <= area.maxZ; z += STEP)
    for (let x = snap(area.minX); x <= area.maxX; x += STEP) {
      const h = grid.at(x, z),
        value = score(x, z, h);
      if (value > top) [found, top] = [[x, h, z], value];
    }
  return found;
}

export const around = (x: number, z: number, radius: number): Bounds => ({
  minX: x - radius,
  maxX: x + radius,
  minZ: z - radius,
  maxZ: z + radius,
});
const inset = (bounds: Bounds, margin: number): Bounds => ({
  minX: bounds.minX + margin,
  maxX: bounds.maxX - margin,
  minZ: bounds.minZ + margin,
  maxZ: bounds.maxZ - margin,
});

/** The airport platform: 3.3 × 2.2 km, levelled at the mean height of the ground it covers. */
export function airportPlatform(grid: HeightGrid): Platform {
  // The platform stays inside the airport's rectangle, sought near its middle.
  const b = REGION_BOUNDS.airport,
    [halfX, halfZ] = [1_650, 1_100],
    area = {
      minX: b.minX + halfX,
      maxX: b.maxX - halfX,
      minZ: b.minZ + halfZ + 200,
      maxZ: b.maxZ - halfZ - 200,
    },
    centre = best(grid, area, (x, z) => -rough(grid, around(x, z, halfZ)))!,
    rect = {
      minX: centre[0] - halfX,
      maxX: centre[0] + halfX,
      minZ: centre[2] - halfZ,
      maxZ: centre[2] + halfZ,
    };
  let sum = 0,
    count = 0;
  for (let z = rect.minZ; z <= rect.maxZ; z += STEP)
    for (let x = rect.minX; x <= rect.maxX; x += STEP)
      [sum, count] = [sum + grid.at(x, z), count + 1];
  return { ...rect, level: Math.max(sum / count, 8) };
}

/** Spread of heights in an area, metres: how much earth levelling it would move. */
function rough(grid: HeightGrid, area: Bounds): number {
  let low = Infinity,
    high = -Infinity;
  for (let z = area.minZ; z <= area.maxZ; z += STEP * 2)
    for (let x = area.minX; x <= area.maxX; x += STEP * 2) {
      const h = grid.at(x, z);
      [low, high] = [Math.min(low, h), Math.max(high, h)];
      if (h < 2) return Infinity;
    }
  return high - low;
}

/** A lake in the deepest basin of an area: its level is the lowest point of its rim. */
export function basinLake(
  grid: HeightGrid,
  id: string,
  area: Bounds,
  radius: number,
  allowed: (x: number, z: number, h: number) => boolean,
): Lake {
  const ring = (x: number, z: number) =>
    Array.from({ length: 16 }, (_, k) =>
      grid.at(x + radius * Math.cos(k * 0.3927), z + radius * Math.sin(k * 0.3927)),
    );
  const centre = best(grid, area, (x, z, h) => {
    if (!allowed(x, z, h)) return -Infinity;
    const rim = ring(x, z);
    return Math.min(...rim) - h - slopeAt(grid, x, z) * radius;
  })!;
  const level = Math.min(...ring(centre[0], centre[2]));
  return { id, x: centre[0], z: centre[2], radius, level, depth: 4 + radius / 40 };
}

/**
 * One settlement on the flattest dry land within `radius` of a seeded spot, its whole footprint
 * (`margin`) inside `bounds`.
 */
export function settle(
  grid: HeightGrid,
  spot: readonly [number, number],
  radius: number,
  bounds: Bounds,
  margin: number,
  allowed: (x: number, z: number, h: number) => boolean,
): Vec3 | null {
  const near = around(spot[0], spot[1], radius),
    inside = inset(bounds, margin),
    area = {
      minX: Math.max(near.minX, inside.minX),
      maxX: Math.min(near.maxX, inside.maxX),
      minZ: Math.max(near.minZ, inside.minZ),
      maxZ: Math.min(near.maxZ, inside.maxZ),
    };
  return best(grid, area, (x, z, h) =>
    allowed(x, z, h) && h > 3
      ? -slopeAt(grid, x, z) - Math.hypot(x - spot[0], z - spot[1]) / 1e5
      : -Infinity,
  );
}

/**
 * A seeded spot on dry land inside a region, kept 200 m away from its borders: the first of a
 * few seeded draws that lands on ground above the sea, so a mostly-sea region still settles.
 */
export function seededSpot(
  grid: HeightGrid,
  seed: number,
  region: RegionName,
  index: number,
): [number, number] {
  const b = inset(REGION_BOUNDS[region], 200);
  let spot: [number, number] = [b.minX, b.minZ];
  for (let draw = 0; draw < 32; draw++) {
    spot = [
      b.minX + (b.maxX - b.minX) * hash2(seed, index, 1 + draw * 2),
      b.minZ + (b.maxZ - b.minZ) * hash2(seed, index, 2 + draw * 2),
    ];
    if (grid.at(spot[0], spot[1]) > 3) break;
  }
  return spot;
}

/** Settlement radii by kind, metres: a design of the world's scale, not a measurement. */
export const RADIUS: Record<Settlement['kind'], number> = {
  city: 2_600,
  town: 800,
  village: 300,
  airport: 2_000,
  port: 500,
  resort: 500,
};
