import type { SceneProxy } from '../contracts/proxy.ts';
import { proxyTriangleBoxes } from '../scene/core/proxyBoxes.ts';
import type { BounceCascades } from './cascades.ts';

/**
 * Where keeping a probe is worthwhile: cascade occupancy map.
 *
 * A cascade across a city spends most cells on empty sky and solid building cores,
 * where irradiance is never queried. The scheduler needs to know, before spending a ray,
 * whether a cell touches geometry. This is a property of the world, not the camera: calculated
 * at construction and again once moved geometry settles, valid for all positions mobile levels
 * take later.
 *
 * The finest level map is marked by bounding boxes of proxy triangles plus a one-cell
 * boundary: eight corners of an occupied cell are always retained, so nothing useful is lost.
 * Subsequent levels are exact reductions — two cells to one per axis, since spacings are
 * power-of-two multiples of the finest — then dilated by one cell for the same reason.
 *
 * Nothing here names a scene or inspects the camera: extent, triangles, cells.
 */
export interface BounceOccupancy {
  /** Owners moved: `boxes` holds six world bounds per proxy triangle, `changed` flags the moved. */
  moved(boxes: ArrayLike<number>, changed: ArrayLike<number>): void;
  /** Once per frame: the first frame after motion stopped rebuilds the exact map on `extent`. */
  settle(boxes: ArrayLike<number>, extent: readonly number[]): void;
  /** True when a level's cell in its global lattice warrants a probe. */
  occupied(level: number, x: number, y: number, z: number): boolean;
  /** Marked cells and total cells of the finest level: published gain. */
  readonly marked: number;
  /** Cells of the finest level. */
  readonly cells: number;
  /** Bytes it takes. */
  readonly bytes: number;
}

type LevelMap = { map: Uint8Array; dims: number[]; origin: number[] };

/** Marks a block of cells, bounds included, staying within map; returns the cells newly marked. */
function mark(map: Uint8Array, dims: number[], low: number[], high: number[]) {
  const x0 = Math.max(0, low[0]),
    y0 = Math.max(0, low[1]),
    z0 = Math.max(0, low[2]);
  const x1 = Math.min(dims[0] - 1, high[0]),
    y1 = Math.min(dims[1] - 1, high[1]),
    z1 = Math.min(dims[2] - 1, high[2]);
  let added = 0;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++) {
      const row = dims[0] * (y + dims[1] * z);
      for (let x = x0; x <= x1; x++) {
        added += 1 - map[row + x];
        map[row + x] = 1;
      }
    }
  return added;
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

/** The cells, relative to `origin`, that box `at` of `boxes` (six bounds each) covers. */
function cellsOf(
  boxes: ArrayLike<number>,
  at: number,
  spacing: number,
  origin: number[],
  low: number[],
  high: number[],
) {
  for (let axis = 0; axis < 3; axis++) {
    low[axis] = Math.floor(boxes[at + axis] / spacing) - origin[axis];
    high[axis] = Math.floor(boxes[at + 3 + axis] / spacing) - origin[axis];
  }
}

/** Every level's map from triangle boxes (six bounds each) over an extent, on the current plan. */
function build(cascades: BounceCascades, extent: readonly number[], boxes: ArrayLike<number>) {
  const spacing = cascades.levels[0].spacing;
  // Origin and dimensions are aligned to the largest reduction: otherwise a coarse level cell
  // would not equal the exact eight-block of the previous level, lying by one cell out of two.
  const align = 2 ** (cascades.levels.length - 1);
  const floorTo = (value: number) => Math.floor(value / align) * align;
  // The margin is one coarsest cell at least, so that each level keeps the boundary cell its
  // dilation gives the extent's faces: a narrower one cut it on the coarse levels.
  const origin = [0, 1, 2].map((axis) =>
    floorTo(Math.floor(extent[axis] / spacing) - Math.max(2, align)),
  );
  const dims = [0, 1, 2].map((axis) =>
    Math.max(
      align,
      floorTo(Math.floor(extent[3 + axis] / spacing) + Math.max(3, align) - origin[axis]) + align,
    ),
  );
  const first = new Uint8Array(dims[0] * dims[1] * dims[2]);
  const low = [0, 0, 0],
    high = [0, 0, 0];
  for (let at = 0; at + 6 <= boxes.length; at += 6) {
    cellsOf(boxes, at, spacing, origin, low, high);
    mark(first, dims, low, high);
  }
  const maps: LevelMap[] = [{ map: dilate(first, dims), dims, origin }];
  for (let level = 1; level < cascades.levels.length; level++) {
    const reduced = reduce(maps[level - 1].map, maps[level - 1].dims);
    maps.push({
      map: dilate(reduced.map, reduced.dims),
      dims: reduced.dims,
      origin: maps[level - 1].origin.map((value) => value / 2),
    });
  }
  return { maps, spacing, marked: maps[0].map.reduce((sum, value) => sum + value, 0) };
}

/** Marks which probe cells hold geometry, so empty space gets no probe. */
export function createBounceOccupancy(
  proxy: SceneProxy,
  cascades: BounceCascades,
): BounceOccupancy {
  // Motion never switches the map off for good. While owners move, the cells their triangles now
  // cover join the map at once (old cells stay: conservative, never dark); a lattice the map no
  // longer matches schedules every cell. The first frame without motion rebuilds the exact map
  // from the current poses; its cells per axis are bounded by the cascade plan, whatever the extent.
  let state = build(cascades, proxy.bounds, proxyTriangleBoxes(proxy.data.triangles));
  /** Every cell eligible until the next rebuild: the lattice or the extent outgrew the map. */
  let all = false;
  /** Settles left before the rebuild: a frame that moved skips one, the next still one rebuilds. */
  let quiet = 0;
  const low = [0, 0, 0],
    high = [0, 0, 0];
  const covers = () =>
    cascades.levels[0].spacing === state.spacing && cascades.levels.length === state.maps.length;
  /** Adds one box and the boundary each level's reduction and dilation would give it. */
  const add = (boxes: ArrayLike<number>, at: number) => {
    const { maps, spacing } = state;
    cellsOf(boxes, at, spacing, maps[0].origin, low, high);
    for (let axis = 0; axis < 3; axis++)
      if (low[axis] < 0 || high[axis] >= maps[0].dims[axis]) return false;
    for (let level = 0; level < maps.length; level++) {
      for (let axis = 0; axis < 3; axis++) {
        low[axis] = (level ? low[axis] >> 1 : low[axis]) - 1;
        high[axis] = (level ? high[axis] >> 1 : high[axis]) + 1;
      }
      const added = mark(maps[level].map, maps[level].dims, low, high);
      if (level === 0) state.marked += added;
    }
    return true;
  };
  return {
    moved(boxes, changed) {
      quiet = 2;
      all ||= !covers();
      for (let t = 0; !all && t < changed.length; t++) if (changed[t]) all = !add(boxes, t * 6);
    },
    settle(boxes, extent) {
      if (!quiet || --quiet) return;
      state = build(cascades, extent, boxes);
      all = false;
    },
    get cells() {
      return state.maps[0].map.length;
    },
    get bytes() {
      return state.maps.reduce((sum, entry) => sum + entry.map.length, 0);
    },
    get marked() {
      return state.marked;
    },
    // Called once per examined probe each frame: nothing allocated or traversed.
    occupied(level, x, y, z) {
      if (all) return true;
      const entry = state.maps[Math.min(level, state.maps.length - 1)];
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
