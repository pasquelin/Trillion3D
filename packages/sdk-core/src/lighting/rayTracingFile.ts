import { EngineError } from '../contracts/cache.ts'
import { assertSidecarSection, checkSidecarHead } from '../contracts/sidecarSection.ts'
import { wordsOf } from '../runtime/ownBuffer.ts'
import {
  RAY_TRACING_FLAG_ALL_TRANSLUCENT,
  RAY_TRACING_FLAG_MASKED,
  RAY_TRACING_FLAG_TRANSLUCENT,
  RAY_TRACING_FLAG_ACTOR,
  RAY_TRACING_FLAG_TWO_SIDED,
  RAY_TRACING_FLAG_WORLD,
  RAY_TRACING_HEAD_BYTES,
  RAY_TRACING_MAGIC,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_NO_PRIMITIVE,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_RECORD_BYTES,
  RAY_TRACING_TRIANGLE_AT,
  RAY_TRACING_TRIANGLE_BYTES,
  RAY_TRACING_VERSION,
} from '../contracts/rayTracingAbi.ts'

/**
 * The ray tracing file, as the compiler writes it (`rayTracing.bin`): for each compiled primitive,
 * one acceleration structure over a coarse cut of its cluster DAG, in the primitive's object space,
 * metres, and, last, the world's: a structure for each HLOD actor over the cut of its DAG, in the
 * world's space (`RAY_TRACING_FLAG_ACTOR`; it names no primitive but the HLOD cell that shows it),
 * then the directory of the actors (`RAY_TRACING_FLAG_WORLD`), a structure over their boxes whose
 * entries stand where triangles do. The file is its head, its records, then all the
 * nodes, then all the triangles; the reader
 * keeps them as the words the GPU reads (`sceneTrace/`, `../../../sdk-browser/src/lighting/rays/`):
 *
 * - a record (`RAY_TRACING_RECORD_WORDS` words) names its primitive (its compiled mesh and its
 *   number in the mesh), its flags, the error of the cut it was built over, where its nodes and its
 *   triangles lie in the file's tables, the box of its triangles and, an actor's, its HLOD cell;
 * - a node (`RAY_TRACING_NODE_WORDS` words) is a compressed node of eight children: a corner, an
 *   exponent a side, a mask of the children that are nodes, where those and the triangles of the
 *   others begin, and for each child its meta byte and its box quantised to a byte a side;
 * - a triangle (`RAY_TRACING_TRIANGLE_WORDS` words) is its three corners (`f32`), then the cluster
 *   it comes from, its rank in that cluster and its tag, a zero word but in the directory's entries.
 *
 * A record's nodes are consecutive, its root the first; the links of a node (`childBase`,
 * `triangleBase`) count from its record's first node and first triangle. The reader checks the head
 * and the records, not the nodes: a link out of its record reads another's words, and the GPU
 * bounds every access to the buffers.
 */

/** Words of a record, of a node and of a triangle. */
export const RAY_TRACING_RECORD_WORDS = RAY_TRACING_RECORD_BYTES / 4
const RAY_TRACING_NODE_WORDS = RAY_TRACING_NODE_BYTES / 4
const RAY_TRACING_TRIANGLE_WORDS = RAY_TRACING_TRIANGLE_BYTES / 4

/** The ray tracing file, as the words the GPU reads. */
export interface RayTracing {
  /** `RAY_TRACING_RECORD_WORDS` words a record, in the file's order. */
  readonly records: Uint32Array
  /** `RAY_TRACING_NODE_WORDS` words a node, every record's nodes one after the other. */
  readonly nodes: Uint32Array
  /** `RAY_TRACING_TRIANGLE_WORDS` words a triangle, every record's one after the other. */
  readonly triangles: Uint32Array
  /** The record of each primitive, by its compiled mesh and its number in the mesh (the two
   *  numbers `ClusterRoot.mesh` and `ClusterRoot.primitive` name it by). */
  readonly byPrimitive: ReadonlyMap<number, ReadonlyMap<number, number>>
  /** The record of the directory of the world's HLOD actors, when the scene has any: the actors'
   *  records are the ones just before it, as many as the directory has entries. */
  readonly world?: number
  /** The HLOD cells the actors' cell words name: one past the largest cell an entry of the directory holds (the cell word
   *  the trace reads at `tag`), zero without a directory. A cut that packs fewer cells has no word for the largest. */
  readonly actorCells: number
}

const refuse = (why: string): never => {
  throw new EngineError('INVALID_CACHE', `ray tracing: ${why}`, {})
}

/** The flag bits a record may carry. */
const KNOWN_FLAGS =
  RAY_TRACING_FLAG_TWO_SIDED |
  RAY_TRACING_FLAG_MASKED |
  RAY_TRACING_FLAG_TRANSLUCENT |
  RAY_TRACING_FLAG_WORLD |
  RAY_TRACING_FLAG_ACTOR |
  RAY_TRACING_FLAG_ALL_TRANSLUCENT

