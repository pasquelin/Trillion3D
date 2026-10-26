/**
 * PLACEMENT ROWS: the instance buffer of one drawn resource.
 *
 * A resource — a primitive cut into pages, worn with one surface — is drawn at many places. Its
 * placements are not host nodes: they are rows of one buffer the owner writes, sixteen
 * column-major floats each, a flag saying whether the row places the resource or is parked, and one
 * saying whether it casts no shadow.
 * The engine reads each row IN PLACE: a cluster root's world matrix is a view on its row
 * (`placementWorld`), so a pose the owner writes is the pose the next frame reads, with nothing
 * copied. A parked row keeps its root in every table and is skipped by every cut: taking it back
 * is writing its matrix and raising its flag, never rebuilding a table.
 *
 * The capacity is the owner's decision; a resource that needs more rows than it holds is given a
 * larger buffer, which the session grows into in place where its engine can
 * (`../growth/growth.ts`), and waits otherwise, the owner saying it by name.
 */
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { AnimationBanks } from '../../../../sdk-core/src/scene/core/animationBanks.ts'
import type { MatrixElements } from '../../session/host/matrixElements.ts'
import type { DrawDistance, RootParent } from '../../geometry/selection/types.ts'
import type { ChangedRuns } from '../../geometry/residency/ranges.ts'
import {
  DRAW_DISTANCE_STRIDE,
  drawDistanceAt,
  writeDrawDistanceAt,
} from '../../geometry/dag/drawDistance.ts'
import { grownLength } from '../../../../math/src/sequence/resized.ts'
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'

/** The placement rows of mirrored meshes, one row per placed copy. */
export type PlacementRows = {
  /** Original owners of mirrored rows; their animation sources stay live when rows are reused. */
  sources?: readonly (Mesh<object> | null)[]
  /** Meshes sharing this resource, including those waiting for a placement row. */
  sourceModels?: ReadonlySet<Mesh<object>>
  /** Sixteen column-major floats per row, written by the owner. */
  readonly matrices: Float64Array
  /** 1 where the row places the resource, 0 where it is parked. */
  readonly live: Uint8Array
  /** Per row, how its mesh casts (`nodeCasting`): `SHADOWLESS_ROOT` where it casts no shadow (its
   *  `castShadow` is `false`), `FAR_SHADOW_ROOT` where it casts far ones, 0 where it casts alone. */
  readonly casting: Uint8Array
  /** Rows that fit before it grows. */
  readonly capacity: number
  /** The rows of the meshes of a loaded model (`session/world/models/models.ts`): each is the model's
   *  world times the mesh's world within the model's graph, whose bones stand in that graph's
   *  frame, never in the world's: a palette is read there (`DeformedMesh.frame`). */
  local?: true
  /** A blend item reads its rows (`../../blend/prepare.ts`): composed for that reader too
   *  (`../compose/composeReaders.ts`), never left to a root. Kept by a growth. */
  blended?: true
  /** Where each row a partition placed lies (`../../geometry/partition/rowCells.ts`): its cell, its rank
   *  among the cell's nodes, the placement of its model whose cells placed it (`instance`, 0 the
   *  first), its cell's HLOD 0 cell, and whether it draws as that cell's HLOD 0 actor — its cell
   *  past the main grid's loading range — rather than as the source mesh; a column of its own,
   *  absent until a cell places one. A row of an HLOD cell's instanced actor
   *  (`../../geometry/hlod/hlodRows.ts`) lies in no cell (-1), its rank among the actor's rows,
   *  that HLOD cell as `hlod`, and its actor's HLOD level (`actor`). */
  cells?: (
    | {
        cell: number
        node: number
        instance: number
        hlod: number
        proxy: boolean
        actor?: number
      }
    | undefined
  )[]
  /** The rows whose cell moved since a backend last linked them to the HLOD 0 cell they lie in
   *  (`../../geometry/partition/rowCells.ts`, `takeCellsMoved`): one changed list, kept by a growth. */
  cellsMoved?: ChangedRuns
  /** The scene's animation banks the rows' tracks are items of, for the rows of a mesh that
   *  instanced skinned objects place (`../../../../sdk-core/src/scene/core/animationBanks.ts`). */
  banks?: AnimationBanks
  /** Per row, the item of `banks` it plays — the GPU poses it from that track —, -1 for none: a
   *  column of its own, absent until a cell places an instanced skinned object; kept by a growth. */
  tracks?: Int32Array
  /** Per row, the nearest and the farthest distance it is drawn at and 1 where it is one instance
   *  of an instanced mesh (`CellNode.drawDistance`, `DRAW_DISTANCE_STRIDE`), all 0 for none: a
   *  column of its own, absent until a cell places an object that names one; kept by a growth,
   *  cleared where a row is parked. */
  drawDistance?: Float32Array
  /** Per row, 1 when a view's primed depth draws it (`CellNode.farField`): a column of its own,
   *  absent until a cell places an object that sets it; kept by a growth. */
  farField?: Uint8Array
  /** Per row, five floats — the error and the ball of the group that replaces its root, when its
   *  node is an instance of an assembly (`CellNode.rootParents`, the entry of this row's primitive),
   *  the radius 0 for none: a column of its own, absent until a cell places an instance; kept by a
   *  growth, cleared where a row is parked. */
  rootParent?: Float32Array
}

