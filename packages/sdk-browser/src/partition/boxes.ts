/**
 * Where the cells of a partitioned scene are now. A cell carries the box around its nodes
 * in the frame of each core parent it hangs them under (`TableCell.parents`); a page may move that
 * parent (`getObjectByName`), and the rows follow it (`cells.ts`). The plan reads each cell's boxes
 * in the scene root's frame, one per parent, rewritten once a parent moved relative to the root,
 * so a cell is read where its objects stand, not where the file declared them. A page of the cell
 * index is boxed at the declared poses, in the root's frame: what it holds now lies within
 * that box and the box carried by each parent its cells hang under moved since the declaration
 * (`around`). How far each parent stretches the root's frame (`stretch`) is what the rows are sized
 * by (`sizing.ts`).
 */
import {
  boxTransform,
  determinantMatrix4,
  invertMatrix4,
  MATRIX_VALUES,
  maxStretch,
  multiplyMatrix4,
} from '../../../sdk-core/src/index.ts'
import { boxUnion } from '../../../math/src/geometry/box.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { keepNumbers } from '../../../math/src/vector/vector.ts'
import { sameMatrixBits } from '../../../math/src/matrix/matrixElements.ts'
import { resolveCameraWorld } from '../camera/world.ts'

const rootInverse = new Float64Array(MATRIX_VALUES),
  relative = new Float64Array(MATRIX_VALUES),
  inverse = new Float64Array(MATRIX_VALUES),
  carried = new Float64Array(6)
/** A box holding all space: a page under a parent moved off a flat declared frame. */
const UNBOUNDED = [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity]

/** How far a frame stretches a distance of the root's: at least, at most. */
export type Stretch = readonly [least: number, most: number]

/** Whether `matrix` is flattened, or so nearly flat that `back`, its inverse (`invertMatrix4`),
 *  overflows. */
const flatFrame = (matrix: ArrayLike<number>, back: Float64Array) =>
  determinantMatrix4(matrix) === 0 || !back.every(Number.isFinite)

/** The least `matrix` stretches a distance, its smallest singular value `1 / σmax(M⁻¹)`, read from
 *  `back`, its inverse; a flat frame (`flatFrame`) stretches it by 0. Never its shortest column,
 *  which a shear leaves long. */
export const leastStretchOf = (matrix: ArrayLike<number>, back: Float64Array) =>
  flatFrame(matrix, back) ? 0 : 1 / maxStretch(back)

/** The least and the most `matrix` stretches a distance — its smallest and largest singular
 *  values (`leastStretchOf`, `maxStretch`). */
export function stretchOf(matrix: ArrayLike<number>): Stretch {
  const most = maxStretch(matrix)
  return [leastStretchOf(matrix, invertMatrix4(inverse, matrix)), most]
}

/** What carries boxes — a cell —: its `[core rank, box]` per parent, its boxes in the root's frame
 *  when last written, and at which `refresh`. */
export type Boxed = { parents: Parts; bounds: Float64Array; written: number }
/** `[core rank, box]` per parent: the box in that parent's frame (`TableCell.parents`). */
export type Parts = readonly (readonly [number | null, ArrayLike<number>])[]
/** A `Boxed` over `parents`, never written. */
export const boxed = (parents: Parts): Boxed => ({
  parents,
  bounds: new Float64Array(6 * parents.length),
  written: -1,
})
/** A page of the cell index as it is boxed: at the declared poses, the core ranks its cells hang
 *  under, and now, written at a `refresh`. */
export type Declared = {
  declared: ArrayLike<number>
  parents: readonly number[]
  box: Float64Array
  written: number
}

const relativeInto = (out: Float64Array, parent: Object3D) =>
  multiplyMatrix4(out, rootInverse, resolveCameraWorld(parent).worldMatrix)

