/**
 * Where the cells of a partitioned scene are now. A cell hangs its nodes under core parents
 * (`TableCell.parents`); a page may move a parent (`getObjectByName`), and the rows follow it
 * (`cells.ts`). A page of the cell index, and the bounds a cell streams by, are boxed at the
 * declared poses, in the root's frame: what they hold now lies within that box and the box carried
 * by each parent its cells hang under moved since the declaration (`around`), so a cell is read
 * where its objects stand, not only where the file declared them. How far each parent stretches
 * the root's frame (`stretch`) is what the rows are sized by (`sizing.ts`).
 */
import {
  BOX_VALUES,
  boxEmpty,
  boxTransform,
  boxUnionBox,
} from '../../../../math/src/geometry/box.ts'
import { determinantMatrix4, multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { maxStretch } from '../../../../math/src/projection/projectionOracles.ts'

import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { keepNumbers } from '../../../../math/src/vector/vector.ts'
import { sameMatrixBits } from '../../../../math/src/matrix/matrixElements.ts'
import { resolveCameraWorld } from '../../camera/world.ts'

const rootInverse = new Float64Array(MATRIX_VALUES),
  relative = new Float64Array(MATRIX_VALUES),
  inverse = new Float64Array(MATRIX_VALUES),
  carried = new Float64Array(BOX_VALUES)
/** A box holding all space: a page under a parent moved off a flat declared frame. */
const UNBOUNDED = [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity]

/** How far a frame stretches a distance of the root's: at least, at most. */
export type Stretch = readonly [least: number, most: number]

/** Whether `matrix` is flattened, or so nearly flat that `back`, its inverse (`invertMatrix4`),
 *  overflows. */
const flatFrame = (matrix: ArrayLike<number>, back: Float64Array) =>
  determinantMatrix4(matrix) === 0 || !back.every(Number.isFinite)

/** The least and the most `matrix` stretches a distance — its smallest singular value
 *  `1 / σmax(M⁻¹)`, read from `back`, its inverse (`invertMatrix4`), and its largest
 *  (`maxStretch`). A flat frame (`flatFrame`) stretches some distance by 0. Never its shortest
 *  column, which a shear leaves long. */
export function stretchOf(matrix: ArrayLike<number>, back: Float64Array): Stretch {
  return [flatFrame(matrix, back) ? 0 : 1 / maxStretch(back), maxStretch(matrix)]
}

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

/** A core parent's frame: where it stands (`matrix`), where the file declared it, `back`, the
 *  declared frame's inverse — `null` when it is flat (a parent declared at scale 0): nothing then
 *  carries the declared boxes to where that parent's cells stand —, and the refresh it moved at. */
type Frame = {
  matrix: Float64Array
  declared: Float64Array
  back: Float64Array | null
  moved: number
}

/** Each parent moved since the declaration: what carries its declared frame to where it is,
 *  `null` when its declared frame is flat and its cells may stand anywhere. */
type Displaced = Map<number, Float64Array | null>

/** Core parent `rank`, its `frame` found moved at the refresh `now` to `relative` (`relativeInto`):
 *  stamped, its stretch and what carries its declared frame to where it stands made again. */
function moveFrame(moved: {
  rank: number
  frame: Frame
  now: number
  stretch: Map<number, Stretch>
  displaced: Displaced
}) {
  const { rank, frame, now, stretch, displaced } = moved
  frame.moved = now
  stretch.set(rank, stretchOf(relative, invertMatrix4(inverse, relative)))
  if (sameMatrixBits(frame.declared, relative)) displaced.delete(rank)
  else if (!frame.back) displaced.set(rank, null)
  else {
    const carry = displaced.get(rank) ?? new Float64Array(MATRIX_VALUES)
    displaced.set(rank, multiplyMatrix4(carry, relative, frame.back))
  }
}

/** What the boxes keep: the parents' frames, how far they stretch, and which have moved. */
interface Boxes {
  root: Object3D
  parents: readonly Object3D[]
  frames: Map<number, Frame>
  stretch: Map<number, Stretch>
  displaced: Displaced
  now: number
  moves: number
}

/** The frames of the core parents of ranks `ranks`, as the file declares them. */
function declareFrames(b: Boxes, ranks: Iterable<number>) {
  invertMatrix4(rootInverse, resolveCameraWorld(b.root).worldMatrix)
  for (const rank of ranks) {
    const declared = relativeInto(new Float64Array(MATRIX_VALUES), b.parents[rank])
    const back = invertMatrix4(new Float64Array(MATRIX_VALUES), declared)
    const flat = flatFrame(declared, back)
    b.frames.set(rank, { matrix: declared.slice(), declared, back: flat ? null : back, moved: 0 })
    b.stretch.set(rank, stretchOf(declared, back))
  }
}

const refreshBoxes = (b: Boxes) => {
  b.now++
  if (b.frames.size) invertMatrix4(rootInverse, resolveCameraWorld(b.root).worldMatrix)
  for (const [rank, frame] of b.frames) {
    if (keepNumbers(frame.matrix, relativeInto(relative, b.parents[rank]))) continue
    b.moves++
    moveFrame({ rank, frame, now: b.now, stretch: b.stretch, displaced: b.displaced })
  }
}

/** Whether the core parent `rank` (none: the scene root) moved since the refresh `since`. */
const moved = (b: Boxes, rank: number, since: number) => (b.frames.get(rank)?.moved ?? 0) > since

const boxAround = (b: Boxes, page: Declared) => {
  const since = page.written
  if (since >= 0 && !page.parents.some((rank) => moved(b, rank, since))) return page.box
  page.box.set(page.declared)
  for (const rank of page.parents) {
    if (!b.displaced.has(rank)) continue
    const carry = b.displaced.get(rank)
    if (!carry) {
      page.box.set(UNBOUNDED)
      break
    }
    boxTransform(carried, 0, page.declared, 0, carry)
    boxUnionBox(page.box, 0, carried)
  }
  page.written = b.now
  return page.box
}

/** The box around what `held` holds — per parent its core rank (`null`: the scene root) and the
 *  box around its nodes in its frame (`TableCell.parents`) — at the declared poses, in the
 *  root's frame: each box carried by its parent's declared frame, the boxes joined. */
const unionDeclared = (
  b: Boxes,
  held: readonly (readonly [number | null, ArrayLike<number>])[],
) => {
  const out = new Float64Array(BOX_VALUES)
  boxEmpty(out, 0)
  for (const [rank, box] of held) {
    const frame = rank === null ? undefined : b.frames.get(rank)
    if (frame) boxTransform(carried, 0, box, 0, frame.declared)
    else carried.set(box)
    boxUnionBox(out, 0, carried)
  }
  return out
}

/**
 * The frames of the core parents of ranks `ranks` relative to `root`, the node their scene hangs
 * on; `parents[rank]` is the host node of each core rank, standing where the file declares it when
 * this is called. `refresh` reads the frames again. `around` gives the box of a page of the index,
 * or of the bounds a cell streams by, where its parents stand, written again only when one of
 * those parents moved since, so a frame pays for the boxes it reads, never for every cell a moved
 * parent carries; `declaredUnion`, a cell's content boxed at the declared poses from its parents'
 * boxes; `stretch`, per core rank, how far that parent's frame stretches the root's at the last
 * `refresh`; `moves`, how many refreshes found a parent's frame moved: what a plan made before
 * is stale by (`streamingUpdate.ts`).
 */
export function createCellBoxes(
  ranks: Iterable<number>,
  root: Object3D,
  parents: readonly Object3D[],
) {
  const b: Boxes = {
    root,
    parents,
    frames: new Map<number, Frame>(),
    stretch: new Map<number, Stretch>(),
    displaced: new Map() as Displaced,
    now: 0,
    moves: 0,
  }
  declareFrames(b, ranks)
  return {
    refresh: () => refreshBoxes(b),
    around: (page: Declared) => boxAround(b, page),
    declaredUnion: (held: readonly (readonly [number | null, ArrayLike<number>])[]) =>
      unionDeclared(b, held),
    stretch: b.stretch as ReadonlyMap<number, Stretch>,
    /** How many parent frames moved at a refresh, summed. */
    get moves() {
      return b.moves
    },
  }
}

export type CellBoxes = ReturnType<typeof createCellBoxes>
