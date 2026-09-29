/**
 * The world partition the scene tables carry (`scene-tables.json`, `partition`;
 * `packages/asset-compiler-rust/src/compiler_tables/partition.rs`): the nodes that only place a
 * mesh are not in the node table the runtime reads before its first frame, but in spatial cells
 * read by distance to the camera — each cell under one stream unit, boxed in the frame of each core
 * parent it hangs nodes under, so a page that moves that parent moves the box. The tables keep only
 * a root: its slots, the nodes placed per mesh and the core ranks the cells hang under; the cells'
 * records lie in pages beside them (`partition/pages.rs`), which the runtime reads as its view
 * reaches them (#575, `readCellPage`), never before its first frame.
 */
import { EngineError } from '../../contracts/cache.ts';

/** The version of the partition and of its pages this runtime reads. */
const PARTITION_VERSION = 4;
/** A kind of page (`partition/pages.rs`): the prefix of its files, the version every page carries,
 *  the member a region page lists its records under, and the codes of a refusal. */
export interface PageKind {
  prefix: string;
  version: number;
  records: string;
  unsupported: string;
  invalid: string;
}
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

/** A page of the cell index (#575): the cells its region pages list, `[from, to)` in the
 *  partition's order, and the pages it lists — none for a region page. The cook cuts the pages
 *  from its halving (`split.rs`): each holds the cells of one region of space. */
export interface TableRegion {
  from: number;
  to: number;
  pages: readonly TableRegion[];
}

/** A page of the cell index a slot names, and its box at the declared poses. */
export type TableSlot = { page: TablePage; bounds: readonly number[] };

/** The partition of a scene as its root gives it, before any page is read. */
export interface TablePartition {
  /** The box around every cell, at the poses the file declares. */
  bounds: readonly number[];
  /** The mesh ranks the cells place: each is drawn from rows, whatever cell brings it. */
  meshes: readonly number[];
  /** How many nodes the cells place, per mesh rank: what the rows are sized by at open. */
  totals: ReadonlyMap<number, number>;
  /** The core ranks the cells hang nodes under. */
  parents: readonly number[];
  /** The root's pages, the top of the cell index. */
  pages: readonly TableSlot[];
}

/** The partition as the tables carry it: its version, `FAN_OUT` slots, empty ones zeros, per mesh
 *  its rank and node count in eight hexadecimal digits each, and each parent's rank in eight. */
export type TablePartitionRoot = {
  version: number;
  pages: readonly string[];
  meshes: readonly string[];
  parents: readonly string[];
};
/** A page a slot names: its file, relative to the tables, its size and its fingerprint. */
export type TablePage = { url: string; bytes: number; sha256: string };

/** A page's body: the slots of the pages below it, or its records. */
type PageBody = { version?: number; pages?: readonly string[]; [records: string]: unknown };
/** `body` at `kind`'s version, or a named refusal; `what` names it. */
function versioned(kind: PageKind, body: unknown, what: string): PageBody {
  const page = body as PageBody | null;
  if (page?.version !== kind.version)
    throw new EngineError(
      kind.unsupported,
      `${what} version ${String(page?.version)} is not the ${kind.version} this runtime reads`,
      { version: page?.version ?? null },
    );
  return page;
}

/** Whether `list` is an array of `width` hexadecimal digits each. */
const hexes = (list: unknown, width: number): list is string[] =>
  Array.isArray(list) && list.every((item) => typeof item === 'string' && item.length === width);

/** The root, `null` when the scene has none, or a named refusal of another version or shape. */
export function assertTablePartition(value: unknown): TablePartitionRoot | null {
  if (value === null || value === undefined) return null;
  const root = versioned(CELL_PAGES, value, 'scene partition') as Partial<TablePartitionRoot>;
  const shaped = hexes(root.meshes, 16) && hexes(root.parents, 8);
  if (!shaped || !Array.isArray(root.pages) || root.pages.length !== FAN_OUT)
    throw new EngineError(CELL_PAGES.invalid, 'scene partition misses its root', {});
  return root as TablePartitionRoot;
}

const bits = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(8));
const text = /* @__PURE__ */ new TextDecoder();
/** The `f64` whose bits are the sixteen hexadecimal digits `hex`. */
const float64 = (hex: string) => (bits.setBigUint64(0, BigInt(`0x${hex}`)), bits.getFloat64(0));
/** Whether `slot` is 168 hexadecimal digits. */
const isSlot = (slot: unknown): slot is string =>
  typeof slot === 'string' && /^[0-9a-f]{168}$/.test(slot);

