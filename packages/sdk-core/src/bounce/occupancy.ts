import { PROXY_TRIANGLE_FLOATS, type SceneProxy } from '../contracts/proxy.ts';
import type { BounceCascades } from './cascades.ts';

/**
 * Where keeping a probe is worthwhile: cascade occupancy map.
 *
 * A cascade across a city spends most cells on empty sky and solid building cores,
 * where irradiance is never queried. The scheduler needs to know, before spending a ray,
 * whether a cell touches geometry. This is a property of the world, not the camera: calculated
 * once at construction, valid for all positions mobile levels take later.
 *
 * The finest level map is marked by bounding boxes of proxy triangles plus a one-cell
 * boundary: eight corners of an occupied cell are always retained, so nothing useful is lost.
 * Subsequent levels are exact reductions — two cells to one per axis, since spacings are
 * power-of-two multiples of the finest — then dilated by one cell for the same reason.
 *
 * Nothing here names a scene or inspects the camera: extent, triangles, cells.
 */
export interface BounceOccupancy {
  /** True when a level's cell in its global lattice warrants a probe. */
  occupied(level: number, x: number, y: number, z: number): boolean;
  /** Marked cells and total cells of the finest level: published gain. */
  marked: number;
  /** Cells of the finest level. */
  cells: number;
  /** Bytes it takes. */
  bytes: number;
}

/** Marks a block of cells, bounds included, staying within map. */
function mark(map: Uint8Array, dims: number[], low: number[], high: number[]) {
  const x0 = Math.max(0, low[0]),
    y0 = Math.max(0, low[1]),
    z0 = Math.max(0, low[2]);
  const x1 = Math.min(dims[0] - 1, high[0]),
    y1 = Math.min(dims[1] - 1, high[1]),
    z1 = Math.min(dims[2] - 1, high[2]);
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++) {
      const row = dims[0] * (y + dims[1] * z);
      for (let x = x0; x <= x1; x++) map[row + x] = 1;
    }
}

/** Map reduction: a cell in the next level is marked if any of the eight sub-cells are marked. */
function reduce(map: Uint8Array, dims: number[]) {
  const next = dims.map((size) => Math.max(1, Math.ceil(size / 2)));
  const out = new Uint8Array(next[0] * next[1] * next[2]);
  for (let z = 0; z < dims[2]; z++)
    for (let y = 0; y < dims[1]; y++)
      for (let x = 0; x < dims[0]; x++) {
        if (!map[x + dims[0] * (y + dims[1] * z)]) continue;
        const half = [x >> 1, y >> 1, z >> 1];
        out[half[0] + next[0] * (half[1] + next[1] * half[2])] = 1;
      }
  return { map: out, dims: next };
}

/** Dilates a map by one cell along three axes: required boundary for interpolation. */
function dilate(map: Uint8Array, dims: number[]) {
  const out = new Uint8Array(map.length);
  for (let z = 0; z < dims[2]; z++)
    for (let y = 0; y < dims[1]; y++)
      for (let x = 0; x < dims[0]; x++) {
        if (!map[x + dims[0] * (y + dims[1] * z)]) continue;
        mark(out, dims, [x - 1, y - 1, z - 1], [x + 1, y + 1, z + 1]);
      }
  return out;
}

/** Marks which probe cells hold geometry, so empty space gets no probe. */
export function createBounceOccupancy(
  proxy: SceneProxy,
  cascades: BounceCascades,
): BounceOccupancy {
  const spacing = cascades.levels[0].spacing;
  // Origin and dimensions are aligned to the largest reduction: otherwise a coarse level cell
  // would not equal the exact eight-block of the previous level, lying by one cell out of two.
  const align = 2 ** (cascades.levels.length - 1);
  const floorTo = (value: number) => Math.floor(value / align) * align;
  const origin = [0, 1, 2].map((axis) => floorTo(Math.floor(proxy.bounds[axis] / spacing) - 2));
  const dims = [0, 1, 2].map((axis) =>
    Math.max(
      align,
      floorTo(Math.floor(proxy.bounds[3 + axis] / spacing) + 3 - origin[axis]) + align,
    ),
  );
  let map = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const cells = map.length;
  const triangles = proxy.data.triangles;
  const low = [0, 0, 0],
    high = [0, 0, 0];
  for (
    let base = 0;
    base + PROXY_TRIANGLE_FLOATS <= triangles.length;
    base += PROXY_TRIANGLE_FLOATS
  ) {
    for (let axis = 0; axis < 3; axis++) {
      const a = triangles[base + axis],
        b = triangles[base + 3 + axis],
        c = triangles[base + 6 + axis];
      low[axis] = Math.floor(Math.min(a, b, c) / spacing) - origin[axis];
      high[axis] = Math.floor(Math.max(a, b, c) / spacing) - origin[axis];
    }
    mark(map, dims, low, high);
  }
  map = dilate(map, dims);
  const maps = [{ map, dims, origin }];
  let bytes = map.length;
  for (let level = 1; level < cascades.levels.length; level++) {
    const reduced = reduce(maps[level - 1].map, maps[level - 1].dims);
    const dilated = dilate(reduced.map, reduced.dims);
    maps.push({
      map: dilated,
      dims: reduced.dims,
      origin: maps[level - 1].origin.map((value) => value / 2),
    });
    bytes += dilated.length;
  }
  return {
    cells,
    bytes,
    marked: maps[0].map.reduce((sum, value) => sum + value, 0),
    // Called once per examined probe each frame: nothing allocated or traversed.
    occupied(level, x, y, z) {
      const entry = maps[Math.min(level, maps.length - 1)];
      const [width, height, depth] = entry.dims;
      const localX = x - entry.origin[0],
        localY = y - entry.origin[1],
        localZ = z - entry.origin[2];
      if (localX < 0 || localY < 0 || localZ < 0) return false;
      if (localX >= width || localY >= height || localZ >= depth) return false;
      return entry.map[localX + width * (localY + height * localZ)] === 1;
    },
  };
}
