/**
 * WHICH CELLS OF A PARTITIONED SCENE ARE READ, derived from the camera, never from the scene.
 *
 * A cell is read while the camera can draw any of it: until its box is past the frustum's farthest
 * corner — for a perspective camera `far·√(1 + tan²θ)`, `θ` the half diagonal of the field its
 * zoom narrows or widens (`perspectiveSlope`), the same off-axis majorant the certified cluster
 * error takes (`screenErrorBound.ts`); for an orthographic one the far corner of its zoomed box
 * (`orthographicView`). Nothing coarser stands for a cell that is not read (it has no merged
 * proxy), so its objects are drawn wherever the far plane lets them be, however small they
 * project: dropping one below the error target would leave it out of the image for good, not
 * replace it by a coarser one.
 *
 * A frame asks for the cells within the reach first, then — at the prefetch priority — those
 * within `AHEAD` of it past it, and a read cell leaves once its box is `KEEP` of the reach past it,
 * so one that hovers on a border is not read again at every step. Both margins are fractions of
 * the reach, never of the cell: a cell the compiler cut wider than the view (its split counts
 * bytes, not metres) is kept only while its box meets that sphere. The pages of the cell index
 * are read and kept by the same spheres (`cellIndex.ts`).
 *
 * The rows are sized when the session opens for every node that keep sphere can hold, wherever
 * the page moves the cells' parents (`sizing.ts`).
 */
import { invertMatrix4, MATRIX_VALUES, transformAffinePoint } from '../../../sdk-core/src/index.ts'
import { boxPointDistance } from '../../../sdk-core/src/math/primitives/box.ts'
import { drawnView, perspectiveSlope } from '../../../sdk-core/src/math/primitives/camera.ts'
import type { CameraOptics } from '../camera/engineCamera.ts'
import { stretchOf } from './boxes.ts'
import type { CellIndex, IndexPage } from './cellIndex.ts'
import { hypot3 } from '../../../sdk-core/src/math/primitives/hypot.ts'
import { AHEAD } from './aheadShare.ts'
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from '../streaming/priority.ts'

const inverse = new Float64Array(MATRIX_VALUES),
  view = new Float64Array(4)
/** How far past the reach, as a fraction of it, a read cell is kept: past `AHEAD`, so a cell read
 *  ahead is not dropped by the next step. */
export const KEEP = 0.5

/** What the reach reads of a camera: the optics its projection is composed from. */
export type PartitionOptics = Pick<
  CameraOptics,
  'fov' | 'aspect' | 'near' | 'far' | 'zoom' | 'orthographic'
>

/** The distance past which nothing `optics` sees is drawn: the frustum's farthest corner. */
export function cellReach(optics: PartitionOptics) {
  const { far, orthographic } = optics,
    zoom = optics.zoom || 1 // a zoom of 0 draws nothing: read as 1, never as an empty reach
  if (orthographic) {
    const [x, y, width, height] = drawnView(orthographic, optics.aspect, zoom, view)
    // Its depth range may reach behind the eye: a negative `near` draws there. A box given right
    // to left, or top to bottom, is as wide.
    const depth = Math.max(Math.abs(far), Math.abs(optics.near))
    return hypot3(depth, Math.abs(x) + Math.abs(width), Math.abs(y) + Math.abs(height))
  }
  const slope = perspectiveSlope(optics.fov, zoom)
  return far * Math.sqrt(1 + slope * slope * (1 + optics.aspect * optics.aspect))
}

/**
 * `eye` and `reach` in the frame the cells' boxes are written in — the scene root's, whose world
 * matrix `world` a world may pose, turn, scale and shear. A world distance is at least the root's
 * least stretch (`stretchOf`: its smallest singular value, not its shortest column, which a shear
 * lengthens) times the distance there: what this reach reads holds every cell the world's reach
 * needs; a flattened root, which stretches some distance by 0, reads every cell.
 */
export function inCellFrame(world: ArrayLike<number>, eye: ArrayLike<number>, reach: number) {
  const [least] = stretchOf(world)
  if (!least) return { eye: [0, 0, 0], reach: Infinity } // flattened: no eye there, every cell
  invertMatrix4(inverse, world)
  const local = transformAffinePoint([0, 0, 0], inverse, eye[0], eye[1], eye[2])
  return { eye: local, reach: reach / least }
}

/** Distance from `eye` to the nearest box `[minX, minY, minZ, maxX, maxY, maxZ]` of `bounds`,
 *  six values each; 0 inside one. */
