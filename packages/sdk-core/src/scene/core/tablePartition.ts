/**
 * The world partition the scene tables carry (`scene-tables.json`, `partition`;
 * `packages/asset-compiler-rust/src/compiler_tables/partition.rs`): the nodes that only place a
 * mesh are not in the node table the runtime reads before its first frame, but in spatial cells
 * read by distance to the camera — each cell under one stream unit, boxed in the frame of each core
 * parent it hangs nodes under, so a page that moves that parent moves the box. The tables keep only
 * a root: its slots, the core ranks the cells under each hang nodes under, and per mesh the nodes
 * placed and the rows a view holds; the cells' records lie in pages beside them
 * (`partition/pages.rs`), which the runtime reads as its view reaches them (#575, `readCellPage`).
 */
import { EngineError } from '../../contracts/cache.ts';
import {
  digits,
  eights,
  float64,
  hexes,
  isSlot,
  named,
  rankLists,
  text,
  versioned,
  type PageKind,
  type TableSlot,
} from './tablePages.ts';

/** The version of the partition and of its pages this runtime reads. */
const PARTITION_VERSION = 4;
/** The pages of the cell records. */
const CELL_PAGES: PageKind = {
  prefix: 'scene-page-',
  version: PARTITION_VERSION,
  records: 'cells',
  unsupported: 'UNSUPPORTED_SCENE_TABLES',
  invalid: 'INVALID_SCENE_TABLES',
};
/** How many slots the root lists. */
const FAN_OUT = 8;
/** How many sides the root's ladder of rows lists (`partition/pages/rows.rs`). */
export const RUNGS = 32;

/** One cell: where it is read, its fingerprint and size, the box around what it holds in the frame
 *  of each parent it hangs nodes under (`[minX, minY, minZ, maxX, maxY, maxZ]`), and how many nodes
 *  of each mesh it places. */
export interface TableCell {
  /** Its file, relative to the tables. */
  url: string;
  /** Fingerprint of its bytes. */
  sha256: string;
  /** Its size in bytes. */
  bytes: number;
  /** `[core rank, box]` per parent its nodes hang under (`null`: the scene root): the box around
   *  those nodes in that parent's frame. */
  parents: readonly (readonly [number | null, readonly number[]])[];
  /** `[mesh rank, nodes]` per mesh it places: what the runtime sizes its rows by at open. */
  meshes: readonly (readonly [number, number])[];
  /** The slots of the manifest's mesh pages its meshes lie in: its region page's list (#792),
   *  which a runtime holding the manifest by the view reads with the cell (#751). */
  meshPages: readonly string[];
}

/** The partition of a scene as its root gives it, before any page is read. */
export interface TablePartition {
  /** The box around every cell, at the poses the file declares. */
  bounds: readonly number[];
  /** The mesh ranks the cells place: each is drawn from rows, whatever cell brings it. */
  meshes: readonly number[];
  /** How many nodes the cells place, per mesh rank. */
  totals: ReadonlyMap<number, number>;
  /** Per mesh rank, its rows at each of `RUNGS` sides: the most nodes the cells of one parent
   *  meeting a cube of that side place, summed over the parents (`sizing.ts`, #575). */
  rows: ReadonlyMap<number, readonly number[]>;
  /** The side of the first rung, the widest cell's diagonal; each next one `√2` times wider. */
  cube: number;
  /** The core ranks the cells hang nodes under. */
  parents: readonly number[];
  /** The root's pages, the top of the cell index. */
  pages: readonly TableSlot[];
}

/** The partition as the tables carry it: its version, `FAN_OUT` slots, empty ones zeros, beside
 *  each the core ranks under it, eight hexadecimal digits each run together, per mesh its rank,
 *  node count and rows at each rung in eight each, and the first rung's side as `f64` bits. */
export type TablePartitionRoot = {
  version: number;
  pages: readonly string[];
  parents: readonly string[];
  meshes: readonly string[];
  cube: string;
};
/** The root, `null` when the scene has none, or a named refusal of another version or shape. */
export function assertTablePartition(value: unknown): TablePartitionRoot | null {
  if (value === null || value === undefined) return null;
  const root = versioned(CELL_PAGES, value, 'scene partition') as Partial<TablePartitionRoot>;
  const shaped =
    hexes(root.meshes, 16 + 8 * RUNGS) &&
    rankLists(root.parents, FAN_OUT) &&
    hexes([root.cube], 16);
  if (!shaped || !Array.isArray(root.pages) || root.pages.length !== FAN_OUT)
    throw new EngineError(CELL_PAGES.invalid, 'scene partition misses its root', {});
  return root as TablePartitionRoot;
}

/** The partition `root` gives before any page is read: its slots, the union of their boxes, the
 *  meshes placed, their node counts and rows, the parents followed. */
export function tablePartition(root: TablePartitionRoot): TablePartition {
  const pages = named(CELL_PAGES, root.pages, root.parents);
  const bounds = [0, 1, 2, 3, 4, 5].map((axis) =>
    (axis < 3 ? Math.min : Math.max)(...pages.map((slot) => slot.bounds[axis])),
  );
  const listed = root.meshes.map(eights);
  const totals = new Map(listed.map(([mesh, total]) => [mesh, total]));
  const rows = new Map(listed.map(([mesh, , ...rungs]) => [mesh, rungs]));
  const parents = [...new Set(pages.flatMap((slot) => slot.parents))].sort((a, b) => a - b);
  const cube = float64(root.cube);
  return { bounds, meshes: [...totals.keys()], totals, rows, cube, parents, pages };
}

/** A page of the cell index, from its verified bytes: the slots of the pages it lists, or its
 *  cells, each with the mesh pages its region page names (#792); or a named refusal. The decode
 *  pool reads it off the main thread (`cellPage`, #575). */
export function readCellPage(bytes: Uint8Array, url: string) {
  const body = versioned(CELL_PAGES, JSON.parse(text.decode(bytes)), url);
  if (Array.isArray(body.pages)) {
    if (!rankLists(body.parents, body.pages.length))
      throw new EngineError(CELL_PAGES.invalid, `${url} misses the parents of its pages`, {});
    return { pages: named(CELL_PAGES, body.pages, body.parents), cells: null };
  }
  const { meshPages, cells } = body as { meshPages?: unknown; cells?: TableCell[] };
  if (!Array.isArray(meshPages) || !meshPages.every(isSlot))
    throw new EngineError(CELL_PAGES.invalid, 'a region page misses its mesh pages', {});
  const valid = (cell: TableCell) => Array.isArray(cell?.meshes) && Array.isArray(cell.parents);
  if (!Array.isArray(cells) || !cells.every(valid))
    throw new EngineError(CELL_PAGES.invalid, `${url} lists neither pages nor cells`, {});
  return { pages: null, cells: cells.map((cell) => ({ ...cell, meshPages })) };
}
