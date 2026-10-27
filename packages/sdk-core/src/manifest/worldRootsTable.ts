/**
 * The world HLOD's records (docs/FORMAT.md, World HLOD): `world-roots.table` and
 * `world-roots.dag`, read straight from their bytes, as the cook writes them
 * (`chain/records.rs`). Never one string of the whole world, which a JavaScript
 * engine refuses past 512 MiB: the open world's table weighed 866 MiB as JSON. A record is read at
 * its rank when asked, as a page is viewed in its bundle; only the bundles, a few thousand, are
 * read whole. A file that breaks its contract is refused whole, `INVALID_CACHE`.
 */
import { NO_INDEX } from '../../../math/src/constants.ts'
import { uint64FromWords } from '../../../math/src/scalar/uint64.ts'
import { hexOfBytes } from '../../../math/src/scalar/hex.ts'
import { wordsOf } from '../runtime/ownBuffer.ts'
import type { ClusterGroup, CullingHierarchy } from '../contracts/geometry.ts'
import {
  CHAIN_ACTOR,
  WORLD_ROOTS_BIN,
  refuseWorldRoots,
  type WorldRoots,
  type WorldRootsCluster,
  type WorldRootsPageFacts,
} from './worldRoots.ts'
// The products' version this reader knows, the compiler's: another is refused. A culling node is
// `CULLING_STRIDE` `f64` (`page-codec-wasm/src/culling.rs`); an actor's row, `WORLD_ROOTS_ROW_BYTES`
// bytes (`hlod/chain/builds/instanced.rs`).
import {
  CULLING_STRIDE,
  WORLD_ROOTS_ROW_BYTES,
  WORLD_ROOTS_VERSION,
} from '../contracts/writtenFormats.ts'

/** The versions this reader reads: the compiler's, and 36, laid out the same (37 only adds the
 *  fallback meshes an instanced layer without cluster DAG names). */
const WORLD_ROOTS_READABLE_VERSIONS: readonly number[] = [36, WORLD_ROOTS_VERSION]

/** Bytes of each header and record (`records.rs`, `dag_records.rs`). */
const [TABLE_HEADER, BUNDLE, PAGE, HLOD_CELL] = [64, 56, 24, 124]
/** Where a row's track and matrix lie, after its mesh: a row is its mesh's rank, the item of the
 *  animation banks it plays (`NO_INDEX` for none), then sixteen `f64` of its world matrix. */
const ROW_TRACK = 4,
  ROW_MATRIX = 8
const [DAG_HEADER, CLUSTER, GROUP, NODE] = [24, 188, 64, CULLING_STRIDE * 8]

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
    refuseWorldRoots(`not a ${magic} file`)
  if (!WORLD_ROOTS_READABLE_VERSIONS.includes(word(4))) refuseWorldRoots(`version ${word(4)}`)
  const at = poolAt(word)
  // Aligned it is viewed in place; a caller's unaligned view is copied once.
  const pool = wordsOf(bytes, at)
  /** The list a record names at `at`: its first word and its length, inside the pool. */
  const list = (at: number) => {
    const first = word(at),
      count = word(at + 4)
    if (first + count > pool.length) refuseWorldRoots(`a list at ${at} past the pool`)
    return pool.subarray(first, first + count)
  }
  return { view, word, pool, list }
}

const below = (values: Uint32Array, end: number) => values.every((value) => value < end)

/** A record's word as an index, `-1` for the word that names nothing (`NO_INDEX`). */
const indexOf = (word: number) => (word === NO_INDEX ? -1 : word)

type Opened = ReturnType<typeof opened>

/** The table's bundles, each laid where the last ended from the binary's start and naming only
 *  bundles of the table, and the end of the last. */
