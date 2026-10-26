/**
 * HOW FAR A PARTITIONED SCENE'S VIEW READS ITS CELLS, AND IN WHICH FRAME: the farthest a placed
 * cell's content lies from the eye (`placedReach`) — what the walk of the cell index reads within
 * (`plan.ts`, `cellIndex.ts`) and the rows are sized by (`sizing.ts`) —, the sphere past which a
 * page of the index is closed (`keepRadius`), and the eye, reach and view axis in the scene root's
 * frame, the one the cells' boxes are written in (`inCellFrame`), and how far the eye lies from the
 * boxes the walk reads (`boxDistance`).
 */
import { boxGroundDistance } from '../../../../math/src/geometry/boxDistance.ts'
import { BOX_VALUES } from '../../../../math/src/geometry/box.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import {
  keepNumbers,
  transformAffinePoint,
  transformDirectionRow,
  transformDirectionVector3,
} from '../../../../math/src/vector/vector.ts'
import type { PartitionGrid } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import { stretchOf } from './boxes.ts'
import type { CoarserPull } from './coarser.ts'
import type { StreamingSource } from './source.ts'

/** 2D distance from `eye` to the nearest box `[minX, minY, minZ, maxX, maxY, maxZ]` of `bounds`,
 *  six values each, the up axis dropped as a 2D grid drops it; 0 over one. */
export function boxDistance(bounds: ArrayLike<number>, eye: ArrayLike<number>) {
  let nearest = Infinity
  for (let at = 0; at < bounds.length; at += BOX_VALUES) {
    nearest = Math.min(nearest, boxGroundDistance(bounds, at, eye[0], eye[2]))
  }
  return nearest
}

/** The root's world the inverse and least stretch were last made from: made again only once it
 *  moved. */
const inverse = new Float64Array(MATRIX_VALUES),
  inverted = new Float64Array(MATRIX_VALUES).fill(NaN)
let least = 0
/** How far past the walk's radius, as a fraction of it, a page of the index is kept open. */
const KEEP = 0.5
/** The keep sphere's radius for a walk of `reach`: an index page past it with no cell placed is
 *  closed. */
export const keepRadius = (reach: number) => reach * (1 + KEEP)

/** The farthest a placed cell's content lies from the eye, from the `grids` its cell files stream
 *  on (`PartitionGrid.files`) — the main grid, and each grid an HLOD 0 cell lies on: an instanced
 *  layer's whatever its HLOD level, that of a layer taking objects and the parent of another's
 *  too — and the view's `source`: a cell is wished within its shape's radius, and its content
 *  lies within its finest cell's diagonal of the bounds it streams by, or of a coarser cell a
 *  wished one pulls in on a grid whose `pulls` say so (`CoarserPull.reach`). */
export function placedReach(
  grids: readonly PartitionGrid[],
  source: StreamingSource,
  pulls: readonly (CoarserPull | null)[] = [],
) {
  let reach = 0
  grids.forEach(({ cell, range, files }, at) => {
    const pulled = pulls[at]?.reach ?? 0
    if (files) reach = Math.max(reach, source.radius(range) + cell * Math.SQRT2 + pulled)
  })
  return reach
}

/** The least stretch of the root's world `world`, its inverse and stretch made again only once it
 *  moved: 0 for a flattened root. */
function stretchAt(world: ArrayLike<number>) {
  if (!keepNumbers(inverted, world)) least = stretchOf(world, invertMatrix4(inverse, world))[0]
  return least
}

/** The unit direction `dir`, a direction of the root's world `world`, as it points in the frame the
 *  cells' boxes are written in, into `out`: normalised, what the inverse stretched; zero for a
 *  flattened root. */
export function directionInCellFrame(
  world: ArrayLike<number>,
  dir: ArrayLike<number>,
  out = [0, 0, 0],
) {
  if (!stretchAt(world)) return out.fill(0)
  return transformDirectionVector3(out, inverse, dir[0], dir[1], dir[2])
}

/** The vector `vector` — a velocity — of the root's world `world` as it is in the frame the cells'
 *  boxes are written in, into `out`: its length stretched as the root stretches it, not
 *  normalised; zero for a flattened root. */
export function vectorInCellFrame(
  world: ArrayLike<number>,
  vector: ArrayLike<number>,
  out = [0, 0, 0],
) {
  if (!stretchAt(world)) return out.fill(0)
  for (let row = 0; row < 3; row++)
    out[row] = transformDirectionRow(inverse, row, vector[0], vector[1], vector[2])
  return out
}

/**
 * `eye`, `reach` and the unit view `axis` in the frame the cells' boxes are written in — the scene
 * root's, whose world matrix `world` a world may pose, turn, scale and shear. A world distance is
 * at least the root's least stretch (`stretchOf`: its smallest singular value, not its shortest
 * column, which a shear lengthens) times the distance there: what this reach reads holds every
 * cell the world's reach needs; a flattened root, which stretches some distance by 0, reads every
 * cell. The inverse and the stretch are kept while the root's world stands.
 */
export function inCellFrame(
  world: ArrayLike<number>,
  eye: ArrayLike<number>,
  reach: number,
  axis: ArrayLike<number> = [0, 0, 0],
) {
  // Flattened: no eye there, every cell.
  if (!stretchAt(world)) return { eye: [0, 0, 0], reach: Infinity, axis: [0, 0, 0] }
  const local = transformAffinePoint([0, 0, 0], inverse, eye[0], eye[1], eye[2])
  const along = transformDirectionVector3([0, 0, 0], inverse, axis[0], axis[1], axis[2])
  return { eye: local, reach: reach / least, axis: along }
}
