/**
 * Flat surfaces laid over the terrain (#332): the sea as one quad per tile at sea level, lakes as
 * discs at their level, rivers as ribbons on their water line, and roads as ribbons on the
 * levelled ground. Each piece goes to the tile holding its middle, in that tile's local frame.
 */
import { WORLD, type Surface, type Vec3 } from './contract.ts';
import type { TerrainPlan } from './plan.ts';
import { roadSurface, SURFACE } from './surfaces.ts';
import { tileOrigin } from './tileGrid.ts';

export type FlatPart = { surface: Surface; positions: number[]; indices: number[] };
/** Flat parts per tile, keyed `tx_tz`. */
export type FlatParts = Map<string, FlatPart[]>;

const TILES = WORLD.size / WORLD.tile;
const tileOf = (value: number) =>
  Math.min(TILES - 1, Math.max(0, Math.floor((value + WORLD.size / 2) / WORLD.tile)));
/** Segments of a lake's shore: a vertex every few metres of its rim at the lakes' sizes. */
const LAKE_SEGMENTS = 48;
/** How far a water or road surface reaches under the ground at its edges, metres. */
const TUCK = 2;

/** The part of `surface` in the tile holding (x, z), and that tile's corner. */
function part(parts: FlatParts, x: number, z: number, surface: Surface) {
  const tx = tileOf(x),
    tz = tileOf(z),
    key = `${tx}_${tz}`,
    list = parts.get(key) ?? [];
  parts.set(key, list);
  let found = list.find((p) => p.surface.name === surface.name);
  if (!found) list.push((found = { surface, positions: [], indices: [] }));
  return { target: found, x0: tileOrigin(tx), z0: tileOrigin(tz) };
}

/** A strip of quads along a polyline, `half[k]` metres each side, `lift` metres above it. */
function ribbon(
  parts: FlatParts,
  points: readonly Vec3[],
  half: (k: number) => number,
  surface: Surface,
  skip: (k: number) => boolean,
  lift: number,
) {
  const side = points.map((p, k) => {
    const [a, b] = [points[Math.max(0, k - 1)], points[Math.min(points.length - 1, k + 1)]],
      dx = b[0] - a[0],
      dz = b[2] - a[2],
      length = Math.hypot(dx, dz) || 1;
    return [-dz / length, dx / length];
  });
  for (let k = 0; k < points.length - 1; k++) {
    if (skip(k)) continue;
    const [a, b] = [points[k], points[k + 1]],
      { target, x0, z0 } = part(parts, (a[0] + b[0]) / 2, (a[2] + b[2]) / 2, surface),
      base = target.positions.length / 3;
    for (const [p, n, h] of [
      [a, side[k], half(k)],
      [b, side[k + 1], half(k + 1)],
    ] as const)
      for (const s of [1, -1])
        target.positions.push(p[0] + n[0] * h * s - x0, p[1] + lift, p[2] + n[1] * h * s - z0);
    target.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
}

/**
 * Every flat part of the world: rivers, lakes, roads (bridge spans and tunnels left to the regions' bridge
 * models), lifted by `lift` metres over the ground they lie on.
 */
export function flatParts(plan: TerrainPlan, lift: number): FlatParts {
  const parts: FlatParts = new Map();
  for (const river of plan.rivers)
    ribbon(
      parts,
      river.points,
      (k) => river.widths[k] / 2 + TUCK,
      SURFACE.river,
      () => false,
      0,
    );
  for (const lake of plan.lakes) {
    const { target, x0, z0 } = part(parts, lake.x, lake.z, SURFACE.lake),
      base = target.positions.length / 3,
      radius = lake.radius + TUCK;
    target.positions.push(lake.x - x0, lake.level, lake.z - z0);
    for (let k = 0; k < LAKE_SEGMENTS; k++) {
      const angle = (k / LAKE_SEGMENTS) * Math.PI * 2;
      target.positions.push(
        lake.x + radius * Math.cos(angle) - x0,
        lake.level,
        lake.z + radius * Math.sin(angle) - z0,
      );
      target.indices.push(base, base + 1 + ((k + 1) % LAKE_SEGMENTS), base + 1 + k);
    }
  }
  for (const { road, bridge, tunnel } of plan.courses)
    ribbon(
      parts,
      road.points,
      () => road.width / 2,
      roadSurface(road.class),
      (k) => bridge[k] || tunnel[k],
      lift,
    );
  return parts;
}

/** The sea's quad over a whole tile, at sea level, local to the tile. */
export function seaQuad(): FlatPart {
  const size = WORLD.tile;
  return {
    surface: SURFACE.sea,
    positions: [
      0,
      WORLD.seaLevel,
      0,
      size,
      WORLD.seaLevel,
      0,
      0,
      WORLD.seaLevel,
      size,
      size,
      WORLD.seaLevel,
      size,
    ],
    indices: [0, 2, 1, 1, 2, 3],
  };
}
