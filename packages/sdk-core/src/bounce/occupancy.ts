import type { SceneProxy } from '../contracts/proxy.ts'
import { proxyTriangleBoxes } from '../scene/core/proxyBoxes.ts'
import type { BounceCascades } from './cascades.ts'
import { cellsOf, dilate, mark, reduce, repeats } from './occupancyCells.ts'
import { alignDown } from '../../../math/src/scalar/integers.ts'

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
  moved(boxes: ArrayLike<number>, changed: ArrayLike<number>): void
  /** Once per frame: the first frame after motion stopped rebuilds the exact map on `extent`. */
  settle(boxes: ArrayLike<number>, extent: readonly number[]): void
  /** True when a level's cell in its global lattice warrants a probe. */
  occupied(level: number, x: number, y: number, z: number): boolean
  /** Marked cells and total cells of the finest level: published gain. */
  readonly marked: number
  /** Cells of the finest level. */
  readonly cells: number
  /** Bytes it takes. */
  readonly bytes: number
}

type LevelMap = { map: Uint8Array; dims: number[]; origin: number[] }

/** Every level's map from triangle boxes (six bounds each) over an extent, on the current plan. */
function build(cascades: BounceCascades, extent: readonly number[], boxes: ArrayLike<number>) {
  const spacing = cascades.levels[0].spacing
  // Origin and dimensions are aligned to the largest reduction: otherwise a coarse level cell
  // would not equal the exact eight-block of the previous level, lying by one cell out of two.
  const align = 2 ** (cascades.levels.length - 1)
  const floorTo = (value: number) => alignDown(value, align)
  // A margin of one coarsest cell at least keeps the boundary cell each level's dilation gives the
  // extent's faces: a narrower one cut it on the coarse levels.
  const below = Math.max(2, align),
    above = Math.max(3, align)
  const origin = [0, 1, 2].map((axis) => floorTo(Math.floor(extent[axis] / spacing) - below))
  const dims = [0, 1, 2].map((axis) =>
    Math.max(align, floorTo(Math.floor(extent[3 + axis] / spacing) + above - origin[axis]) + align),
  )
  const first = new Uint8Array(dims[0] * dims[1] * dims[2])
  const low = [0, 0, 0],
    high = [0, 0, 0],
    last = [NaN, NaN, NaN, NaN, NaN, NaN]
  for (let at = 0; at + 6 <= boxes.length; at += 6) {
    cellsOf(boxes, at, spacing, origin, low, high)
    if (!repeats(low, high, last)) mark(first, dims, low, high)
  }
  const maps: LevelMap[] = [{ map: dilate(first, dims), dims, origin }]
  for (let level = 1; level < cascades.levels.length; level++) {
    const reduced = reduce(maps[level - 1].map, maps[level - 1].dims)
    maps.push({
      map: dilate(reduced.map, reduced.dims),
      dims: reduced.dims,
      origin: maps[level - 1].origin.map((value) => value / 2),
    })
  }
  let marked = 0
  for (let cell = 0; cell < maps[0].map.length; cell++) marked += maps[0].map[cell]
  return { maps, spacing, marked }
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
  let state = build(cascades, proxy.bounds, proxyTriangleBoxes(proxy.data.triangles))
  /** Every cell eligible until the next rebuild: the lattice or the extent outgrew the map. */
  let all = false
  /** Settles left before the rebuild: a frame that moved skips one, the next still one rebuilds. */
  let quiet = 0
  const low = [0, 0, 0],
    high = [0, 0, 0],
    last = [NaN, NaN, NaN, NaN, NaN, NaN]
  const covers = () =>
    cascades.levels[0].spacing === state.spacing && cascades.levels.length === state.maps.length
  /** Adds one box and the boundary each level's reduction and dilation would give it. */
  const add = (boxes: ArrayLike<number>, at: number) => {
    const { maps, spacing } = state
    cellsOf(boxes, at, spacing, maps[0].origin, low, high)
    if (repeats(low, high, last)) return true
    for (let axis = 0; axis < 3; axis++)
      if (low[axis] < 0 || high[axis] >= maps[0].dims[axis]) return false
    for (let level = 0; level < maps.length; level++) {
      for (let axis = 0; axis < 3; axis++) {
        low[axis] = (level ? low[axis] >> 1 : low[axis]) - 1
        high[axis] = (level ? high[axis] >> 1 : high[axis]) + 1
      }
      const added = mark(maps[level].map, maps[level].dims, low, high)
      if (level === 0) state.marked += added
    }
    return true
  }
  return {
    moved(boxes, changed) {
      quiet = 2
      all ||= !covers()
      last.fill(NaN)
      for (let t = 0; !all && t < changed.length; t++) if (changed[t]) all = !add(boxes, t * 6)
    },
    settle(boxes, extent) {
      if (!quiet || --quiet) return
      state = build(cascades, extent, boxes)
      all = false
    },
    get cells() {
      return state.maps[0].map.length
    },
    get bytes() {
      return state.maps.reduce((sum, entry) => sum + entry.map.length, 0)
    },
    get marked() {
      return state.marked
    },
    // Called once per examined probe each frame: nothing allocated or traversed.
    occupied(level, x, y, z) {
      if (all) return true
      const entry = state.maps[Math.min(level, state.maps.length - 1)]
      const [width, height, depth] = entry.dims
      const localX = x - entry.origin[0],
        localY = y - entry.origin[1],
        localZ = z - entry.origin[2]
      if (localX < 0 || localY < 0 || localZ < 0) return false
      if (localX >= width || localY >= height || localZ >= depth) return false
      return entry.map[localX + width * (localY + height * localZ)] === 1
    },
  }
}
