/**
 * The world roots' records (docs/FORMAT.md, World super-roots): `world-roots.table` and
 * `world-roots.dag`, read straight from their bytes, as the cook writes them
 * (`compiler_world_roots/records.rs`). Never one string of the whole world, which a JavaScript
 * engine refuses past 512 MiB: the open world's table weighed 866 MiB as JSON. A record is read at
 * its rank when asked, as a page is viewed in its bundle; only the bundles, a few thousand, are
 * read whole. A file that breaks its contract is refused whole, `INVALID_CACHE`.
 */
import { uint64FromWords } from '../../../math/src/scalar/uint64.ts'
import { lastTrue } from '../../../math/src/scalar/search.ts'
import type { ClusterGroup } from '../contracts/geometry.ts'
import {
  WORLD_ROOTS_BIN,
  refuseWorldRoots as refuse,
  type WorldRoots,
  type WorldRootsCluster,
  type WorldRootsPageFacts,
} from './worldRoots.ts'

/** The products' version this reader knows: another is refused. */
const VERSION = 5
/** Bytes of each header and record (`records.rs`). */
const [TABLE_HEADER, BUNDLE, PAGE, CELL, OBJECT] = [80, 56, 24, 16, 24]
const [DAG_HEADER, CLUSTER, GROUP] = [24, 176, 64]
/** An index word naming nothing. */
const NONE = 0xffffffff

/** `bytes`' view, its `u32` words, and its pool from where `poolAt` reads it starts: `poolAt`
 *  refuses a file its records do not fill exactly. */
function opened(
  bytes: Uint8Array,
  magic: string,
  header: number,
  poolAt: (word: (at: number) => number) => number,
) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const word = (at: number) => view.getUint32(at, true)
  if (bytes.byteLength < header || String.fromCharCode(...bytes.subarray(0, 4)) !== magic)
    refuse(`not a ${magic} file`)
  if (word(4) !== VERSION) refuse(`version ${word(4)}`)
  const at = poolAt(word)
  const words = (bytes.byteLength - at) / 4
  // Aligned it is viewed in place; a caller's unaligned view is copied once.
  const pool =
    (bytes.byteOffset + at) % 4 === 0
      ? new Uint32Array(bytes.buffer, bytes.byteOffset + at, words)
      : new Uint32Array(bytes.slice(at).buffer)
  /** The list a record names at `at`: its first word and its length, inside the pool. */
  const list = (at: number) => {
    const first = word(at),
      count = word(at + 4)
    if (first + count > pool.length) refuse(`a list at ${at} past the pool`)
    return pool.subarray(first, first + count)
  }
  return { view, word, pool, list }
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
const below = (values: Uint32Array, end: number) => values.every((value) => value < end)

type Opened = ReturnType<typeof opened>

/** The table's bundles, each laid where the last ended from the binary's start and naming only
 *  bundles of the table, and the end of the last. */
function tableBundles(bytes: Uint8Array, { word, list }: Opened, count: number) {
  let end = 0
  const bundles = Array.from({ length: count }, (_, rank) => {
    const at = TABLE_HEADER + rank * BUNDLE,
      dependencies = list(at + 16)
    if (uint64FromWords(word(at), word(at + 4)) !== end)
      refuse(`bundle ${rank} is not the next range`)
    if (!below(dependencies, count)) refuse(`bundle ${rank} dependencies`)
    const offset = end
    end += word(at + 8)
    const sha256 = hex(bytes.subarray(at + 24, at + BUNDLE))
    return {
      offset,
      bytes: word(at + 8),
      sha256,
      count: word(at + 12),
      dependencies: [...dependencies],
    }
  })
  return { bundles, end }
}

/** The table's pages at `at`, `count` of them, read at their records. */
function tablePages({ view, word }: Opened, at: number, count: number): WorldRoots['pages'] {
  return {
    count,
    at(page) {
      const record = at + page * PAGE
      const [bundle, offset, level, bytes] = [0, 4, 8, 12].map((k) => word(record + k))
      return { bundle, offset, bytes, level, lodError: view.getFloat64(record + 16, true) }
    },
  }
}

/** The table's cells at `cellsAt` and their objects at `objectsAt`, checked: each cell's objects
 *  follow the last's, each node's first object is one of its cell's, and every object needs only
 *  bundles of the table. */
function tableCells(
  { word, list, pool }: Opened,
  [cellsAt, objectsAt]: number[],
  [cellCount, objectCount, bundleCount]: number[],
): WorldRoots['cells'] {
  let next = 0
  for (let cell = 0; cell < cellCount; cell++) {
    const count = word(cellsAt + cell * CELL + 4)
    if (word(cellsAt + cell * CELL) !== next) refuse(`cell ${cell} objects`)
    for (const first of list(cellsAt + cell * CELL + 8))
      if (first !== NONE && first >= count) refuse(`cell ${cell} nodes`)
    next += count
  }
  if (next !== objectCount) refuse('cells and objects')
  for (let object = 0; object < objectCount; object++)
    if (!below(list(objectsAt + object * OBJECT + 16), bundleCount)) refuse('object dependencies')
  const objectAt = (object: number) => {
    const at = objectsAt + object * OBJECT
    const [roots, dependencies] = [list(at + 8), list(at + 16)].map((v) => Array.from(v))
    return { node: word(at), primitive: word(at + 4), roots, dependencies }
  }
  return {
    count: cellCount,
    first: (cell) => word(cellsAt + cell * CELL),
    size: (cell) => word(cellsAt + cell * CELL + 4),
    nodeObject(cell, node) {
      // Read in place: a word of the pool, no view made (the lists were checked at open).
      const at = cellsAt + cell * CELL
      if (node >= word(at + 12)) return -1
      const first = pool[word(at + 8) + node]
      return first !== NONE ? first : -1
    },
    objectNode: (object) => word(objectsAt + object * OBJECT),
    objectPrimitive: (object) => word(objectsAt + object * OBJECT + 4),
    objectDependencies: (object) => list(objectsAt + object * OBJECT + 16),
    objects(cell) {
      const first = word(cellsAt + cell * CELL)
      return Array.from({ length: word(cellsAt + cell * CELL + 4) }, (_, i) => objectAt(first + i))
    },
    cellOf(object) {
      // The last cell starting at or before `object`: an empty cell starts where the next does.
      return lastTrue(0, cellCount - 1, (mid) => word(cellsAt + mid * CELL) <= object)
    },
  }
}