function tableBundles(bytes: Uint8Array, { word, list }: Opened, count: number) {
  let end = 0
  const bundles = Array.from({ length: count }, (_, rank) => {
    const at = TABLE_HEADER + rank * BUNDLE,
      dependencies = list(at + 16)
    if (uint64FromWords(word(at), word(at + 4)) !== end)
      refuseWorldRoots(`bundle ${rank} is not the next range`)
    if (!below(dependencies, count)) refuseWorldRoots(`bundle ${rank} dependencies`)
    const offset = end
    end += word(at + 8)
    const sha256 = hexOfBytes(bytes.subarray(at + 24, at + BUNDLE))
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

/** The columns the HLOD chain is read into, one entry a cell. */
const newChain = (hlodCount: number) => ({
  parent: new Int32Array(hlodCount),
  level: new Uint8Array(hlodCount),
  actorLevel: new Uint16Array(hlodCount),
  grid: new Uint16Array(hlodCount),
  rung: new Uint8Array(hlodCount),
  actor: new Uint8Array(hlodCount),
  bounds: new Float64Array(6 * hlodCount),
  content: new Float64Array(6 * hlodCount),
})

/** What reading a cell needs: the table, where its cells start, and the columns it fills. */
interface HlodRead {
  file: Opened
  hlodAt: number
  bundleCount: number
  hlodCount: number
  bundles: ReturnType<typeof tableBundles>['bundles']
  chain: ReturnType<typeof newChain>
  rows: { bundle: Int32Array; count: Uint32Array }
}

/** The HLOD cell `cell`: its bundles are returned, its chain entry and its rows are filled in. */
function readHlodCell(
  cell: number,
  { file, hlodAt, bundleCount, hlodCount, bundles, chain, rows }: HlodRead,
) {
  const { word, list } = file
  const at = hlodAt + cell * HLOD_CELL,
    held = list(at)
  if (!below(held, bundleCount)) refuseWorldRoots(`HLOD cell ${cell} bundles`)
  // Its actor's rows: one of its bundles, `WORLD_ROOTS_ROW_BYTES` a row (`records.rs`), or none.
  const own = word(at + 20)
  rows.bundle[cell] = indexOf(own)
  rows.count[cell] = word(at + 24)
  const sized = own === NO_INDEX ? rows.count[cell] === 0 : held.includes(own)
  if (
    !sized ||
    (own !== NO_INDEX && bundles[own].bytes !== rows.count[cell] * WORLD_ROOTS_ROW_BYTES)
  )
    refuseWorldRoots(`HLOD cell ${cell} rows`)
  // The level in the low 8 bits, whether its actor asks a warm-up in the next bit, the level of
  // its cell on its grid in the next 7, the grid in the high 16, then its actor's HLOD level
  // (`records.rs`); an actor built is one whose bundles hold roots or that places rows.
  const parent = word(at + 8),
    level = word(at + 12) & 0xff,
    warmup = (word(at + 12) >>> 8) & 1,
    grid = word(at + 12) >>> 16
  chain.rung[cell] = (word(at + 12) >>> 9) & 0x7f
  // A cell's actor lies in a cell of a coarser grid, after it in the chain.
  if (parent !== NO_INDEX && (parent <= cell || parent >= hlodCount))
    refuseWorldRoots(`HLOD cell ${cell} parent`)
  chain.parent[cell] = indexOf(parent)
  chain.level[cell] = level
  chain.actorLevel[cell] = word(at + 16)
  chain.grid[cell] = grid
  const built = held.length > 0 || rows.count[cell] > 0
  chain.actor[cell] = built ? CHAIN_ACTOR.built | (warmup && CHAIN_ACTOR.warmup) : 0
  for (let k = 0; k < 6; k++) {
    chain.bounds[6 * cell + k] = file.view.getFloat64(at + 28 + 8 * k, true)
    chain.content[6 * cell + k] = file.view.getFloat64(at + 76 + 8 * k, true)
  }
  return [...held]
}

/**
 * `bytes` as a world-roots table, or `INVALID_CACHE`: its magic and version, its records filling
 * it, its bundles laid end to end from the binary's start, and every bundle an HLOD cell or a
 * dependency names one of the table.
 */
export function readWorldRoots(bytes: Uint8Array): WorldRoots {
  const file = opened(bytes, 'WRTB', TABLE_HEADER, (w) => {
    const records = w(8) * BUNDLE + w(12) * PAGE + w(16) * HLOD_CELL
    if (TABLE_HEADER + records + w(20) * 4 !== bytes.byteLength) refuseWorldRoots('table length')
    return TABLE_HEADER + records
  })
  const { word } = file
  const [bundleCount, pageCount, hlodCount] = [8, 12, 16].map(word)
  const pagesAt = TABLE_HEADER + bundleCount * BUNDLE,
    hlodAt = pagesAt + pageCount * PAGE
  const { bundles, end } = tableBundles(bytes, file, bundleCount)
  const payloadBytes = uint64FromWords(word(24), word(28))
  if (payloadBytes !== end) refuseWorldRoots('payload')
  const chain = newChain(hlodCount)
  const rows = { bundle: new Int32Array(hlodCount), count: new Uint32Array(hlodCount) }
  const read = { file, hlodAt, bundleCount, hlodCount, bundles, chain, rows }
  const hlod = Array.from({ length: hlodCount }, (_, cell) => readHlodCell(cell, read))
  return {
    version: WORLD_ROOTS_VERSION,
    payload: {
      url: WORLD_ROOTS_BIN,
      sha256: hexOfBytes(bytes.subarray(32, 64)),
      bytes: payloadBytes,
    },
    bundles,
    pages: tablePages(file, pagesAt, pageCount),
    hlod,
    chain,
    rows,
  }
}

/**
 * The `count` rows of an actor its rows bundle's `bytes` hold (`WorldRoots.rows`), read as its
 * cell holds it, or `INVALID_CACHE` for bytes of another length: each its mesh's rank (`mesh`),
 * the item of the scene's animation banks it plays (`track`, -1 for none: an instanced skinned
 * object marked to stand as itself, its matrix then its skin frame's world), and its world matrix
 * in the scene's frame, sixteen numbers from `16 · row` (`matrix`).
 */
export function actorRows(bytes: Uint8Array, count: number) {
  if (bytes.byteLength !== count * WORLD_ROOTS_ROW_BYTES)
    refuseWorldRoots(`${count} rows in ${bytes.length}`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const mesh = new Uint32Array(count),
    track = new Int32Array(count),
    matrix = new Float64Array(16 * count)
  for (let row = 0; row < count; row++) {
    const byte = row * WORLD_ROOTS_ROW_BYTES
    mesh[row] = view.getUint32(byte, true)
    track[row] = indexOf(view.getUint32(byte + ROW_TRACK, true))
    for (let v = 0; v < 16; v++)
      matrix[16 * row + v] = view.getFloat64(byte + ROW_MATRIX + 8 * v, true)
  }
  return { mesh, track, matrix }
}

/** The page facts a cluster record holds at `at`. */
function pageFacts(view: DataView, at: number): WorldRootsPageFacts {
  const word = (k: number) => view.getUint32(at + k * 4, true)
  return {
    bytes: word(0),
    vertexCount: word(1),
    indexCount: word(2),
    flags: word(3),
    uncompressedBytes: word(4),
    residentBytes: word(5),
    residentOffset: word(6),
  }
}

/**
 * `bytes` as the world DAG, or `INVALID_CACHE`: every world cluster in the cook's rank, in the
 * shape the world stream reads (`WorldRootsCluster`), the group list, its children and outputs
 * naming clusters of the DAG, and the world's culling hierarchy, its nodes naming ranges of those
 * ranks (the cook ranks the clusters in its order, `chain/merge.rs`).
 */
export function readWorldRootsDag(bytes: Uint8Array) {
  const { view, word, list } = opened(bytes, 'WRTD', DAG_HEADER, (w) => {
    const records = DAG_HEADER + w(8) * CLUSTER + w(12) * GROUP + w(20) * NODE
    if (records + w(16) * 4 !== bytes.byteLength) refuseWorldRoots('DAG length')
    if (w(8) > 0 && w(20) === 0) refuseWorldRoots('a DAG without its culling hierarchy')
    return records
  })
  const clusterCount = word(8)
  const floats = (at: number, count: number) =>
    Array.from({ length: count }, (_, i) => view.getFloat64(at + i * 8, true))
  const clusters: WorldRootsCluster[] = Array.from({ length: clusterCount }, (_, cluster) => {
    const at = DAG_HEADER + cluster * CLUSTER,
      parentError = view.getFloat64(at + 40, true),
      parentSphere = floats(at + 80, 4)
    return {
      cluster,
      level: word(at),
      lodError: view.getFloat64(at + 32, true),
      sphere: floats(at + 48, 4),
      parentError: Number.isNaN(parentError) ? null : parentError,
      parentSphere: Number.isNaN(parentSphere[0]) ? null : parentSphere,
      min: floats(at + 112, 3),
      max: floats(at + 136, 3),
      triangles: word(at + 4),
      material: word(at + 8),
      bundle: word(at + 12),
      offset: word(at + 16),
      hlod: word(at + 20),
      page: pageFacts(view, at + 160),
    }
  })
  const groupsAt = DAG_HEADER + clusterCount * CLUSTER
  const groups: ClusterGroup[] = Array.from({ length: word(12) }, (_, group) => {
    const at = groupsAt + group * GROUP
    const [children, outputs] = [list(at + 4), list(at + 12)]
    if (!below(children, clusterCount) || !below(outputs, clusterCount))
      refuseWorldRoots(`group ${group}`)
    const [error, ...sphere] = floats(at + 24, 5)
    return { level: word(at), error, sphere, children: [...children], outputs: [...outputs] }
  })
  const nodesAt = groupsAt + word(12) * GROUP,
    count = word(20)
  const culling: CullingHierarchy = {
    stride: CULLING_STRIDE,
    count,
    nodes: floats(nodesAt, count * CULLING_STRIDE),
  }
  return { clusters, groups, culling }
}
