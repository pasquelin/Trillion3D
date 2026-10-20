/**
 * WHICH CELLS OF A PARTITIONED SCENE ARE PLACED, AND WHICH HLOD 0 CELLS ARE WISHED: the
 * partition's streaming policy, one loading range per grid around the camera.
 *
 * Each grid streams its cells within its loading range of the camera — the main grid's, then each
 * HLOD layer's, twice the one below — four times at HLOD 2 — (`TablePartition.hlod.ranges`, `compiler_tables/partition/
 * grid.rs`) —: a cell is wished while its streaming bounds meet the sphere of that range around the
 * eye, tested in 2D, its up axis dropped, as a 2D grid's spatial index tests it — height never
 * keeps a cell out (glTF's up is `+Y`). An HLOD 0 cell
 * is wished within the HLOD 0 grid's range of its streaming bounds, or while it stands for an actor
 * it cannot draw (`../dag/worlds/worldFollow.ts`): its cells are then placed — the source meshes within
 * the main grid's range, its HLOD 0 actor past it, the same meshes instanced. It is placed whole once every cell of it is placed and no
 * page of the index that could list one of its cells waits to be opened — one refused for good
 * waits for nothing. What draws each HLOD cell
 * is its visibility (`../hlod/hlodCells.ts`, `../dag/worlds/worldFollow.ts`). The camera's far plane plays no
 * part.
 *
 * A placed cell leaves once its HLOD 0 cell is neither wished nor visible: a cell is unloaded
 * only once it is made invisible, never while it still draws. The pages of the cell index are walked within the farthest
 * a placed cell lies (`placedReach`) and closed past its keep sphere (`cellIndex.ts`).
 */
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import {
  keepNumbers,
  transformAffinePoint,
  transformDirectionVector3,
} from '../../../../math/src/vector/vector.ts'
import { boxGroundDistance } from '../../../../math/src/geometry/boxDistance.ts'
import { BOX_VALUES, boxesOverlap } from '../../../../math/src/geometry/box.ts'
import { stretchOf } from './boxes.ts'
import type { CellIndex, IndexPage } from './cellIndex.ts'

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

/** The farthest a placed cell's content lies from the eye, from the grids' `ranges`: an HLOD 0
 *  cell is wished within its range, and its cells lie within its side's diagonal of it, its side
 *  half its range (cell size = loading range / 2) — what the rows
 *  are sized by (`sizing.ts`). */
export const placedReach = (ranges: readonly number[]) => ranges[1] * (1 + Math.SQRT1_2)

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
  if (!keepNumbers(inverted, world)) least = stretchOf(world, invertMatrix4(inverse, world))[0]
  // Flattened: no eye there, every cell.
  if (!least) return { eye: [0, 0, 0], reach: Infinity, axis: [0, 0, 0] }
  const local = transformAffinePoint([0, 0, 0], inverse, eye[0], eye[1], eye[2])
  // `transformDirectionVector3` normalises what the inverse stretched.
  const along = transformDirectionVector3([0, 0, 0], inverse, axis[0], axis[1], axis[2])
  return { eye: local, reach: reach / least, axis: along }
}

/** 2D distance from `eye` to the nearest box `[minX, minY, minZ, maxX, maxY, maxZ]` of `bounds`,
 *  six values each, the up axis dropped as a 2D grid drops it; 0 over one. */
export function boxDistance(bounds: ArrayLike<number>, eye: ArrayLike<number>) {
  let nearest = Infinity
  for (let at = 0; at < bounds.length; at += BOX_VALUES) {
    nearest = Math.min(nearest, boxGroundDistance(bounds, at, eye[0], eye[2]))
  }
  return nearest
}

/** What a world DAG says of an HLOD 0 cell: whether it keeps it visible, and whether it stands for
 *  an actor it cannot draw (`../hlod/hlodCells.ts`). */
type LeafHolds = { visible(leaf: number): boolean; stands(leaf: number): boolean }