/**
 * The manifest's `rayTracing` section, or undefined when the cache has none (a scene whose
 * primitives built none writes neither the section nor the file); a section of another version
 * throws `UNSUPPORTED_FORMAT`, one that names no file `INVALID_CACHE`.
 */
export const assertRayTracingSection = (section: unknown) =>
  assertSidecarSection(section, RAY_TRACING_VERSION, 'ray tracing')

/** Whether the six floats from word `at` of `words` are finite and a box: low corner under high. */
function finiteBox(words: Float32Array, at: number) {
  for (let k = 0; k < 6; k++) if (!Number.isFinite(words[at + k])) return false
  return [0, 1, 2].every((axis) => words[at + axis] <= words[at + 3 + axis])
}

/** What a record is: a primitive's, an HLOD actor's, or the world's directory of the actors. */
type RecordKind = 'primitive' | 'actor' | 'directory'

/** The kind of record `r` of `records`, refused when its flags are not the kind's: the directory has the world's flag
 *  and no other, only an actor's record names an HLOD cell, and an actor translucent is flagged translucent whole. */
function kindOf(records: Uint32Array, r: number): RecordKind {
  const at = r * RAY_TRACING_RECORD_WORDS
  const flags = records[at + RAY_TRACING_RECORD_AT.flags]
  if ((flags & ~KNOWN_FLAGS) !== 0) refuse(`a record with flags ${flags}`)
  const [directory, actor] = [
    (flags & RAY_TRACING_FLAG_WORLD) !== 0,
    (flags & RAY_TRACING_FLAG_ACTOR) !== 0,
  ]
  if (directory && actor) refuse(`record ${r} is the world's directory and an actor's`)
  if (directory && flags !== RAY_TRACING_FLAG_WORLD)
    refuse(`the world's directory ${r} has flags ${flags}, not the world's alone`)
  const [whole, translucent] = [
    (flags & RAY_TRACING_FLAG_ALL_TRANSLUCENT) !== 0,
    (flags & RAY_TRACING_FLAG_TRANSLUCENT) !== 0,
  ]
  if (whole && !translucent) refuse(`record ${r} is translucent whole and not translucent`)
  if (actor && translucent && !whole)
    refuse(`the actor's record ${r} is translucent and not flagged translucent whole`)
  if (!actor && records[at + RAY_TRACING_RECORD_AT.cell] !== 0)
    refuse(`record ${r} names an HLOD cell and is no actor's`)
  return directory ? 'directory' : actor ? 'actor' : 'primitive'
}

/** The records `held` of the primitives of mesh `mesh` are flagged translucent whole all or none: all when
 *  every one of them is translucent. */
function checkWholeTranslucent(
  records: Uint32Array,
  mesh: number,
  held: ReadonlyMap<number, number>,
) {
  const flagsOf = (r: number) => records[r * RAY_TRACING_RECORD_WORDS + RAY_TRACING_RECORD_AT.flags]
  const all = [...held.values()].every((r) => (flagsOf(r) & RAY_TRACING_FLAG_TRANSLUCENT) !== 0)
  for (const r of held.values())
    if (((flagsOf(r) & RAY_TRACING_FLAG_ALL_TRANSLUCENT) !== 0) !== all)
      refuse(`record ${r} of mesh ${mesh} is ${all ? 'not ' : ''}flagged translucent whole`)
}

/** Record `r` as a measure of a tree: a length for an error, a box for its triangles, its nodes and its triangles the
 *  ones that follow the previous record's (`next`, which it moves on) within the file's tables. */
function checkTree(
  records: Uint32Array,
  floats: Float32Array,
  r: number,
  next: { node: number; triangle: number },
  totals: { nodes: number; triangles: number },
) {
  const A = RAY_TRACING_RECORD_AT
  const at = r * RAY_TRACING_RECORD_WORDS
  if (!Number.isFinite(floats[at + A.error]) || floats[at + A.error] < 0)
    refuse(`record ${r} has an error that is not a length`)
  if (!finiteBox(floats, at + A.boxMin)) refuse(`record ${r} has a box that is not a box`)
  const [firstNode, count] = [records[at + A.firstNode], records[at + A.nodeCount]]
  const [firstTriangle, held] = [records[at + A.firstTriangle], records[at + A.triangleCount]]
  if (firstNode !== next.node || firstNode + count > totals.nodes)
    refuse('nodes out of the order of their records')
  if (firstTriangle !== next.triangle || firstTriangle + held > totals.triangles)
    refuse('triangles out of the order of their records')
  next.node = firstNode + count
  next.triangle = firstTriangle + held
}

/** Each entry of the directory `world` must name an actor's record among those just before it, and that actor's HLOD
 *  cell. Returns one past the largest of those cells. */
