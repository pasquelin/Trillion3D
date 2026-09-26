/**
 * The world partition the scene tables carry (`scene-tables.json`, `partition`;
 * `packages/asset-compiler-rust/src/compiler_tables/partition.rs`): the nodes that only place a
 * mesh are not in the node table the runtime reads before its first frame, but in spatial cells
 * read by distance to the camera — each cell under one stream unit, boxed in the frame of each core
 * parent it hangs nodes under, so a page that moves that parent moves the box. The tables keep only
 * the root of the cells' records, a fixed number of fixed-width slots; the records lie in pages
 * beside them (`partition/pages.rs`), which `readTablePartition` reads back.
 */
import { EngineError } from '../../contracts/cache.ts';

/** The version of the partition, of its pages and of its cell files this runtime reads. */
const PARTITION_VERSION = 2;
/** How many slots the root lists. */
const FAN_OUT = 8;
/** A slot: SHA-256 in 64 hexadecimal digits, size in 8, box as six `f64` bit patterns in 16. */
const SLOT_WIDTH = 64 + 8 + 6 * 16;

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
}

/** The partition of a scene: its cells, the box around them all, and the meshes they place. */
export interface TablePartition {
  /** Version of the partition. */
  version: number;
  /** The box around every cell, at the poses the file declares. */
  bounds: readonly number[];
  /** The mesh ranks the cells place: each is drawn from rows, whatever cell brings it. */
  meshes: readonly number[];
  /** The cells. */
  cells: readonly TableCell[];
}

/** One node a cell places: the core node it hangs under (`null`, the scene), its mesh, and its
 *  LOCAL pose exactly as declared — a matrix, or translation, rotation and scale, each `null`
 *  when silent — which the runtime composes the way it composes every other pose. */
export interface CellNode {
  /** Rank of its parent in the core node table; `null` for a scene root. */
  parent: number | null;
  /** The mesh it places. */
  mesh: number;
  /** Its local matrix, column-major. */
  matrix: readonly number[] | null;
  /** Where it stands. */
  translation: readonly number[] | null;
  /** How it is turned, as a quaternion. */
  rotation: readonly number[] | null;
  /** How it is stretched. */
  scale: readonly number[] | null;
}

/** The partition as the tables carry it: `FAN_OUT` slots, each naming a page, empty ones zeros. */
export interface TablePartitionRoot {
  /** Version of the partition. */
  version: number;
  /** The slots. */
  pages: readonly string[];
}

/** A page a slot names: its file, relative to the tables, its size and its fingerprint. */
export interface TablePage {
  url: string;
  bytes: number;
  sha256: string;
}

/** A page's body: the slots of the pages below it, or the records of its cells. */
type PageBody = { version?: number; pages?: readonly string[]; cells?: readonly TableCell[] };

/** `body` at this runtime's version, or a named refusal; `what` names it. */
function versioned(body: unknown, what: string): PageBody {
  const page = body as PageBody | null;
  if (page?.version !== PARTITION_VERSION)
    throw new EngineError(
      'UNSUPPORTED_SCENE_TABLES',
      `${what} partition version ${String(page?.version)} is not the ${PARTITION_VERSION} this runtime reads`,
      { partitionVersion: page?.version ?? null },
    );
  return page;
}

/** The root, `null` when the scene has none, or a named refusal of another version or shape. */
export function assertTablePartition(value: unknown): TablePartitionRoot | null {
  if (value === null || value === undefined) return null;
  const root = versioned(value, 'scene');
  if (!Array.isArray(root.pages) || root.pages.length !== FAN_OUT)
    throw new EngineError('INVALID_SCENE_TABLES', 'scene partition misses its root', {});
  return root as TablePartitionRoot;
}

const bits = new DataView(new ArrayBuffer(8));
/** The `f64` whose bits are the sixteen hexadecimal digits `hex`. */
function float64(hex: string) {
  bits.setUint32(0, parseInt(hex.slice(0, 8), 16));
  bits.setUint32(4, parseInt(hex.slice(8, 16), 16));
  return bits.getFloat64(0);
}

/** The page `slot` names and its box, `null` for an empty slot, or a named refusal. */
function slotPage(slot: unknown) {
  if (typeof slot !== 'string' || slot.length !== SLOT_WIDTH || !/^[0-9a-f]+$/.test(slot))
    throw new EngineError('INVALID_SCENE_TABLES', 'a partition slot is not fixed-width hex', {});
  const bytes = parseInt(slot.slice(64, 72), 16);
  if (bytes === 0) return null;
  const sha256 = slot.slice(0, 64);
  const bounds = Array.from({ length: 6 }, (_, at) => float64(slot.slice(72 + 16 * at)));
  return { page: { url: `scene-page-${sha256}.json`, bytes, sha256 }, bounds };
}

/**
 * The partition under `root`: every page read through `read` — which hands back its bytes once
 * they are the ones the slot announced — the pages of one level side by side, the cells in their
 * order. The box around every cell is the union of the root's; the meshes are those the cells place.
 */
export async function readTablePartition(
  root: TablePartitionRoot,
  read: (page: TablePage) => Promise<Uint8Array>,
): Promise<TablePartition> {
  const records = async (slots: readonly string[]): Promise<TableCell[]> => {
    const pages = slots.map(slotPage).filter((slot) => slot !== null);
    const lists = await Promise.all(
      pages.map(async ({ page }) => {
        const text = new TextDecoder().decode(await read(page));
        const body = versioned(JSON.parse(text), page.url);
        return body.pages ? records(body.pages) : (body.cells ?? []);
      }),
    );
    return lists.flat();
  };
  const cells = await records(root.pages);
  if (!cells.every((cell) => Array.isArray(cell?.meshes) && Array.isArray(cell.parents)))
    throw new EngineError('INVALID_SCENE_TABLES', 'scene partition misses its cells', {});
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const slot of root.pages.map(slotPage))
    slot?.bounds.forEach((value, axis) => {
      bounds[axis] = axis < 3 ? Math.min(bounds[axis], value) : Math.max(bounds[axis], value);
    });
  const meshes = [...new Set(cells.flatMap((cell) => cell.meshes.map(([mesh]) => mesh)))];
  return { version: root.version, bounds, meshes: meshes.sort((a, b) => a - b), cells };
}

/** The nodes of a cell file, or a named refusal. */
export function assertCellNodes(value: unknown): readonly CellNode[] {
  const cell = value as { version?: number; nodes?: CellNode[] } | null;
  if (!cell || cell.version !== PARTITION_VERSION || !Array.isArray(cell.nodes))
    throw new EngineError(
      'INVALID_SCENE_TABLES',
      `scene cell is not a version ${PARTITION_VERSION} node list`,
      {
        version: cell?.version ?? null,
      },
    );
  return cell.nodes;
}