export function boxDistance(bounds: ArrayLike<number>, eye: ArrayLike<number>) {
  let nearest = Infinity
  for (let at = 0; at < bounds.length; at += 6)
    nearest = Math.min(nearest, boxPointDistance(bounds, at, eye[0], eye[1], eye[2]))
  return nearest
}

/** The read priority of what `cell` holds, seen from `local` (`cellPages.ts`): strictly after the
 *  view's own pages, read at the band's own value, in the visible priority's band — the prefetch
 *  one's when `ahead`, by default past the reach —, nearer first within each. */
export function holdPriority(
  index: Pick<CellIndex, 'distance'>,
  local: { eye: ArrayLike<number>; reach: number },
  cell: number,
  ahead?: boolean,
) {
  const distance = index.distance(cell, local.eye)
  const band = (ahead ?? distance > local.reach) ? PRIORITY_PREFETCH : PRIORITY_VISIBLE
  return band + (1 + (distance / (distance + local.reach) || 0)) / 2
}

/**
 * How a plan reads the world super-roots: the cells whose objects are placed, and the error
 * the cut projects for a cell's super-roots (`cellSuperRootError`) against its pixel target. A
 * cell is then held one of two ways — placed, its objects read and drawn, or drawn by its
 * super-roots alone, its world bundles held and its object pages unread.
 */
export type SuperRootPlan = {
  placed: { has(cell: number): boolean }
  target: number
  projected(cell: number): number
}

/**
 * The cells `held` does not hold that a frame needs — `visible`, within `reach` — and those it
 * reads ahead — `ahead`, within `reach·(1 + AHEAD)` —, each nearest first, found through the cell
 * index (`cellIndex.ts`); the held cells past `reach·(1 + KEEP)`, which leave; and the pages of the
 * index within those spheres not yet opened (`pages`), nearest first, the index closing those past
 * the keep sphere. `reach` is the frame camera's (`cellReach`).
 *
 * Given `superRoots`, `held` holds both kinds of cell and the near/far choice is the cut's: a cell
 * found is `far` — held, drawn by its super-roots, its objects unread — until its super-roots'
 * error projects past the target, when its objects are `visible` (within the reach) or `ahead`
 * (past `target/(1 + AHEAD)`); a placed cell is `demoted` to its super-roots once that error is
 * within `target/(1 + KEEP)`, so one hovering on the border is not read again at every step, as
 * World Partition's loading range keeps a cell's actors until past its own margin.
 */
export function planCells(
  index: Pick<CellIndex, 'near' | 'distance'>,
  eye: ArrayLike<number>,
  reach: number,
  held: { has(cell: number): boolean; keys(): Iterable<number> },
  superRoots?: SuperRootPlan,
) {
  type Found<T> = { item: T; distance: number }
  const cells: Found<number>[] = [],
    far: Found<number>[] = [],
    pages: Found<IndexPage>[] = []
  const keep = reach * (1 + KEEP)
  const placed = superRoots?.placed ?? held
  /** `cell`'s super-roots' projected error over the target: the cut needs its objects past 1, and
   *  without super-roots always. */
  const need = (cell: number) =>
    superRoots ? superRoots.projected(cell) / superRoots.target : Infinity
  index.near(
    eye,
    reach * (1 + AHEAD),
    keep,
    held,
    (item, distance) => {
      if (placed.has(item)) return
      if (superRoots && !held.has(item)) far.push({ item, distance })
      // Past the reach, or its objects wanted only within the prefetch margin: read ahead.
      const ratio = need(item)
      if (distance <= reach && ratio > 1) cells.push({ item, distance })
      else if (ratio * (1 + AHEAD) > 1) cells.push({ item, distance: reach + distance })
    },
    (item, distance) => void pages.push({ item, distance }),
  )
  const leave: number[] = [],
    demoted: number[] = []
  for (const cell of held.keys())
    if (index.distance(cell, eye) > keep) leave.push(cell)
    else if (superRoots && placed.has(cell) && need(cell) * (1 + KEEP) <= 1) demoted.push(cell)
  /** The items of `list` within the reach, or past it when `past`, nearest first. */
  const nearest = <T>(list: Found<T>[], past: boolean) =>
    list
      .filter(({ distance }) => distance > reach === past)
      .sort((a, b) => a.distance - b.distance)
      .map(({ item }) => item)
  return {
    visible: nearest(cells, false),
    ahead: nearest(cells, true),
    leave,
    far: far.sort((a, b) => a.distance - b.distance).map(({ item }) => item),
    demoted,
    pages: { visible: nearest(pages, false), ahead: nearest(pages, true) },
  }
}
