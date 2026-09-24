/**
 * Where each region lies and how two regions blend at their border (#332). The six rectangles
 * tile the whole map; the sea is not a rectangle but whatever the relief puts below sea level.
 * One rule, `landWeights`, gives every point its blend: region refinements and ground paint both
 * read it, so no seam can appear between two regions.
 */
import { WORLD, type Bounds, type RegionName } from './contract.ts';
import { smoothstep } from './noise.ts';

const HALF = WORLD.size / 2;

/** The regions in a fixed order; arrays of weights follow it. */
export const REGIONS: readonly RegionName[] = [
  'mountains',
  'city',
  'airport',
  'desert',
  'countryside',
  'coast',
];

/**
 * The layout of the map (+X east, +Z south), packed so no ground is left empty: the airport in
 * the middle, the desert west of it and the countryside east of it, the mountains along the whole
 * north edge behind the terminal, the city and its harbour south of the airport on the coast, the
 * coast region and its islands along the south-east shore. A design choice, not a measurement.
 */
export const REGION_BOUNDS: Record<RegionName, Bounds> = {
  mountains: { minX: -HALF, minZ: -HALF, maxX: HALF, maxZ: -2_300 },
  desert: { minX: -HALF, minZ: -2_300, maxX: -1_800, maxZ: 1_300 },
  airport: { minX: -1_800, minZ: -2_300, maxX: 1_800, maxZ: 1_300 },
  countryside: { minX: 1_800, minZ: -2_300, maxX: HALF, maxZ: 1_300 },
  city: { minX: -HALF, minZ: 1_300, maxX: 1_000, maxZ: HALF },
  coast: { minX: 1_000, minZ: 1_300, maxX: HALF, maxZ: HALF },
};

/** Width of a transition band between two regions, metres: short, so no land is a blur. */
export const BAND = 200;

/** Signed distance to a rectangle, negative inside; the map's outer edges are not borders. */
function signedDistance(bounds: Bounds, x: number, z: number): number {
  const edge = (min: number, max: number, value: number) =>
    Math.max(min <= -HALF ? -Infinity : min - value, max >= HALF ? -Infinity : value - max);
  const dx = edge(bounds.minX, bounds.maxX, x),
    dz = edge(bounds.minZ, bounds.maxZ, z);
  if (dx > 0 || dz > 0) return Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  return Math.max(dx, dz);
}

/**
 * The blend weights of the six regions at (x, z), in `REGIONS` order, summing to 1. Inside a
 * region far from its borders only its own weight is non-zero; across a border the two weights
 * cross smoothly over `BAND`.
 */
export function landWeights(x: number, z: number, out = new Float64Array(REGIONS.length)) {
  let total = 0;
  for (let index = 0; index < REGIONS.length; index++) {
    const distance = signedDistance(REGION_BOUNDS[REGIONS[index]], x, z),
      weight = smoothstep(BAND / 2, -BAND / 2, distance);
    out[index] = weight;
    total += weight;
  }
  for (let index = 0; index < REGIONS.length; index++) out[index] /= total;
  return out;
}