/** The page of `kind` that `slot` names and its box, `null` for an empty slot, or a named refusal. A
 *  slot is the page's SHA-256 in 64 hexadecimal digits, its size in 8, its box as six `f64` bit
 *  patterns in 16. */
function slotPage(kind: PageKind, slot: unknown) {
  if (!isSlot(slot)) throw new EngineError(kind.invalid, 'a page slot is not fixed-width hex', {});
  const bytes = parseInt(slot.slice(64, 72), 16);
  if (bytes === 0) return null;
  const sha256 = slot.slice(0, 64);
  const bounds = [0, 1, 2, 3, 4, 5].map((at) => float64(slot.slice(72 + 16 * at, 88 + 16 * at)));
  return { page: { url: `${kind.prefix}${sha256}.json`, bytes, sha256 }, bounds };
}

/** The page of `kind` at `page`, read through `read`, at `kind`'s version. */
async function readPage(
  kind: PageKind,
  page: TablePage,
  read: (page: TablePage) => Promise<Uint8Array>,
) {
  return versioned(kind, JSON.parse(text.decode(await read(page))), page.url);
}

/** The pages `slots` of `kind` name, their boxes beside them, the empty ones left out. */
export const named = (kind: PageKind, slots: readonly unknown[]) =>
  slots.map((slot) => slotPage(kind, slot)).filter((slot) => slot !== null);

/** Every region page of `kind` under `slots`, in record order, the pages read side by side
 *  through `read` (which verifies each against its slot). */
export async function readLeaves(
  kind: PageKind,
  slots: ReturnType<typeof named>,
  read: (page: TablePage) => Promise<Uint8Array>,
): Promise<PageBody[]> {
  const lists = await Promise.all(
    slots.map(async ({ page }) => {
      const body = await readPage(kind, page, read);
      if (Array.isArray(body.pages)) return readLeaves(kind, named(kind, body.pages), read);
      if (Array.isArray(body[kind.records])) return [body];
      throw new EngineError(kind.invalid, `${page.url} lists neither pages nor records`, {});
    }),
  );
  return lists.flat();
}

/** An integer of hexadecimal digits `from` to `to` of `hex`. */
const digits = (hex: string, from: number, to: number) => parseInt(hex.slice(from, to), 16);

/** The partition `root` gives before any page is read: its slots, the union of their boxes, the
 *  meshes placed and their node counts, the parents followed. */
export function tablePartition(root: TablePartitionRoot): TablePartition {
  const pages = named(CELL_PAGES, root.pages);
  const bounds = [0, 1, 2, 3, 4, 5].map((axis) =>
    (axis < 3 ? Math.min : Math.max)(...pages.map((slot) => slot.bounds[axis])),
  );
  const totals = new Map(root.meshes.map((mesh) => [digits(mesh, 0, 8), digits(mesh, 8, 16)]));
  const parents = root.parents.map((rank) => digits(rank, 0, 8));
  return { bounds, meshes: [...totals.keys()], totals, parents, pages };
}

/** A page of the cell index, from its verified bytes: the slots of the pages it lists, or its
 *  cells, each with the mesh pages its region page names (#792); or a named refusal. The decode
 *  pool reads it off the main thread (`cellPage`, #575). */
export function readCellPage(bytes: Uint8Array, url: string) {
  const body = versioned(CELL_PAGES, JSON.parse(text.decode(bytes)), url);
  if (Array.isArray(body.pages)) return { pages: named(CELL_PAGES, body.pages), cells: null };
  const { meshPages, cells } = body as { meshPages?: unknown; cells?: TableCell[] };
  if (!Array.isArray(meshPages) || !meshPages.every(isSlot))
    throw new EngineError(CELL_PAGES.invalid, 'a region page misses its mesh pages', {});
  const valid = (cell: TableCell) => Array.isArray(cell?.meshes) && Array.isArray(cell.parents);
  if (!Array.isArray(cells) || !cells.every(valid))
    throw new EngineError(CELL_PAGES.invalid, `${url} lists neither pages nor cells`, {});
  return { pages: null, cells: cells.map((cell) => ({ ...cell, meshPages })) };
}