/** The values a row of the `rootParent` column takes: the error and the ball of a group. */
const ROOT_PARENT_STRIDE = 5

/** The optional columns of `PlacementRows`, one definition each: the values a row takes, `stride`,
 *  and how a column of `length` values — `stride` for each row — is made, every row unset: -1 for a
 *  track, 0 for the others. A column is made by the first row that names a value (`rowColumn`) and
 *  kept by a growth (`growPlacementRows`); each reader reads it where it lies, `undefined` meaning
 *  every row unset. */
const ROW_COLUMN_KINDS = {
  tracks: { stride: 1, make: (length: number) => new Int32Array(length).fill(-1) },
  drawDistance: {
    stride: DRAW_DISTANCE_STRIDE,
    make: (length: number) => new Float32Array(length),
  },
  farField: { stride: 1, make: (length: number) => new Uint8Array(length) },
  rootParent: { stride: ROOT_PARENT_STRIDE, make: (length: number) => new Float32Array(length) },
} as const
const ROW_COLUMNS = Object.keys(ROW_COLUMN_KINDS) as (keyof typeof ROW_COLUMN_KINDS)[]
type RowColumnName = keyof typeof ROW_COLUMN_KINDS

/** Column `name` of `rows`, made at the rows' capacity, every row unset, when no row named a value
 *  before. */
export function rowColumn<K extends RowColumnName>(rows: PlacementRows, name: K) {
  const held = rows[name]
  if (held) return held as NonNullable<PlacementRows[K]>
  const { stride, make } = ROW_COLUMN_KINDS[name],
    made = make(stride * rows.capacity)
  Object.assign(rows, { [name]: made })
  return made as NonNullable<PlacementRows[K]>
}

export function createPlacementRows(capacity: number): PlacementRows {
  const rows = Math.max(1, capacity)
  return {
    matrices: new Float64Array(rows * MATRIX_VALUES),
    live: new Uint8Array(rows),
    casting: new Uint8Array(rows),
    capacity: rows,
  }
}

/** A larger buffer for `needed` rows (`grownLength`): `before`'s rows copied first, the new
 *  ones parked. */
export function growPlacementRows(before: PlacementRows | null, needed: number) {
  const rows = createPlacementRows(grownLength(before?.capacity ?? 0, needed))
  if (before) {
    rows.sources = before.sources
    rows.sourceModels = before.sourceModels
    if (before.local) rows.local = true
    if (before.blended) rows.blended = true
    rows.matrices.set(before.matrices)
    rows.live.set(before.live)
    rows.casting.set(before.casting)
    rows.cells = before.cells?.slice()
    rows.cellsMoved = before.cellsMoved
    rows.banks = before.banks
    for (const name of ROW_COLUMNS) {
      const held = before[name]
      if (held) rowColumn(rows, name).set(held)
    }
  }
  return rows
}