function checkDirectory(records: Uint32Array, triangles: Uint32Array, world: number) {
  const A = RAY_TRACING_RECORD_AT
  const entries = records[world * RAY_TRACING_RECORD_WORDS + A.triangleCount]
  const entriesAt = records[world * RAY_TRACING_RECORD_WORDS + A.firstTriangle]
  let cells = 0
  for (let k = 0; k < entries; k++) {
    const entry = (entriesAt + k) * RAY_TRACING_TRIANGLE_WORDS
    const [actor, cell] = [
      triangles[entry + RAY_TRACING_TRIANGLE_AT.cluster],
      triangles[entry + RAY_TRACING_TRIANGLE_AT.tag],
    ]
    if (actor >= entries)
      refuse(`the directory's entry ${k} names the actor ${actor} of ${entries}`)
    if (cell !== records[(world - entries + actor) * RAY_TRACING_RECORD_WORDS + A.cell])
      refuse(`the directory's entry ${k} names the cell ${cell}, not its actor's`)
    cells = Math.max(cells, cell + 1)
  }
  return cells
}

/**
 * Reads the file `bytes` hold, or throws `INVALID_CACHE`; a file of another version throws
 * `UNSUPPORTED_FORMAT`. The file must be its head, its records, its nodes and its triangles, no
 * more: each record's nodes and triangles follow the previous record's. A record has the flags of
 * its kind: the world's directory the world's alone, and a zero cell word but an actor's. A record
 * is flagged translucent whole (`RAY_TRACING_FLAG_ALL_TRANSLUCENT`) when it is translucent and
 * every primitive of its mesh is (an actor being a mesh of one material). Each entry
 * of the world's directory must name an actor's record among those just before it, and that actor's
 * HLOD cell.
 */
export function parseRayTracing(bytes: Uint8Array): RayTracing {
  checkSidecarHead(bytes, {
    magic: RAY_TRACING_MAGIC,
    version: RAY_TRACING_VERSION,
    headBytes: RAY_TRACING_HEAD_BYTES,
    what: 'ray tracing',
  })
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const recordCount = view.getUint32(8, true)
  const nodeCount = view.getUint32(12, true)
  const triangleCount = view.getUint32(16, true)
  const nodesAt = RAY_TRACING_HEAD_BYTES + recordCount * RAY_TRACING_RECORD_BYTES
  const trianglesAt = nodesAt + nodeCount * RAY_TRACING_NODE_BYTES
  if (trianglesAt + triangleCount * RAY_TRACING_TRIANGLE_BYTES !== bytes.byteLength)
    refuse('not its head, its records, its nodes and its triangles')
  const records = wordsOf(bytes, RAY_TRACING_HEAD_BYTES, recordCount * RAY_TRACING_RECORD_WORDS)
  const nodes = wordsOf(bytes, nodesAt, nodeCount * RAY_TRACING_NODE_WORDS)
  const triangles = wordsOf(bytes, trianglesAt, triangleCount * RAY_TRACING_TRIANGLE_WORDS)
  const floats = new Float32Array(records.buffer, records.byteOffset, records.length)
  const A = RAY_TRACING_RECORD_AT
  const byPrimitive = new Map<number, Map<number, number>>()
  let world: number | undefined
  const actors: number[] = []
  const next = { node: 0, triangle: 0 }
  for (let r = 0; r < recordCount; r++) {
    const at = r * RAY_TRACING_RECORD_WORDS
    const [mesh, primitive] = [records[at + A.mesh], records[at + A.primitive]]
    const kind = kindOf(records, r)
    if (kind === 'primitive') {
      const meshRecords = byPrimitive.get(mesh) ?? new Map<number, number>()
      if (meshRecords.has(primitive)) refuse(`primitive ${mesh}/${primitive} twice`)
      byPrimitive.set(mesh, meshRecords.set(primitive, r))
    } else {
      if (mesh !== RAY_TRACING_NO_PRIMITIVE || primitive !== RAY_TRACING_NO_PRIMITIVE)
        refuse(`the world's record ${r} names a primitive`)
      if (kind === 'actor') actors.push(r)
      else if (world !== undefined) refuse('the world twice')
      else world = r
    }
    checkTree(records, floats, r, next, { nodes: nodeCount, triangles: triangleCount })
  }
  for (const [mesh, held] of byPrimitive) checkWholeTranslucent(records, mesh, held)
  if (next.node !== nodeCount) refuse('nodes that no record holds')
  // The actors' records are the ones just before the directory's, one for each of its entries.
  const entries =
    world === undefined ? 0 : records[world * RAY_TRACING_RECORD_WORDS + A.triangleCount]
  if (actors.length !== entries || actors.some((r, k) => r !== (world ?? 0) - entries + k))
    refuse("the actors' records are not the ones just before the world's directory")
  if (next.triangle !== triangleCount) refuse('triangles that no record holds')
  const actorCells = world === undefined ? 0 : checkDirectory(records, triangles, world)
  return { records, nodes, triangles, byPrimitive, world, actorCells }
}
