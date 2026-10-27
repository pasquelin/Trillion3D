import { EngineError } from '../contracts/cache.ts'
import { assertSidecarSection, checkSidecarHead } from '../contracts/sidecarSection.ts'
import { wordsOf } from '../runtime/ownBuffer.ts'
import {
  RAY_TRACING_FLAG_MASKED,
  RAY_TRACING_FLAG_TRANSLUCENT,
  RAY_TRACING_FLAG_TWO_SIDED,
  RAY_TRACING_HEAD_BYTES,
  RAY_TRACING_MAGIC,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_RECORD_BYTES,
  RAY_TRACING_TRIANGLE_BYTES,
  RAY_TRACING_VERSION,
} from '../contracts/rayTracingAbi.ts'

/**
 * The ray tracing file, as the compiler writes it (`rayTracing.bin`): for each compiled primitive,
 * one acceleration structure over a coarse cut of its cluster DAG, in the primitive's object space,
 * metres. The file is its head, its records, then all the nodes, then all the triangles; the reader
 * keeps them as the words the GPU reads (`sceneTrace/`, `../../../sdk-browser/src/lighting/rays/`):
 *
 * - a record (`RAY_TRACING_RECORD_WORDS` words) names its primitive (its compiled mesh and its
 *   number in the mesh), its flags, the error of the cut it was built over, where its nodes and its
 *   triangles lie in the file's tables, and the box of its triangles;
 * - a node (`RAY_TRACING_NODE_WORDS` words) is a compressed node of eight children: a corner, an
 *   exponent a side, a mask of the children that are nodes, where those and the triangles of the
 *   others begin, and for each child its meta byte and its box quantised to a byte a side;
 * - a triangle (`RAY_TRACING_TRIANGLE_WORDS` words) is its three corners (`f32`), then the cluster
 *   it comes from and its rank in that cluster.
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
}

const refuse = (why: string): never => {
  throw new EngineError('INVALID_CACHE', `ray tracing: ${why}`, {})
}

/** The flag bits a record may carry. */
const KNOWN_FLAGS =
  RAY_TRACING_FLAG_TWO_SIDED | RAY_TRACING_FLAG_MASKED | RAY_TRACING_FLAG_TRANSLUCENT

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

/**
 * Reads the file `bytes` hold, or throws `INVALID_CACHE`; a file of another version throws
 * `UNSUPPORTED_FORMAT`. The file must be its head, its records, its nodes and its triangles, no
 * more: each record's nodes and triangles follow the previous record's.
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
  let nextNode = 0
  let nextTriangle = 0
  for (let r = 0; r < recordCount; r++) {
    const at = r * RAY_TRACING_RECORD_WORDS
    const [mesh, primitive] = [records[at + A.mesh], records[at + A.primitive]]
    const meshRecords = byPrimitive.get(mesh) ?? new Map<number, number>()
    if (meshRecords.has(primitive)) refuse(`primitive ${mesh}/${primitive} twice`)
    byPrimitive.set(mesh, meshRecords.set(primitive, r))
    if ((records[at + A.flags] & ~KNOWN_FLAGS) !== 0)
      refuse(`a record with flags ${records[at + A.flags]}`)
    if (!Number.isFinite(floats[at + A.error]) || floats[at + A.error] < 0)
      refuse(`record ${r} has an error that is not a length`)
    if (!finiteBox(floats, at + A.boxMin)) refuse(`record ${r} has a box that is not a box`)
    const [firstNode, count] = [records[at + A.firstNode], records[at + A.nodeCount]]
    const [firstTriangle, held] = [records[at + A.firstTriangle], records[at + A.triangleCount]]
    if (firstNode !== nextNode || firstNode + count > nodeCount)
      refuse('nodes out of the order of their records')
    if (firstTriangle !== nextTriangle || firstTriangle + held > triangleCount)
      refuse('triangles out of the order of their records')
    nextNode = firstNode + count
    nextTriangle = firstTriangle + held
  }
  if (nextNode !== nodeCount) refuse('nodes that no record holds')
  if (nextTriangle !== triangleCount) refuse('triangles that no record holds')
  return { records, nodes, triangles, byPrimitive }
}