/**
 * `bytes` as a world-roots table, or `INVALID_CACHE`: its magic and version, its records filling
 * it, its bundles laid end to end from the binary's start, the pinned top's bytes the sum of its
 * first `pinned` bundles, and every dependency naming a bundle of the table.
 */
export function readWorldRoots(bytes: Uint8Array): WorldRoots {
  const file = opened(bytes, 'WRTB', TABLE_HEADER, (w) => {
    const counts = [w(20), w(24), w(28), w(32)]
    const records = counts[0] * BUNDLE + counts[1] * PAGE + counts[2] * CELL + counts[3] * OBJECT
    if (TABLE_HEADER + records + w(36) * 4 !== bytes.byteLength) refuse('table length')
    return TABLE_HEADER + records
  })
  const { word } = file
  const [pinned, pinnedTopBytes, bundleCount, pageCount, cellCount, objectCount] = [
    12, 16, 20, 24, 28, 32,
  ].map(word)
  const pagesAt = TABLE_HEADER + bundleCount * BUNDLE,
    cellsAt = pagesAt + pageCount * PAGE,
    objectsAt = cellsAt + cellCount * CELL
  const { bundles, end } = tableBundles(bytes, file, bundleCount)
  // No pinned bundle is a world whose objects all stand alone: each held with its cell.
  if (pinned > bundleCount) refuse(`pinned ${pinned}`)
  const payloadBytes = uint64FromWords(word(40), word(44))
  if (payloadBytes !== end) refuse('payload')
  const top = bundles.slice(0, pinned).reduce((sum, bundle) => sum + bundle.bytes, 0)
  if (pinnedTopBytes !== top) refuse('pinnedTopBytes')
  return {
    version: VERSION,
    budgetBytes: word(8),
    pinned,
    pinnedTopBytes,
    payload: { url: WORLD_ROOTS_BIN, sha256: hex(bytes.subarray(48, 80)), bytes: payloadBytes },
    bundles,
    pages: tablePages(file, pagesAt, pageCount),
    cells: tableCells(file, [cellsAt, objectsAt], [cellCount, objectCount, bundleCount]),
  }
}

/** The page facts a cluster record holds at `at`, or null for an object root (a zero length). */
function pageFacts(view: DataView, at: number): WorldRootsPageFacts | null {
  const word = (k: number) => view.getUint32(at + k * 4, true)
  if (!word(0)) return null
  return {
    bytes: word(0),
    vertexCount: word(1),
    indexCount: word(2),
    flags: word(3),
    uncompressedBytes: word(4),
    quantizationError: view.getFloat32(at + 20, true),
  }
}

/**
 * `bytes` as the world DAG, or `INVALID_CACHE`: every world cluster in the cook's rank, in the
 * shape the world stream reads (`WorldRootsCluster`), and the group list, its children and outputs
 * naming clusters of the DAG.
 */
export function readWorldRootsDag(bytes: Uint8Array) {
  const { view, word, list } = opened(bytes, 'WRTD', DAG_HEADER, (w) => {
    const records = DAG_HEADER + w(8) * CLUSTER + w(12) * GROUP
    if (records + w(16) * 4 !== bytes.byteLength) refuse('DAG length')
    return records
  })
  const clusterCount = word(8)
  const floats = (at: number, count: number) =>
    Array.from({ length: count }, (_, i) => view.getFloat64(at + i * 8, true))
  const named = (at: number) => (word(at) === NONE ? null : word(at))
  const clusters: WorldRootsCluster[] = Array.from({ length: clusterCount }, (_, cluster) => {
    const at = DAG_HEADER + cluster * CLUSTER,
      parentError = view.getFloat64(at + 32, true),
      parentSphere = floats(at + 72, 4)
    return {
      cluster,
      level: word(at),
      lodError: view.getFloat64(at + 24, true),
      sphere: floats(at + 40, 4),
      parentError: Number.isNaN(parentError) ? null : parentError,
      parentSphere: Number.isNaN(parentSphere[0]) ? null : parentSphere,
      min: floats(at + 104, 3),
      max: floats(at + 128, 3),
      triangles: word(at + 4),
      primitive: named(at + 8),
      bundle: named(at + 12),
      offset: named(at + 16),
      origin: named(at + 20),
      page: pageFacts(view, at + 152),
    }
  })
  const groupsAt = DAG_HEADER + clusterCount * CLUSTER
  const groups: ClusterGroup[] = Array.from({ length: word(12) }, (_, group) => {
    const at = groupsAt + group * GROUP
    const [children, outputs] = [list(at + 4), list(at + 12)]
    if (!below(children, clusterCount) || !below(outputs, clusterCount)) refuse(`group ${group}`)
    const [error, ...sphere] = floats(at + 24, 5)
    return { level: word(at), error, sphere, children: [...children], outputs: [...outputs] }
  })
  return { clusters, groups }
}
