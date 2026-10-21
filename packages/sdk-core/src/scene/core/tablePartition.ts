/**
 * The world partition the scene tables carry (`scene-tables.json`, `partition`;
 * `packages/asset-compiler-rust/src/compiler/tables/partition.rs`): the nodes that only place a
 * mesh are not in the node table the runtime reads before its first frame, but in the cells of
 * the partition's main grid, streamed by distance to the camera — each cell file under one stream
 * unit, boxed in the frame of each core parent it hangs nodes under, and naming the world bounds
 * its grid cell streams by and its HLOD 0 cell's. The tables keep only a root: its slots, the core
 * ranks the cells under each hang nodes under, per mesh the nodes placed and the rows a view
 * holds, the partition's scheme — which the runtime tests and ranks its cells by —, whether its
 * grids lie flat, every grid's cell side, loading range, priority and HLOD level, and what each
 * square grid whose wished cells pull in the coarser ones finds those by; the cells' records lie
 * in pages beside them (`partition/pages.rs`), which the runtime reads as its view reaches them
 * (`readCellPage`).
 */
import { EngineError } from '../../contracts/cache.ts'
import { PARTITION_SCHEMES, type PartitionScheme } from '../../contracts/partitionOptions.ts'
import {
  eights,
  float64,
  hexes,
  isSlot,
  named,
  pageJson,
  rankLists,
  versioned,
  type PageKind,
  type TableSlot,
} from './tablePages.ts'

/** The version of the partition and of its pages this runtime reads: 13, the one that names per
 *  grid whether cell files stream on it (`PartitionGrid.files`). What each version changed is
 *  listed in `docs/FORMAT.md` (the partition's versions). */
const PARTITION_VERSION = 13
/** The bits of a grid's flags in the root: a load blocks on its slow streaming, and cell files
 *  stream on it. */
const GRID_BLOCKS = 1,
  GRID_FILES = 2
/** The hexadecimal digits of a grid in the root: its cell side and its loading range, `f64` bits
 *  of sixteen digits each, then its priority, its HLOD level and its flags, eight each; and of the
 *  coarser-cell record of a square grid: its centre's two coordinates, sixteen each, then its
 *  finest level's cells per side, eight. */
const GRID_DIGITS = 16 + 16 + 3 * 8,
  COARSER_DIGITS = 16 + 16 + 8
/** The pages of the cell records. */
const CELL_PAGES: PageKind = {
  prefix: 'scene-page-',
  version: PARTITION_VERSION,
  records: 'cells',
  unsupported: 'UNSUPPORTED_SCENE_TABLES',
  invalid: 'INVALID_SCENE_TABLES',
}
/** How many slots the root lists. */
const FAN_OUT = 8
/** How many sides the root's ladder of rows lists (`partition/pages/rows.rs`). */
export const RUNGS = 32

/** One cell: where it is read, its fingerprint and size, the box around what it holds in the frame
 *  of each parent it hangs nodes under (`[minX, minY, minZ, maxX, maxY, maxZ]`), and how many nodes
 *  of each mesh it places. */
export interface TableCell {
  /** Its file, relative to the tables. */
  url: string
  /** Fingerprint of its bytes. */
  sha256: string
  /** Its size in bytes. */
  bytes: number
  /** `[core rank, box]` per parent its nodes hang under (`null`: the scene root): the box around
   *  those nodes in that parent's frame. */
  parents: readonly (readonly [number | null, readonly number[]])[]
  /** `[mesh rank, nodes]` per mesh it places: what the runtime sizes its rows by at open. */
  meshes: readonly (readonly [number, number])[]
  /** The slots of the manifest's mesh pages its meshes lie in: its region page's list,
   *  which a runtime holding the manifest by the view reads with the cell. */
  meshPages: readonly string[]
  /** Its main grid cell: level, then its coordinates on glTF's `x` and `z` — or `x`, `y`, `z` on
   *  grids that do not lie flat (`TablePartition.flat`, `partition/grid.rs`). */
  grid: readonly [number, number, number] | readonly [number, number, number, number]
  /** The world bounds its grid cell streams by, at the declared poses: the box around its
   *  content, its cell's box, or the first clipped to the second, as the job names (`hashSet`),
   *  or its square on the plane with its content's up axis (`spatialHash`). */
  bounds: readonly number[]
  /** The HLOD 0 cell its objects' actor lies in, the bounds that cell streams by, its grid
   *  (`TablePartition.hlod.grids`, `hlod/cells.rs`) and the level of its cell on that grid;
   *  `null` for objects in no layer, which stream with their cell alone. */
  hlod: readonly [number, readonly number[], number, number] | null
}