/** Row `row` of `rows` written as its owner writes it: its pose (`null` keeps the one it holds),
 *  whether it places the resource, how its mesh casts (`nodeCasting`). */
export function writePlacementRow(
  rows: PlacementRows,
  row: number,
  matrix: ArrayLike<number> | null,
  live: boolean,
  casting: number,
) {
  if (matrix) rows.matrices.set(matrix, row * MATRIX_VALUES)
  rows.live[row] = live ? 1 : 0
  rows.casting[row] = casting
}

/** The world matrix of row `index`: a view on the buffer, never a copy. */
export const placementWorld = (rows: PlacementRows, index: number): MatrixElements => ({
  elements: rows.matrices.subarray(index * MATRIX_VALUES, (index + 1) * MATRIX_VALUES),
})

/** What a root or a blended copy carries of the row it was collected from: the rows, and its rank
 *  in them. */
export type PlacementOf = { rows: PlacementRows; index: number }

/** True when `placement` names a row the owner parked: its draw is skipped, its place kept. */
export const rowParked = (placement: PlacementOf | undefined) =>
  !!placement && placement.rows.live[placement.index] === 0

/** How `placement`'s row casts, as its mesh says (`nodeCasting`). */
export const rowCasting = (placement: PlacementOf) => placement.rows.casting[placement.index]

/** The distances `placement`'s row is drawn at, none for a row that names none. */
export const rowDrawDistance = ({ rows, index }: PlacementOf) =>
  drawDistanceAt(rows.drawDistance, index)

/** Row `row` of `rows` is drawn at `distance` from now on, at every distance for `undefined`; the
 *  column is made by the first row that names one. */
export function seatDrawDistance(
  rows: PlacementRows,
  row: number,
  distance: DrawDistance | undefined,
) {
  const column = distance ? rowColumn(rows, 'drawDistance') : rows.drawDistance
  if (column) writeDrawDistanceAt(column, row, distance)
}

/** The group that replaces the root of `placement`'s row, none for a row whose node is no instance
 *  of an assembly: a group's ball has a radius above 0 (an exact group has an error of 0 and is
 *  one), so a column's zero radius names none. */
export function rowRootParent({ rows, index }: PlacementOf): RootParent | undefined {
  const column = rows.rootParent,
    at = ROOT_PARENT_STRIDE * index
  if (!column || !(column[at + 4] > 0)) return undefined
  const sphere = [column[at + 1], column[at + 2], column[at + 3], column[at + 4]] as const
  return { error: column[at], sphere }
}

/** Whether two parents are one: the same error and the same ball, or neither. */
export const sameRootParent = (a: RootParent | undefined, b: RootParent | undefined) =>
  a === b ||
  (!!a && !!b && a.error === b.error && a.sphere.every((value, axis) => value === b.sphere[axis]))

/** Row `row` of `rows` is an instance of an assembly whose root's group is `parent` from now on,
 *  none for any other row; the column is made by the first row that names one. */
export function seatRootParent(rows: PlacementRows, row: number, parent: RootParent | undefined) {
  const column = parent ? rowColumn(rows, 'rootParent') : rows.rootParent
  if (!column) return
  const at = ROOT_PARENT_STRIDE * row
  column[at] = parent?.error ?? 0
  for (let k = 0; k < 4; k++) column[at + 1 + k] = parent?.sphere[k] ?? 0
}

/** How many times a row's far-field flag changed: what the primed draw's set is read again by
 *  (`../../frame/render/primeFarField.ts`). */
let farFieldMoves = 0
export const rowFarFieldMoves = () => farFieldMoves

/** Row `row` of `rows` is a far-field row or not from now on; the column is made by the first row
 *  that is one. */
export function seatFarField(rows: PlacementRows, row: number, farField: boolean) {
  const held = farField ? rowColumn(rows, 'farField') : rows.farField
  if (!held || held[row] === (farField ? 1 : 0)) return
  held[row] = farField ? 1 : 0
  farFieldMoves++
}

/** Whether `placement`'s row is a far-field row. */
export const rowFarField = (placement: PlacementOf | undefined) =>
  !!placement && placement.rows.farField?.[placement.index] === 1
