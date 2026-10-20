/**
 * The world HLOD's records (docs/FORMAT.md, World HLOD): `world-roots.table` and
 * `world-roots.dag`, read straight from their bytes, as the cook writes them
 * (`compiler_world_roots/records.rs`). Never one string of the whole world, which a JavaScript
 * engine refuses past 512 MiB: the open world's table weighed 866 MiB as JSON. A record is read at
 * its rank when asked, as a page is viewed in its bundle; only the bundles, a few thousand, are
 * read whole. A file that breaks its contract is refused whole, `INVALID_CACHE`.
 */
import { uint64FromWords } from '../../../math/src/scalar/uint64.ts'
import { hexOfBytes } from '../../../math/src/scalar/hex.ts'
import type { ClusterGroup, CullingHierarchy } from '../contracts/geometry.ts'
import {
  CHAIN_ACTOR,
  WORLD_ROOTS_BIN,
  refuseWorldRoots,
  type WorldRoots,
  type WorldRootsCluster,
  type WorldRootsPageFacts,
} from './worldRoots.ts'
// The products' version this reader knows, the compiler's: another is refused.
import { WORLD_ROOTS_VERSION } from '../contracts/writtenFormats.ts'

/** Bytes of each header and record (`records.rs`, `dag_records.rs`). */
const [TABLE_HEADER, BUNDLE, PAGE, HLOD_CELL] = [64, 56, 24, 64]
const [DAG_HEADER, CLUSTER, GROUP, NODE] = [24, 184, 64, 120]
/** Numbers per culling node (`page-codec-wasm/src/culling.rs`, `CULLING_STRIDE`). */
const NODE_STRIDE = 15

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
  if (word(4) !== WORLD_ROOTS_VERSION) refuseWorldRoots(`version ${word(4)}`)
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
    if (first + count > pool.length) refuseWorldRoots(`a list at ${at} past the pool`)
    return pool.subarray(first, first + count)
  }
  return { view, word, pool, list }
}

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
  const { word, list } = file
  const [bundleCount, pageCount, hlodCount] = [8, 12, 16].map(word)
  const pagesAt = TABLE_HEADER + bundleCount * BUNDLE,
    hlodAt = pagesAt + pageCount * PAGE
  const { bundles, end } = tableBundles(bytes, file, bundleCount)
  const payloadBytes = uint64FromWords(word(24), word(28))
  if (payloadBytes !== end) refuseWorldRoots('payload')
  const chain = {
    parent: new Int32Array(hlodCount),
    level: new Uint8Array(hlodCount),
    actor: new Uint8Array(hlodCount),
    bounds: new Float64Array(6 * hlodCount),
  }
  const hlod = Array.from({ length: hlodCount }, (_, cell) => {
    const at = hlodAt + cell * HLOD_CELL,
      held = list(at)
    if (!below(held, bundleCount)) refuseWorldRoots(`HLOD cell ${cell} bundles`)
    // The level in the low 16 bits, whether its actor's build failed in the high 16 (`records.rs`);
    // an actor built is one whose bundles hold roots.
    const parent = word(at + 8),
      level = word(at + 12) & 0xffff,
      failed = (word(at + 12) >>> 16) & 1
    const actor = (held.length ? CHAIN_ACTOR.built : 0) | (failed ? CHAIN_ACTOR.failed : 0)
    // A cell's next level's actor lies in a cell of the next level, after it in the chain.
    if (parent !== 0xffffffff && (parent <= cell || parent >= hlodCount))
      refuseWorldRoots(`HLOD cell ${cell} parent`)
    chain.parent[cell] = parent === 0xffffffff ? -1 : parent
    chain.level[cell] = level
    chain.actor[cell] = actor
    for (let k = 0; k < 6; k++)
      chain.bounds[6 * cell + k] = file.view.getFloat64(at + 16 + 8 * k, true)
    return [...held]
  })
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
  }
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
    quantizationError: view.getFloat32(at + 20, true),
  }
}

/**
 * `bytes` as the world DAG, or `INVALID_CACHE`: every world cluster in the cook's rank, in the
 * shape the world stream reads (`WorldRootsCluster`), the group list, its children and outputs
 * naming clusters of the DAG, and the world's culling hierarchy, its nodes naming ranges of those
 * ranks (the cook ranks the clusters in its order, `compiler_world_roots/merge.rs`).
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
    stride: NODE_STRIDE,
    count,
    nodes: floats(nodesAt, count * NODE_STRIDE),
  }
  return { clusters, groups, culling }
}