/** One grid of the partition (`hlod/grids.rs`, `Grids`): its cell side and loading range, metres,
 *  the priority its cells load by, the lower the sooner — the main grid's, the first, the one the
 *  job sets (`PARTITION_GRID_FIELD`, 0 by default), an HLOD grid's 0 (`hashSet`) or 100 plus its
 *  level (`spatialHash`) —, the HLOD level of the actors it streams, 0 for the main grid,
 *  whether a load blocks on its slow streaming — the main grid's as the job names it
 *  (`blockOnSlowStreaming`), an HLOD grid's never
 *  (`../../../../sdk-browser/src/geometry/partition/slowStreaming.ts`) —, and whether cell files
 *  stream on it — the main grid, and each grid an HLOD 0 cell lies on, an instanced layer's
 *  whatever its HLOD level (`../../../../sdk-browser/src/geometry/partition/plan.ts`,
 *  `placedReach`). */
export type PartitionGrid = {
  cell: number
  range: number
  priority: number
  level: number
  blocks: boolean
  files: boolean
}

/** What a square grid whose wished cells pull in the coarser cells overlapping them finds those
 *  by (`compiler/tables/partition/square.rs`): its centre on the ground, glTF's `x` and `z`, and
 *  its finest level's cells per side — a power of two, halved at each level up to its top's one,
 *  each level below the top holding one more. */
export type CoarserGrid = { x: number; z: number; cells: number }

/** The partition of a scene as its root gives it, before any page is read. */
export interface TablePartition {
  /** The box around every cell, at the poses the file declares. */
  bounds: readonly number[]
  /** The mesh ranks the cells place: each is drawn from rows, whatever cell brings it. */
  meshes: readonly number[]
  /** How many nodes the cells place, per mesh rank. */
  totals: ReadonlyMap<number, number>
  /** Per mesh rank, its rows at each of `RUNGS` sides: the most nodes the cells of one parent
   *  meeting a cube of that side place, summed over the parents (`sizing.ts`). */
  rows: ReadonlyMap<number, readonly number[]>
  /** The side of the first rung, the widest cell's diagonal; each next one `√2` times wider. */
  cube: number
  /** The core ranks the cells hang nodes under. */
  parents: readonly number[]
  /** The root's pages, the top of the cell index. */
  pages: readonly TableSlot[]
  /** How its cells were cut, which says how the runtime tests and ranks them
   *  (`PARTITION_SCHEMES`, `../../../../sdk-browser/src/geometry/partition/source.ts`). */
  scheme: PartitionScheme
  /** Whether the grids lie flat on the ground — a cell then tested from above, its up axis
   *  dropped —, as a square grid always does. */
  flat: boolean
  /** The grids, the main one first (`PartitionGrid`), per grid what its wished cells pull the
   *  coarser ones overlapping them in by (`CoarserGrid`), `null` when they pull none, and how many
   *  HLOD 0 cells the cells name. */
  hlod: {
    grids: readonly PartitionGrid[]
    coarser: readonly (CoarserGrid | null)[]
    cells: number
  }
}

/** The partition as the tables carry it: its version, `FAN_OUT` slots, empty ones zeros, beside
 *  each the core ranks under it, eight hexadecimal digits each run together, per mesh its rank,
 *  node count and rows at each rung in eight each, and the first rung's side as `f64` bits. */
export type TablePartitionRoot = {
  version: number
  pages: readonly string[]
  parents: readonly string[]
  meshes: readonly string[]
  cube: string
  /** The partition's scheme, one of `PARTITION_SCHEMES`. */
  scheme: PartitionScheme
  /** Whether the grids lie flat on the ground. */
  flat: boolean
  /** Per grid its cell side and loading range as `f64` bits, sixteen hexadecimal digits each,
   *  then its priority, its HLOD level and its flags (`GRID_BLOCKS`) in eight each; per grid
   *  whose wished cells pull in the coarser ones its centre on the ground as `f64` bits, sixteen
   *  each, then its finest level's cells per side in eight, `null` for any other; and the HLOD 0
   *  cells' count in eight. */
  hlod: { grids: readonly string[]; coarser: readonly (string | null)[]; cells: string }
}
/** The root, `null` when the scene has none, or a named refusal of another version or shape. */
export function assertTablePartition(value: unknown): TablePartitionRoot | null {
  if (value === null || value === undefined) return null
  const root = versioned(CELL_PAGES, value, 'scene partition') as Partial<TablePartitionRoot>
  const grids = root.hlod?.grids,
    coarser = root.hlod?.coarser
  const shaped =
    hexes(root.meshes, 16 + 8 * RUNGS) &&
    rankLists(root.parents, FAN_OUT) &&
    hexes([root.cube], 16) &&
    (PARTITION_SCHEMES as readonly unknown[]).includes(root.scheme) &&
    typeof root.flat === 'boolean' &&
    hexes(grids, GRID_DIGITS) &&
    // The main grid's at least, which every cell streams on (`partition.rs`).
    grids.length >= 1 &&
    Array.isArray(coarser) &&
    coarser.length === grids.length &&
    coarser.every((grid) => grid === null || hexes([grid], COARSER_DIGITS)) &&
    hexes([root.hlod?.cells], 8)
  if (!shaped || !Array.isArray(root.pages) || root.pages.length !== FAN_OUT)
    throw new EngineError(CELL_PAGES.invalid, 'scene partition misses its root', {})
  return root as TablePartitionRoot
}

