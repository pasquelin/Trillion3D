/**
 * The world partition the scene tables carry (`scene-tables.json`, `partition`;
 * `packages/asset-compiler-rust/src/compiler_tables/partition.rs`): the nodes that only place a
 * mesh are not in the node table the runtime reads before its first frame, but in spatial cells
 * read by distance to the camera — each cell under one stream unit, boxed in the frame of each core
 * parent it hangs nodes under, so a page that moves that parent moves the box. The tables keep only
 * a root of fixed size; the cells' records lie in pages beside them (`partition/pages.rs`).
 */
import { EngineError } from '../../contracts/cache.ts';

/** The version of the partition and of its pages this runtime reads. */
const PARTITION_VERSION = 3;
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

/** The partition of a scene: its cells, the box around them all, and the meshes they place. */
export interface TablePartition {
  /** The box around every cell, at the poses the file declares. */
  bounds: readonly number[];
  /** The mesh ranks the cells place: each is drawn from rows, whatever cell brings it. */
  meshes: readonly number[];
  /** The cells. */
  cells: readonly TableCell[];
  /** The root's pages as the cell index (#575): a frame opens only those near its camera. */
  regions: readonly TableRegion[];
}

/** The partition as the tables carry it: its version and `FAN_OUT` slots, empty ones zeros. */
export type TablePartitionRoot = { version: number; pages: readonly string[] };
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

/** The root, `null` when the scene has none, or a named refusal of another version or shape. */
export function assertTablePartition(value: unknown): TablePartitionRoot | null {
  if (value === null || value === undefined) return null;
  const root = versioned(CELL_PAGES, value, 'scene partition');
  if (!Array.isArray(root.pages) || root.pages.length !== FAN_OUT)
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

/** The pages of `kind` under `slots`, as the tree they form: each body and the pages it lists,
 *  none for a region page; read side by side through `read` (which verifies each by its slot). */
type PageTree = { body: PageBody; pages?: PageTree[] };
async function readTree(
  kind: PageKind,
  slots: ReturnType<typeof named>,
  read: (page: TablePage) => Promise<Uint8Array>,
): Promise<PageTree[]> {
  return Promise.all(
    slots.map(async ({ page }) => {
      const body = await readPage(kind, page, read);
      if (Array.isArray(body.pages))
        return { body, pages: await readTree(kind, named(kind, body.pages), read) };
      if (Array.isArray(body[kind.records])) return { body };
      throw new EngineError(kind.invalid, `${page.url} lists neither pages nor records`, {});
    }),
  );
}

/** The region pages of `trees`, in record order. */
const leaves = (trees: PageTree[]): PageBody[] =>
  trees.flatMap((tree) => (tree.pages ? leaves(tree.pages) : [tree.body]));

/** Every region page of `kind` under `slots`, in record order (`readTree`). */
export const readLeaves = async (
  kind: PageKind,
  slots: ReturnType<typeof named>,
  read: (page: TablePage) => Promise<Uint8Array>,
) => leaves(await readTree(kind, slots, read));

/** The pages of `trees` as regions of the cells their region pages list, numbered from `at`. */
function regionsOf(trees: PageTree[], at = { next: 0 }): TableRegion[] {
  return trees.map(({ body, pages }) => {
    const from = at.next;
    const below = pages ? regionsOf(pages, at) : [];
    if (!pages) at.next += (body[CELL_PAGES.records] as unknown[]).length;
    return { from, to: at.next, pages: below };
  });
}

/** The partition under `root`, its pages read side by side through `read` (which verifies them
 *  against their slot): the cells in order, each with the mesh pages its region page names (#792),
 *  the union of the root's boxes, the meshes placed, the pages as the cell index. */
export async function readTablePartition(
  root: TablePartitionRoot,
  read: (page: TablePage) => Promise<Uint8Array>,
): Promise<TablePartition> {
  const slots = named(CELL_PAGES, root.pages);
  const tree = await readTree(CELL_PAGES, slots, read);
  const pages = leaves(tree);
  if (!pages.every(({ meshPages }) => Array.isArray(meshPages) && meshPages.every(isSlot)))
    throw new EngineError(CELL_PAGES.invalid, 'a region page misses its mesh pages', {});
  const records = pages.map((page) => page[CELL_PAGES.records] as TableCell[]);
  const valid = (cell: TableCell) => Array.isArray(cell?.meshes) && Array.isArray(cell.parents);
  if (!records.every((list) => Array.isArray(list) && list.every(valid)))
    throw new EngineError(CELL_PAGES.invalid, 'scene partition misses its cells', {});
  const cells = pages.flatMap(({ meshPages }, at) =>
    records[at].map((cell) => ({ ...cell, meshPages: meshPages as string[] })),
  );
  const bounds = [0, 1, 2, 3, 4, 5].map((axis) =>
    (axis < 3 ? Math.min : Math.max)(...slots.map((slot) => slot.bounds[axis])),
  );
  const meshes = [...new Set(cells.flatMap((cell) => cell.meshes.map(([mesh]) => mesh)))];
  return { bounds, meshes: meshes.sort((a, b) => a - b), cells, regions: regionsOf(tree) };
}
