/**
 * `world-roots.json` and its binary (docs/FORMAT.md, World super-roots; #23, #1237): the table of
 * the world DAG the compiler continues above every object's roots, read and checked here, and the
 * pages of one of its bundles viewed on their bytes. A table that breaks its own contract is
 * refused whole, `INVALID_CACHE`: the runtime pins its first `pinned` bundles for good.
 */
import { EngineError } from '../contracts/cache.ts';

/** The product's version this reader knows: another is refused. */
const WORLD_ROOTS_VERSION = 1;
/** The table beside the manifest; its binary is the one its `payload` names. */
export const WORLD_ROOTS_FILE = 'world-roots.json';
/** The binary the cook writes beside it, the one its `payload` names; a reader follows `payload`. */
export const WORLD_ROOTS_BIN = 'world-roots.bin';

/** One bundle of `world-roots.bin`: its range in the binary, its digest, its page count and the
 *  bundles it needs. */
export type WorldRootsBundle = {
  /** Where it starts in the binary, in bytes. */
  offset: number;
  /** Its length in the binary. */
  bytes: number;
  /** The SHA-256 of its bytes, checked as it is read. */
  sha256: string;
  /** How many pages it holds. */
  count: number;
  /** The bundles its pages need, ascending, up to the world top. */
  dependencies: number[];
};
/** One placed primitive of a world cell: the world bundles its roots need, up to the top. */
export type WorldRootsObject = {
  /** Its published node. */
  node: number;
  /** Its primitive in the manifest. */
  primitive: number;
  /** The bundles of that primitive's streams holding its roots. */
  roots: number[];
  /** Every world bundle those roots need, ascending, up to the top. */
  dependencies: number[];
};
/** `world-roots.json`: the world DAG the compiler continues above every object's roots — its
 *  bundles, pages and cells, the pinned top first. */
export type WorldRoots = {
  /** Format version. */
  version: number;
  /** The most bytes the cook lets the pinned top weigh. */
  budgetBytes: number;
  /** The first bundles, the world top: pinned. */
  pinned: number;
  /** The bytes of the pinned top. */
  pinnedTopBytes: number;
  /** The binary the bundles lie in, end to end: its address, digest and length. */
  payload: { url: string; sha256: string; bytes: number };
  /** The bundles, in the binary's order. */
  bundles: WorldRootsBundle[];
  /** Each page: its bundle, its offset in it, its level and its error. */
  pages: { bundle: number; offset: number; level: number; lodError: number }[];
  /** Each world cell: the placed primitives it holds. */
  cells: { objects: WorldRootsObject[] }[];
};
/** One super-root page viewed on its bundle's bytes: its own vertices in world space, and its
 *  triangles as local indices. */
export type WorldRootsPage = {
  /** Its vertices, three numbers each, in world space. */
  positions: Float32Array;
  /** Its triangles, three local indices each. */
  indices: Uint16Array;
};

const refuse = (message: string): never => {
  throw new EngineError('INVALID_CACHE', `world roots: ${message}`);
};
const natural = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const inRange = (list: unknown, end: number) =>
  Array.isArray(list) && list.every((index) => natural(index) && index < end);

/**
 * `value` as a world-roots table, or `INVALID_CACHE`: its version, bundles laid end to end
 * from the binary's start, the pinned top's bytes the sum of its first `pinned` bundles, and every
 * dependency naming a bundle of the table.
 */
export function assertWorldRoots(value: unknown): WorldRoots {
  const table = value as WorldRoots;
  if (table?.version !== WORLD_ROOTS_VERSION) refuse(`version ${String(table?.version)}`);
  const { bundles, cells, pinned, payload } = table;
  if (!Array.isArray(bundles) || !Array.isArray(cells) || !Array.isArray(table.pages))
    refuse('bundles, pages and cells are lists');
  if (!natural(pinned) || pinned < 1 || pinned > bundles.length) refuse(`pinned ${pinned}`);
  let end = 0;
  for (const [at, bundle] of bundles.entries()) {
    if (bundle?.offset !== end || !natural(bundle.bytes) || typeof bundle.sha256 !== 'string')
      refuse(`bundle ${at} is not the next range of the binary`);
    if (!inRange(bundle.dependencies, bundles.length)) refuse(`bundle ${at} dependencies`);
    end += bundle.bytes;
  }
  if (typeof payload?.url !== 'string' || payload.bytes !== end) refuse('payload');
  if (table.pinnedTopBytes !== topBytes(table)) refuse('pinnedTopBytes');
  for (const [at, cell] of cells.entries())
    if (!cell?.objects?.every((object) => inRange(object?.dependencies, bundles.length)))
      refuse(`cell ${at} dependencies`);
  return table;
}

/** Bytes of the pinned top: its bundles, the first of the binary. */
const topBytes = ({ bundles, pinned }: Pick<WorldRoots, 'bundles' | 'pinned'>) =>
  bundles.slice(0, pinned).reduce((sum, bundle) => sum + bundle.bytes, 0);

/** The bundles past the pinned top the roots of `cell`'s objects need, ascending: what the cell
 *  holds while it is placed. */
export function cellDependencies(table: WorldRoots, cell: number): number[] {
  const needed = new Set<number>();
  for (const { dependencies } of table.cells[cell]?.objects ?? [])
    for (const bundle of dependencies) if (bundle >= table.pinned) needed.add(bundle);
  return [...needed].sort((a, b) => a - b);
}

/**
 * The pages of bundle `bundle`, viewed on `bytes`, its range of the binary: each a vertex count, a
 * triangle count, its vertices as three floats and its triangles as 16-bit local indices padded
 * to four bytes. A bundle whose pages do not fill it exactly, or name a vertex they do not carry,
 * is refused.
 */
export function worldBundlePages(bytes: Uint8Array, count: number, bundle: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    pages: WorldRootsPage[] = [];
  let at = 0;
  for (let page = 0; page < count; page++) {
    if (at + 8 > bytes.byteLength) refuse(`bundle ${bundle} ends inside page ${page}`);
    const vertices = view.getUint32(at, true),
      corners = view.getUint32(at + 4, true) * 3;
    const start = bytes.byteOffset + at + 8,
      end = at + 8 + vertices * 12 + Math.ceil((corners * 2) / 4) * 4;
    if (end > bytes.byteLength) refuse(`bundle ${bundle} ends inside page ${page}`);
    const positions = new Float32Array(bytes.buffer.slice(start, start + vertices * 12));
    const indices = new Uint16Array(
      bytes.buffer.slice(start + vertices * 12, start + vertices * 12 + corners * 2),
    );
    if (indices.some((index) => index >= vertices)) refuse(`bundle ${bundle} page ${page}`);
    pages.push({ positions, indices });
    at = end;
  }
  if (at !== bytes.byteLength) refuse(`bundle ${bundle} holds more than its ${count} pages`);
  return pages;
}

/** One world cluster as the cook's `clusters` key publishes it (FORMAT.md, World super-roots; #1238),
 *  in rank order (`cluster` is its index, which the groups name): the fields the runtime cut
 *  projects, and where its page lives — a super-root its `bundle` and `offset` in the binary, an
 *  object root its `origin` (the placed instance). Kept out of the exported `WorldRoots`, whose
 *  shape the API reference translates. */
export type WorldRootsCluster = {
  cluster: number;
  level: number;
  lodError: number;
  sphere: number[];
  parentError: number | null;
  parentSphere: number[] | null;
  min: number[];
  max: number[];
  triangles: number;
  material: number | null;
  bundle: number | null;
  offset: number | null;
  origin: number | null;
};