/** An HLOD 0 cell met this frame: whether it is wished, and whether it is placed whole. */
export type LeafWish = { readonly wished: boolean; readonly placed: boolean }
/** An HLOD 0 cell met: its cells met, its streaming bounds and the frame it was last met. */
type Leaf = {
  wished: boolean
  placed: boolean
  cells: number[]
  bounds: ArrayLike<number>
  frame: number
}

/**
 * The plan of the frames of `index`, its lists kept from frame to frame: a frame from `eye`, the
 * grids' loading `ranges`, the cells `placed` holds, whether a page's read is refused for good
 * (`failed`) and what a world DAG says of each HLOD 0 cell (`LeafHolds`, none without one) gives the
 * cells to read and place, nearest first
 * (`visible`), the placed cells that leave (`leave`), the index pages to open within the walk,
 * nearest first (`pages`), each HLOD 0 cell met (`leaves`), and each placed cell's distance
 * (`distances`), which tells its source meshes from its HLOD 0 actor.
 */
export function createCellPlan(index: Pick<CellIndex, 'near' | 'cell'>) {
  const leaves = new Map<number, Leaf>(),
    distances = new Map<number, number>(),
    pageDistances = new Map<IndexPage, number>()
  const out = {
    visible: [] as number[],
    leave: [] as number[],
    pages: [] as IndexPage[],
    leaves,
    distances,
  }
  let frame = 0,
    leafRange = 0
  const nearest = (a: number, b: number) => distances.get(a)! - distances.get(b)!
  const nearestPage = (a: IndexPage, b: IndexPage) => pageDistances.get(a)! - pageDistances.get(b)!
  const visit = (
    cell: number,
    own: number,
    leaf: number,
    h: number,
    leafBox: ArrayLike<number>,
  ) => {
    distances.set(cell, own)
    let met = leaves.get(h)
    if (!met)
      leaves.set(h, (met = { wished: false, placed: false, cells: [], bounds: [], frame: -1 }))
    if (met.frame !== frame) {
      met.frame = frame
      met.cells.length = 0
      met.wished = leaf <= leafRange || !!holding?.stands(h)
      met.bounds = leafBox
    }
    met.cells.push(cell)
  }
  const unread = (page: IndexPage, distance: number) => {
    out.pages.push(page)
    pageDistances.set(page, distance)
  }
  /** Whether a page of the index the frame waits on could list a cell of `leaf`: its box holds
   *  the streaming bounds of every cell it lists (`partition.rs`). */
  let refused: ((page: IndexPage) => boolean) | undefined, holding: LeafHolds | undefined
  const awaited = (leaf: Leaf) => {
    for (const page of out.pages)
      if (!refused?.(page) && boxesOverlap(page.box, 0, leaf.bounds, 0)) return true
    return false
  }
  return function plan(
    eye: ArrayLike<number>,
    ranges: readonly number[],
    placed: ReadonlyMap<number, unknown>,
    failed?: (page: IndexPage) => boolean,
    world?: LeafHolds,
  ) {
    frame++
    refused = failed
    holding = world
    leafRange = ranges[1]
    out.visible.length = out.leave.length = out.pages.length = 0
    distances.clear()
    pageDistances.clear()
    const reach = placedReach(ranges)
    index.near(eye, reach, keepRadius(reach), placed, visit, unread)
    for (const [h, leaf] of leaves) {
      if (leaf.frame !== frame) {
        leaves.delete(h)
        continue
      }
      let whole = true
      for (const cell of leaf.cells) {
        if (placed.has(cell)) continue
        whole = false
        if (leaf.wished) out.visible.push(cell)
      }
      leaf.placed = whole && !awaited(leaf)
    }
    out.visible.sort(nearest)
    out.pages.sort(nearestPage)
    // A placed cell leaves once its HLOD 0 cell is neither wished nor visible.
    for (const cell of placed.keys()) {
      const h = index.cell(cell).hlod[0]
      if (!leaves.get(h)?.wished && !world?.visible(h)) out.leave.push(cell)
    }
    return out
  }
}
