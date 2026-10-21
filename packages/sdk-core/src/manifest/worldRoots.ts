/**
 * The world's HLOD and its binary (docs/FORMAT.md, World HLOD): the table of the HLOD 1 to 3 the
 * compiler builds per HLOD cell (`hlod/chain.rs`, the HLOD chain) —
 * its records read and checked in `worldRootsTable.ts`. A table that breaks its own contract is
 * refused whole, `INVALID_CACHE`.
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
  /** The bundles its pages need, ascending, up to its HLOD cell's roots. */
  dependencies: number[]
}
/** `world-roots.table`: the world's HLOD — its bundles, pages and HLOD 0 cells —, its pages read at
 *  their records. */
export type WorldRoots = {
  /** Format version. */
  version: number
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
  /** The chain's HLOD cells, the HLOD 0 cells first, the partition's (`tablePartition.ts`, `hlod`):
   *  per cell, its actor's ROOT PAGES, ascending — every bundle holding one of its roots, and as
   *  many more as its layer's always-resident size asks (`hlod/chain/bundles.rs`) —: what it holds
   *  while its actor is loaded. */
  hlod: readonly (readonly number[])[]
  /** The chain of HLOD cells (`src/hlod/cells.rs`), the HLOD 0 cells first: per cell, the cell
   *  its actor lies in (-1 for an actor always loaded, or a cell nothing is built of), its level —
   *  0 for an HLOD 0 cell, whose placements it draws, 1 at least for a cell of actors —, its
   *  actor's HLOD level (`actorLevel`), its grid (`TablePartition.hlod.grids`), the level of its
   *  cell on that grid, which its load order reads first (`rung`), its actor's flags
   *  (`CHAIN_ACTOR`: built, none for an actor not built, which stands for nothing), the six
   *  bounds it streams by — as its partition's scheme says, its content or its square on its grid
   *  — and the six of its content, the actors in it. */
  chain: {
    parent: Int32Array
    level: Uint8Array
    actorLevel: Uint16Array
    grid: Uint16Array
    rung: Uint8Array
    actor: Uint8Array
    bounds: Float64Array
    content: Float64Array
  }
  /** Each cell's actor's rows (`hlod/chain/builds/instanced.rs`): the objects standing as
   *  themselves in it — an instanced layer's every one, the others' those marked `hlodInstance` —,
   *  cell `c`'s the `count[c]` rows its bundle `bundle[c]` holds (-1 for none), one of the bundles
   *  it holds with its actor's root pages (`hlod`): they stream with the actor, read as it is
   *  loaded (`actorRows`), placed on their meshes' rows and drawn while the cell draws it
   *  (`browser/geometry/hlod/hlodRows.ts`). */
  rows: { bundle: Int32Array; count: Uint32Array }
}
/** A chain cell's actor flags (`WorldRoots.chain.actor`), the one word every reader asks whether
 *  a cell has an actor: built — its bundles hold its roots, or it places rows —, and whether a
 *  switch that draws it waits on its warm-up — its layer's builder not `instanced`
 *  (`src/hlod/cells.rs`, `warmup`). Not built — none of its layer, or its build failed —, it
 *  stands for nothing. */
export const CHAIN_ACTOR = { built: 1, warmup: 2 } as const

/** Each cell's children in a chain of `parent`s (-1 for a top cell): the cells whose actors lie in
 *  it. */
export function chainChildren(parent: ArrayLike<number>) {
  const below: number[][] = Array.from({ length: parent.length }, () => [])
  for (let cell = 0; cell < parent.length; cell++)
    if (parent[cell] >= 0) below[parent[cell]].push(cell)
  return below
}

export const refuseWorldRoots = (message: string): never => {
  throw new EngineError('INVALID_CACHE', `world roots: ${message}`)
}
const refuse = refuseWorldRoots

/** Each bundle's first page in the table, its pages lying in bundle order (`records.rs`). */
const firstPages = new WeakMap<WorldRoots, Uint32Array>()
function firstPage(table: WorldRoots, bundle: number) {
  let first = firstPages.get(table)
  if (!first) {
    first = new Uint32Array(table.bundles.length + 1)
    table.bundles.forEach(({ count }, b) => (first![b + 1] = first![b] + count))
    firstPages.set(table, first)
  }
  return first[bundle]
}

/**
 * The pages of bundle `bundle` of `table`: each one's offset and length in the bundle, in binary
 * order, read off the table's records. A bundle whose pages do not tile it exactly, or whose
 * records name another bundle, is refused.
 */
export function bundlePageRanges(table: WorldRoots, bundle: number) {
  const ranges: { offset: number; bytes: number }[] = [],
    { count, bytes } = table.bundles[bundle]
  // A bundle of no page holds an actor's rows, read whole by its cell: it has no page range.
  if (count === 0) return ranges
  const first = firstPage(table, bundle)
  let at = 0
  for (let page = first; page < first + count; page++) {
    const record = table.pages.at(page)
    if (record.bundle !== bundle || record.offset !== at || record.bytes < 1)
      refuse(`bundle ${bundle} page ${page - first}`)
    if (at + record.bytes > bytes) refuse(`bundle ${bundle} ends inside its pages`)
    ranges.push({ offset: at, bytes: record.bytes })
    at += record.bytes
  }
  if (at !== bytes) refuse(`bundle ${bundle} holds more than its ${count} pages`)
  return ranges
}

/** One world cluster as the cook publishes it (FORMAT.md, World HLOD), in rank order (`cluster` is
 *  its index, which the groups name): the fields the runtime cut projects, where its page lives —
 *  its `bundle` and `offset` in the binary —, and the HLOD cell whose switch shows it. Kept out of the exported `WorldRoots`, whose shape is public. */
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
  /** Its actor's rank: the flattened material it wears is the scene tables' `hlodMaterials` at
   *  that rank. */
  material: number
  bundle: number
  offset: number
  /** Its HLOD cell (`WorldRoots.hlod`), whose switch shows it, and whose level gives its HLOD
   *  layer (`WorldRoots.chain`). */
  hlod: number
  /** What its geometry page says of itself, as a primitive page's `geometry` does. */
  page: WorldRootsPageFacts
}

/** A world page's length, vertex and index counts, attribute flags and decoded bytes
 *  (`pages.rs`). */
export type WorldRootsPageFacts = {
  bytes: number
  vertexCount: number
  indexCount: number
  flags: number
  uncompressedBytes: number
}