/**
 * The frames of the core parents of ranks `ranks` relative to `root`, the node their scene hangs
 * on; `parents[rank]` is the host node of each core rank, standing where the file declares it when
 * this is called. `refresh` reads the frames again. `bounds` gives the boxes of a `Boxed` in the
 * root's frame, six values per parent, in the order of its `parents`, written again only when one
 * of those parents moved since, so a frame pays for the boxes it reads, never for every cell a
 * moved parent carries; `around`, the box of a page of the index where its parents stand;
 * `stretch`, per core rank, how far that parent's frame stretches the root's at the last `refresh`.
 */
export function createCellBoxes(
  ranks: Iterable<number>,
  root: Object3D,
  parents: readonly Object3D[],
) {
  /** `back`: the declared frame's inverse, `null` when it is flat (a parent declared at scale 0):
   *  nothing then carries the declared boxes to where that parent's cells stand. */
  type Frame = {
    matrix: Float64Array
    declared: Float64Array
    back: Float64Array | null
    moved: number
  }
  const frames = new Map<number, Frame>()
  const stretch = new Map<number, Stretch>()
  /** Each parent moved since the declaration: what carries its declared frame to where it is,
   *  `null` when its declared frame is flat and its cells may stand anywhere. */
  const displaced = new Map<number, Float64Array | null>()
  invertMatrix4(rootInverse, resolveCameraWorld(root).worldMatrix)
  for (const rank of ranks) {
    const declared = relativeInto(new Float64Array(MATRIX_VALUES), parents[rank])
    const back = invertMatrix4(new Float64Array(MATRIX_VALUES), declared)
    const flat = flatFrame(declared, back)
    frames.set(rank, { matrix: declared.slice(), declared, back: flat ? null : back, moved: 0 })
    stretch.set(rank, [leastStretchOf(declared, back), maxStretch(declared)])
  }
  let now = 0
  const refresh = () => {
    now++
    if (frames.size) invertMatrix4(rootInverse, resolveCameraWorld(root).worldMatrix)
    for (const [rank, frame] of frames) {
      if (keepNumbers(frame.matrix, relativeInto(relative, parents[rank]))) continue
      frame.moved = now
      stretch.set(rank, stretchOf(relative))
      if (sameMatrixBits(frame.declared, relative)) displaced.delete(rank)
      else if (!frame.back) displaced.set(rank, null)
      else {
        const carry = displaced.get(rank) ?? new Float64Array(MATRIX_VALUES)
        displaced.set(rank, multiplyMatrix4(carry, relative, frame.back))
      }
    }
  }
  /** Whether the core parent `rank` (none: the scene root) moved since the refresh `since`. */
  const moved = (rank: number | null, since: number) =>
    rank !== null && (frames.get(rank)?.moved ?? 0) > since
  const bounds = (item: Boxed) => {
    if (item.written >= 0 && !item.parents.some(([rank]) => moved(rank, item.written)))
      return item.bounds
    item.parents.forEach(([rank, box], part) => {
      if (rank === null) item.bounds.set(box, 6 * part)
      else boxTransform(item.bounds, 6 * part, box, 0, frames.get(rank)!.matrix)
    })
    item.written = now
    return item.bounds
  }
  const around = (page: Declared) => {
    const since = page.written
    if (since >= 0 && !page.parents.some((rank) => moved(rank, since))) return page.box
    page.box.set(page.declared)
    for (const rank of page.parents) {
      if (!displaced.has(rank)) continue
      const carry = displaced.get(rank)
      if (!carry) {
        page.box.set(UNBOUNDED)
        break
      }
      boxTransform(carried, 0, page.declared, 0, carry)
      boxUnion(page.box, 0, carried[0], carried[1], carried[2], carried[3], carried[4], carried[5])
    }
    page.written = now
    return page.box
  }
  return { refresh, bounds, around, stretch: stretch as ReadonlyMap<number, Stretch> }
}

export type CellBoxes = ReturnType<typeof createCellBoxes>
