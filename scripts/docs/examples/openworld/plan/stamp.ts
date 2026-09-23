/**
 * Roads and water beds in a baked ground texture (#332). Every road span on the ground (bridges
 * and tunnels excluded), river reach and lake is a capsule or a disc; each covers a texel by the
 * share of a texel-wide box it overlaps, so an edge falls between texels as a filtered image
 * would draw it, whatever the texel size. The ribbons laid over the terrain stay the surfaces a
 * walker sees at close range; the stamp is what they sit on and what shows at their edges.
 */
import { WORLD, type Surface } from './contract.ts';
import type { TerrainPlan } from './plan.ts';
import { roadSurface, SURFACE } from './surfaces.ts';

type Segment = { ax: number; az: number; bx: number; bz: number; half: number; surface: Surface };

const TILES = WORLD.size / WORLD.tile;
const tileOf = (value: number) => Math.floor((value + WORLD.size / 2) / WORLD.tile);

/**
 * Every path segment, listed under each tile its extent reaches (key `tz * TILES + tx`), with
 * half a tile to spare: a texel shared by two tiles' edges sees the same segments from both.
 */
export function pathIndex(plan: TerrainPlan) {
  const byTile = new Map<number, Segment[]>();
  const add = (segment: Segment) => {
    const { ax, az, bx, bz } = segment,
      half = segment.half + WORLD.tile / 2;
    for (let tz = tileOf(Math.min(az, bz) - half); tz <= tileOf(Math.max(az, bz) + half); tz++)
      for (let tx = tileOf(Math.min(ax, bx) - half); tx <= tileOf(Math.max(ax, bx) + half); tx++) {
        if (tx < 0 || tz < 0 || tx >= TILES || tz >= TILES) continue;
        const list = byTile.get(tz * TILES + tx) ?? [];
        byTile.set(tz * TILES + tx, list);
        list.push(segment);
      }
  };
  for (const { road, bridge, tunnel } of plan.courses)
    for (let k = 0; k < road.points.length - 1; k++)
      if (!bridge[k] && !tunnel[k])
        add({
          ax: road.points[k][0],
          az: road.points[k][2],
          bx: road.points[k + 1][0],
          bz: road.points[k + 1][2],
          half: road.width / 2,
          surface: roadSurface(road.class),
        });
  for (const { points, widths } of plan.rivers)
    for (let k = 0; k < points.length - 1; k++)
      add({
        ax: points[k][0],
        az: points[k][2],
        bx: points[k + 1][0],
        bz: points[k + 1][2],
        half: Math.max(widths[k], widths[k + 1]) / 2,
        surface: SURFACE.seabed,
      });
  // A lake is a capsule of zero length: its disc.
  for (const lake of plan.lakes)
    add({
      ax: lake.x,
      az: lake.z,
      bx: lake.x,
      bz: lake.z,
      half: lake.radius,
      surface: SURFACE.seabed,
    });
  return (tx: number, tz: number): readonly Segment[] => byTile.get(tz * TILES + tx) ?? [];
}

/** Distance from (x, z) to the segment. */
function distance(s: Segment, x: number, z: number) {
  const dx = s.bx - s.ax,
    dz = s.bz - s.az,
    length = dx * dx + dz * dz,
    t = length ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / length)) : 0;
  return Math.hypot(x - s.ax - t * dx, z - s.az - t * dz);
}

/**
 * Coverage of a `size`² texel grid (texel `(i, j)` at `(x0 + i·step, z0 + j·step)`) by the
 * segments: per texel the largest coverage in [0, 1] and the surface that holds it.
 */
export function stampPaths(
  segments: readonly Segment[],
  x0: number,
  z0: number,
  size: number,
  step: number,
) {
  const cover = new Float32Array(size * size),
    surface: (Surface | undefined)[] = new Array(size * size);
  for (const s of segments) {
    const reach = s.half + step,
      texel = (value: number, origin: number, round: (v: number) => number) =>
        Math.max(0, Math.min(size - 1, round((value - origin) / step)));
    for (
      let j = texel(Math.min(s.az, s.bz) - reach, z0, Math.floor);
      j <= texel(Math.max(s.az, s.bz) + reach, z0, Math.ceil);
      j++
    )
      for (
        let i = texel(Math.min(s.ax, s.bx) - reach, x0, Math.floor);
        i <= texel(Math.max(s.ax, s.bx) + reach, x0, Math.ceil);
        i++
      ) {
        const at = j * size + i,
          c = Math.max(
            0,
            Math.min(1, 0.5 + (s.half - distance(s, x0 + i * step, z0 + j * step)) / step),
          );
        if (c > cover[at]) {
          cover[at] = c;
          surface[at] = s.surface;
        }
      }
  }
  return { cover, surface };
}