/** The partition `root` gives before any page is read: its slots, the union of their boxes, the
 *  meshes placed, their node counts and rows, the parents followed. */
export function tablePartition(root: TablePartitionRoot): TablePartition {
  const pages = named(CELL_PAGES, root.pages, root.parents)
  const bounds = [0, 1, 2, 3, 4, 5].map((axis) =>
    (axis < 3 ? Math.min : Math.max)(...pages.map((slot) => slot.bounds[axis])),
  )
  const listed = root.meshes.map(eights)
  const totals = new Map(listed.map(([mesh, total]) => [mesh, total]))
  const rows = new Map(listed.map(([mesh, , ...rungs]) => [mesh, rungs]))
  const parents = [...new Set(pages.flatMap((slot) => slot.parents))].sort((a, b) => a - b)
  const cube = float64(root.cube)
  const grids = root.hlod.grids.map((grid) => {
    const [priority, level, flags] = eights(grid.slice(32))
    return {
      cell: float64(grid.slice(0, 16)),
      range: float64(grid.slice(16, 32)),
      priority,
      level,
      blocks: (flags & GRID_BLOCKS) !== 0,
      files: (flags & GRID_FILES) !== 0,
    }
  })
  const coarser = root.hlod.coarser.map((grid) =>
    grid === null
      ? null
      : {
          x: float64(grid.slice(0, 16)),
          z: float64(grid.slice(16, 32)),
          cells: eights(grid.slice(32))[0],
        },
  )
  const hlod = { grids, coarser, cells: eights(root.hlod.cells)[0] }
  const { scheme, flat } = root
  return {
    bounds,
    meshes: [...totals.keys()],
    totals,
    rows,
    cube,
    parents,
    pages,
    scheme,
    flat,
    hlod,
  }
}

/** A page of the cell index, from its verified bytes: the slots of the pages it lists, or its
 *  cells, each with the mesh pages its region page names, and the rank of the first
 *  (`first`: the `n`-th is the cook's cell `first + n`, as the world roots number it); or a
 *  named refusal. The decode pool reads it off the main thread (`cellPage`). */
export function readCellPage(bytes: Uint8Array, url: string) {
  const body = versioned(CELL_PAGES, pageJson(bytes), url)
  if (Array.isArray(body.pages)) {
    if (!rankLists(body.parents, body.pages.length))
      throw new EngineError(CELL_PAGES.invalid, `${url} misses the parents of its pages`, {})
    return { pages: named(CELL_PAGES, body.pages, body.parents), cells: null, first: null }
  }
  const { meshPages, cells, first } = body as {
    meshPages?: unknown
    cells?: TableCell[]
    first?: unknown
  }
  if (!Number.isSafeInteger(first) || (first as number) < 0)
    throw new EngineError(CELL_PAGES.invalid, `${url} misses the rank of its first cell`, {})
  if (!Array.isArray(meshPages) || !meshPages.every(isSlot))
    throw new EngineError(CELL_PAGES.invalid, 'a region page misses its mesh pages', {})
  const valid = (cell: TableCell) =>
    Array.isArray(cell?.meshes) &&
    Array.isArray(cell.parents) &&
    Array.isArray(cell.bounds) &&
    cell.bounds.length === 6 &&
    (cell.hlod === null ||
      (Array.isArray(cell.hlod) &&
        Number.isSafeInteger(cell.hlod[0]) &&
        Number.isSafeInteger(cell.hlod[2]) &&
        Number.isSafeInteger(cell.hlod[3])))
  if (!Array.isArray(cells) || !cells.every(valid))
    throw new EngineError(CELL_PAGES.invalid, `${url} lists neither pages nor cells`, {})
  return {
    pages: null,
    cells: cells.map((cell) => ({ ...cell, meshPages })),
    first: first as number,
  }
}
