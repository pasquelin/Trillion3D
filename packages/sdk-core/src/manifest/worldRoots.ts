/**
 * The world roots and their binary (docs/FORMAT.md, World super-roots): the table of
 * the world DAG the compiler continues above every object's roots — its records read and checked
 * in `worldRootsTable.ts` —, and the pages of one of its bundles viewed on their bytes. A
 * table that breaks its own contract is refused whole, `INVALID_CACHE`: the runtime pins its first
 * `pinned` bundles for good.
 */
import { EngineError } from '../contracts/cache.ts'

/** The table beside the manifest, fixed-size records: what a load reads. */
export const WORLD_ROOTS_FILE = 'world-roots.table'
/** The world clusters and groups beside it, records too: what the world stream reads on first use. */
export const WORLD_ROOTS_DAG = 'world-roots.dag'
/** The binary the cook writes beside it, the one its `payload` names. */
export const WORLD_ROOTS_BIN = 'world-roots.bin'

/** One bundle of `world-roots.bin`: its range in the binary, its digest, its page count and the
 *  bundles it needs. */
export type WorldRootsBundle = {
  /** Where it starts in the binary, in bytes. */
  offset: number
  /** Its length in the binary. */
  bytes: number
  /** The SHA-256 of its bytes, checked as it is read. */
  sha256: string
  /** How many pages it holds. */
  count: number
  /** The bundles its pages need, ascending, up to the world top. */
  dependencies: number[]
}
/** One placed primitive of a world cell: the world bundles its roots need, up to the top. */
export type WorldRootsObject = {
  /** Its published node. */
  node: number
  /** Its primitive in the manifest. */
  primitive: number
  /** The bundles of that primitive's streams holding its roots. */
  roots: number[]
  /** Every world bundle those roots need, ascending, up to the top. */
  dependencies: number[]
}
/** `world-roots.table`: the world DAG the compiler continues above every object's roots — its
 *  bundles, pages and cells, the pinned top first —, its pages and cells read at their records. */
export type WorldRoots = {
  /** Format version. */
  version: number
  /** The most bytes the cook lets the pinned top weigh. */
  budgetBytes: number
  /** The first bundles, the world top: pinned. */
  pinned: number
  /** The bytes of the pinned top. */
  pinnedTopBytes: number
  /** The binary the bundles lie in, end to end: its address, digest and length. */
  payload: { url: string; sha256: string; bytes: number }
  /** The bundles, in the binary's order. */
  bundles: WorldRootsBundle[]
  /** The pages: how many, and one's bundle, offset in it, length, level and error, read at its
   *  record. */
  pages: {
    count: number
    at(page: number): {
      bundle: number
      offset: number
      bytes: number
      level: number
      lodError: number
    }
  }
  /** The world cells: how many, the placed primitives one holds — each word read in place, no
   *  record built —, and the cell holding object `object` — an object root's `origin`. */
  cells: {
    count: number
    /** The rank of `cell`'s first object among the table's: its record says it. */
    first(cell: number): number
    /** The number of objects `cell` holds. */
    size(cell: number): number
    /** Object `object`'s node and primitive, by its rank among the table's: two words read in
     *  place, no record built. */
    objectNode(object: number): number
    objectPrimitive(object: number): number
    /** Object `object`'s bundle dependencies, a view of the table's words. */
    objectDependencies(object: number): Uint32Array
    /** The first object of node `node` of `cell` — its rank in the cell's file, the order the
     *  partition places it in —, counted from the cell's first; -1 for a node the cook continued
     *  nothing of. The cook writes it (`compiler_world_roots/cells.rs`). */
    nodeObject(cell: number, node: number): number
    cellOf(object: number): number
  }
}
/** One super-root page viewed on its bundle's bytes: a geometry page, its vertices in world space
 *  with the attributes its objects carry, decoded and drawn as any page. */
export type WorldRootsPage = {
  /** Its geometry page's bytes (docs/FORMAT.md, Geometry pages). */
  bytes: Uint8Array
}

export const refuseWorldRoots = (message: string): never => {
  throw new EngineError('INVALID_CACHE', `world roots: ${message}`)
}
const refuse = refuseWorldRoots

/** The bundles past the pinned top the roots of `cell`'s objects need, ascending: what the cell
 *  holds while it is placed. */
export function cellDependencies(table: WorldRoots, cell: number): number[] {
  const needed = new Set<number>(),
    { cells } = table
  if (cell >= cells.count) return []
  // Each object's list read in place: no record of the cell built.
  const first = cells.first(cell)
  for (let object = first; object < first + cells.size(cell); object++)
    for (const bundle of cells.objectDependencies(object))
      if (bundle >= table.pinned) needed.add(bundle)
  return [...needed].sort((a, b) => a - b)
}

/** Each bundle's first page in the table, its pages lying in bundle order (`records.rs`). */
const firstPages = new WeakMap<WorldRoots, Uint32Array>()
export function firstPage(table: WorldRoots, bundle: number) {
  let first = firstPages.get(table)
  if (!first) {
    first = new Uint32Array(table.bundles.length + 1)
    table.bundles.forEach(({ count }, b) => (first![b + 1] = first![b] + count))
    firstPages.set(table, first)
  }
  return first[bundle]
}

/**
 * The pages of bundle `bundle` of `table`, viewed on `bytes`, its range of the binary: each the
 * range its page record names, in binary order. A bundle whose pages do not tile it exactly, or
 * whose records name another bundle, is refused.
 */
export function worldBundlePages(table: WorldRoots, bundle: number, bytes: Uint8Array) {
  const pages: WorldRootsPage[] = [],
    { count } = table.bundles[bundle],
    first = firstPage(table, bundle)
  let at = 0
  for (let page = first; page < first + count; page++) {
    const record = table.pages.at(page)
    if (record.bundle !== bundle || record.offset !== at || record.bytes < 1)
      refuse(`bundle ${bundle} page ${page - first}`)
    if (at + record.bytes > bytes.byteLength) refuse(`bundle ${bundle} ends inside its pages`)
    pages.push({ bytes: bytes.subarray(at, at + record.bytes) })
    at += record.bytes
  }
  if (at !== bytes.byteLength) refuse(`bundle ${bundle} holds more than its ${count} pages`)
  return pages
}

/** One world cluster as the cook's `clusters` key publishes it (FORMAT.md, World super-roots),
 *  in rank order (`cluster` is its index, which the groups name): the fields the runtime cut
 *  projects, and where its page lives — a super-root its `bundle` and `offset` in the binary, an
 *  object root its `origin`, the rank among the table's objects of the placed object drawing it
 *  (`cells.cellOf` finds its cell). Kept out of the exported `WorldRoots`, whose
 *  shape the API reference translates. */
export type WorldRootsCluster = {
  cluster: number
  level: number
  lodError: number
  sphere: number[]
  parentError: number | null
  parentSphere: number[] | null
  min: number[]
  max: number[]
  triangles: number
  /** The primitive whose material and attributes it wears: its object's, or for a super-root one
   *  of the objects it stands for, all wearing the same. */
  primitive: number | null
  bundle: number | null
  offset: number | null
  origin: number | null
  /** What a super-root's geometry page says of itself, as a primitive page's `geometry` does; null
   *  for an object root, whose pages are its object's. */
  page: WorldRootsPageFacts | null
}

/** A super-root page's length, vertex and index counts, attribute flags, decoded bytes and largest
 *  position displacement (`pages.rs`). */
export type WorldRootsPageFacts = {
  bytes: number
  vertexCount: number
  indexCount: number
  flags: number
  uncompressedBytes: number
  quantizationError: number
}
