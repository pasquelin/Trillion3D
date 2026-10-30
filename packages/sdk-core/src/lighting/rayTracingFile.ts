import {
  assertSidecarSection,
  checkSidecarHead,
  sidecarRefusal,
  type SidecarRefusal,
} from '../contracts/sidecarSection.ts'
import { wordsOf } from '../runtime/ownBuffer.ts'
import {
  RAY_TRACING_CORNER_BYTES,
  RAY_TRACING_FLAG_MASK_SET,
  RAY_TRACING_FLAG_SKY,
  RAY_TRACING_MASK_CORNER_BYTES,
  RAY_TRACING_SECOND_SET_CORNER_BYTES,
  RAY_TRACING_SECOND_SET_VERSION,
  RAY_TRACING_FLAG_ALL_TRANSLUCENT,
  RAY_TRACING_FLAG_ATTRIBUTES,
  RAY_TRACING_FLAG_NORMALS,
  RAY_TRACING_FLAG_MASKED,
  RAY_TRACING_FLAG_TRANSLUCENT,
  RAY_TRACING_FLAG_ACTOR,
  RAY_TRACING_FLAG_TWO_SIDED,
  RAY_TRACING_FLAG_WORLD,
  RAY_TRACING_FLAT_VERSION,
  RAY_TRACING_HEAD_BYTES,
  RAY_TRACING_INDEXED_TRIANGLE_BYTES,
  RAY_TRACING_MAGIC,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_NO_PRIMITIVE,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_RECORD_BYTES,
  RAY_TRACING_TRIANGLE_AT,
  RAY_TRACING_TRIANGLE_BYTES,
  RAY_TRACING_VERSION,
  RAY_TRACING_VERTEX_BYTES,
} from '../contracts/rayTracingAbi.ts'

/**
 * The ray tracing file, as the compiler writes it (`rayTracing.bin`): for each compiled primitive,
 * one acceleration structure over a coarse cut of its cluster DAG, in the primitive's object space,
 * metres, and, last, the world's: a structure for each HLOD actor over the cut of its DAG, in the
 * world's space (`RAY_TRACING_FLAG_ACTOR`; it names no primitive but the HLOD cell that shows it),
 * then the directory of the actors (`RAY_TRACING_FLAG_WORLD`), a structure over their boxes whose
 * entries stand where triangles do. The file is its head, its records, then all the
 * nodes, then the vertices, each corner once, then all the triangles, each naming its corners
 * among the vertices by how far back they lie from the next (`cornered`; the flat format, `RAY_TRACING_FLAT_VERSION`, has no vertices: its
 * triangles hold their corners); the reader
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
/** Words of a corner's attributes. */
export const RAY_TRACING_CORNER_WORDS = RAY_TRACING_CORNER_BYTES / 4
/** Words of a corner's cutout coordinate. */
export const RAY_TRACING_MASK_CORNER_WORDS = RAY_TRACING_MASK_CORNER_BYTES / 4
const RAY_TRACING_VERTEX_WORDS = RAY_TRACING_VERTEX_BYTES / 4
const RAY_TRACING_INDEXED_TRIANGLE_WORDS = RAY_TRACING_INDEXED_TRIANGLE_BYTES / 4
/** The formats this engine reads, the first and the last (the flat one to the current one; the one with the second texture set in every corner, `RAY_TRACING_SECOND_SET_VERSION`, has its second set dropped at the read). */
const RAY_TRACING_VERSIONS = [RAY_TRACING_FLAT_VERSION, RAY_TRACING_VERSION] as const

/** The ray tracing file, as the words the GPU reads. */
export interface RayTracing {
  /** `RAY_TRACING_RECORD_WORDS` words a record, in the file's order. */
  readonly records: Uint32Array
  /** `RAY_TRACING_NODE_WORDS` words a node, every record's nodes one after the other. */
  readonly nodes: Uint32Array
  /** `RAY_TRACING_TRIANGLE_WORDS` words a triangle, every record's one after the other. */
  readonly triangles: Uint32Array
  /** `RAY_TRACING_CORNER_WORDS` words a corner, three corners a triangle in the triangles' order (`RAY_TRACING_CORNER_AT`): the attributes a hit shades with; empty for a file without them. */
  readonly corners: Uint32Array
  /** `RAY_TRACING_MASK_CORNER_WORDS` words a corner, three corners a triangle of the records whose flags name a mask set (`RAY_TRACING_FLAG_MASK_SET`), in the triangles' order: the coordinate of the set the record's alpha mask reads; a record's first triangle in it is its `RAY_TRACING_RECORD_AT.maskTriangle`. */
  readonly maskCorners: Uint32Array
  /** The record of each primitive, by its compiled mesh and its number in the mesh (the two
   *  numbers `ClusterRoot.mesh` and `ClusterRoot.primitive` name it by). */
  readonly byPrimitive: ReadonlyMap<number, ReadonlyMap<number, number>>
  /** The record of the directory of the world's HLOD actors, when the scene has any: the actors'
   *  records are the ones just before it, as many as the directory has entries. */
  readonly world?: number
  /** The HLOD cells the actors' cell words name: one past the largest cell an entry of the directory holds (the cell word
   *  the trace reads at `tag`), zero without a directory. A cut that packs fewer cells has no word for the largest. */
  readonly actorCells: number
  /** The materials the actors wear: one past the largest rank an actor's record names where a primitive's number is (the rank its clusters name, `hlodMaterials`), zero when none names one. The scene trace keeps the cutout words of each. */
  readonly actorRanks: number
}

/** The largest count of materials the actors may name: a rank past it is a file refused, not a table of that many words. */
const MAX_ACTOR_RANKS = 1 << 20

const refuse: SidecarRefusal = sidecarRefusal('ray tracing')

/** The flag bits a record may carry. */
const KNOWN_FLAGS =
  RAY_TRACING_FLAG_TWO_SIDED |
  RAY_TRACING_FLAG_MASKED |
  RAY_TRACING_FLAG_TRANSLUCENT |
  RAY_TRACING_FLAG_WORLD |
  RAY_TRACING_FLAG_ACTOR |
  RAY_TRACING_FLAG_ALL_TRANSLUCENT |
  RAY_TRACING_FLAG_ATTRIBUTES |
  RAY_TRACING_FLAG_NORMALS |
  RAY_TRACING_FLAG_MASK_SET |
  RAY_TRACING_FLAG_SKY

/**
 * The manifest's `rayTracing` section, or undefined when the cache has none (a scene whose
 * primitives built none writes neither the section nor the file); a section of another version
 * throws `UNSUPPORTED_FORMAT`, one that names no file `INVALID_CACHE`.
 */
export const assertRayTracingSection = (section: unknown) =>
  assertSidecarSection(section, RAY_TRACING_VERSIONS, 'ray tracing')

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
  if ((flags & RAY_TRACING_FLAG_NORMALS) !== 0 && (flags & RAY_TRACING_FLAG_ATTRIBUTES) === 0)
    refuse(`record ${r} has corner normals and no corner attributes`)
  if ((flags & RAY_TRACING_FLAG_MASK_SET) !== 0 && (flags & RAY_TRACING_FLAG_ATTRIBUTES) === 0)
    refuse(`record ${r} names a mask set and has no corner attributes`)
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
  next: { node: number; triangle: number; mask: number },
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
  if ((records[at + A.flags]! & RAY_TRACING_FLAG_MASK_SET) !== 0) {
    if (records[at + A.maskTriangle] !== next.mask)
      refuse(`record ${r} has its cutout triangles out of the order of their records`)
    next.mask += held
  } else if (records[at + A.maskTriangle] !== 0)
    refuse(`record ${r} ranks a cutout and names no set`)
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

/** The `count` triangles `words` hold, laid out as the GPU reads them: each its three corners'
 *  words, then its last three words. A corner is written zero when it is the next of `vertices`,
 *  else as how far back it lies from the next. A corner before the first vertex, past the last,
 *  or vertices no triangle names throw `INVALID_CACHE`. */
function cornered(words: Uint32Array, vertices: Uint32Array, count: number) {
  const triangles = new Uint32Array(count * RAY_TRACING_TRIANGLE_WORDS)
  const held = vertices.length / RAY_TRACING_VERTEX_WORDS
  let next = 0
  for (let t = 0; t < count; t++) {
    const from = t * RAY_TRACING_INDEXED_TRIANGLE_WORDS
    let to = t * RAY_TRACING_TRIANGLE_WORDS
    for (let c = 0; c < 3; c++, to += RAY_TRACING_VERTEX_WORDS) {
      const back = words[from + c]
      if (back > next) refuse(`triangle ${t} names a vertex ${back} before the next, ${next}`)
      const v = back === 0 ? next++ : next - back
      if (v >= held) refuse(`triangle ${t} names the vertex ${v} of ${held}`)
      const at = v * RAY_TRACING_VERTEX_WORDS
      triangles[to] = vertices[at]
      triangles[to + 1] = vertices[at + 1]
      triangles[to + 2] = vertices[at + 2]
    }
    // Past its corners, the triangle's last three words (`RAY_TRACING_TRIANGLE_AT.cluster` on).
    triangles[to] = words[from + 3]
    triangles[to + 1] = words[from + 4]
    triangles[to + 2] = words[from + 5]
  }
  if (next !== held) refuse(`${held - next} vertices that no triangle names`)
  return triangles
}

/** The `count` triangles of the file `bytes` after its nodes, which end at byte `nodesEnd`, as the
 *  GPU reads them: held so in the flat format (`vertexCount` undefined), else laid out from the
 *  `vertexCount` vertices that come first (`cornered`). The file must end with them. */
function trianglesOf(
  bytes: Uint8Array,
  nodesEnd: number,
  count: number,
  vertexCount: number | undefined,
  cornerBytes: number,
) {
  const trianglesAt = nodesEnd + (vertexCount ?? 0) * RAY_TRACING_VERTEX_BYTES
  const each =
    vertexCount === undefined ? RAY_TRACING_TRIANGLE_BYTES : RAY_TRACING_INDEXED_TRIANGLE_BYTES
  if (trianglesAt + count * each + cornerBytes !== bytes.byteLength)
    refuse('not its head, its records, its nodes, its vertices, its triangles and its corners')
  const words = wordsOf(bytes, trianglesAt, (count * each) / 4)
  if (vertexCount === undefined) return words
  return cornered(words, wordsOf(bytes, nodesEnd, vertexCount * RAY_TRACING_VERTEX_WORDS), count)
}

/** The corners of a file of version `RAY_TRACING_SECOND_SET_VERSION` as the current ones: the attributes of each corner, the second set dropped. That
 *  file's records do not name the set their mask reads, and the data cannot say it (a mesh may hold a second set its material does not read), so no
 *  record is promoted to a set past the first: every mask reads the corners' own coordinate, the set the version before read it at. */
function withoutSecondSet(held: Uint32Array, cornerCount: number) {
  const each = RAY_TRACING_SECOND_SET_CORNER_BYTES / 4
  const corners = new Uint32Array(cornerCount * RAY_TRACING_CORNER_WORDS)
  for (let c = 0; c < cornerCount; c++)
    corners.set(
      held.subarray(c * each, c * each + RAY_TRACING_CORNER_WORDS),
      c * RAY_TRACING_CORNER_WORDS,
    )
  return corners
}

/**
 * Reads the file `bytes` hold, or throws `INVALID_CACHE`; a file of another version throws
 * `UNSUPPORTED_FORMAT`. The file must be its head, its records, its nodes, its vertices (none in
 * the flat format) and its triangles, no more, of the version `announced` names when it names one
 * (the manifest's section's); every vertex must be named by a triangle and every corner a triangle
 * names must be one of them. Each record's nodes and triangles follow the previous record's. A record has the flags of
 * its kind: the world's directory the world's alone, and a zero cell word but an actor's. A record
 * is flagged translucent whole (`RAY_TRACING_FLAG_ALL_TRANSLUCENT`) when it is translucent and
 * every primitive of its mesh is (an actor being a mesh of one material). Each entry
 * of the world's directory must name an actor's record among those just before it, and that actor's
 * HLOD cell.
 */
export function parseRayTracing(bytes: Uint8Array, announced?: number): RayTracing {
  const version = checkSidecarHead(bytes, {
    magic: RAY_TRACING_MAGIC,
    version: RAY_TRACING_VERSIONS,
    headBytes: RAY_TRACING_HEAD_BYTES,
    what: 'ray tracing',
  })
  if (announced !== undefined && version !== announced)
    refuse(`a file of version ${version}, its manifest's section of ${announced}`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const recordCount = view.getUint32(8, true)
  const nodeCount = view.getUint32(12, true)
  const triangleCount = view.getUint32(16, true)
  const vertexCount = version === RAY_TRACING_FLAT_VERSION ? undefined : view.getUint32(20, true)
  const cornerCount = version === RAY_TRACING_FLAT_VERSION ? 0 : view.getUint32(24, true)
  if (cornerCount !== 0 && cornerCount !== 3 * triangleCount)
    refuse(`${cornerCount} corners for ${triangleCount} triangles`)
  const nodesAt = RAY_TRACING_HEAD_BYTES + recordCount * RAY_TRACING_RECORD_BYTES
  const nodesEnd = nodesAt + nodeCount * RAY_TRACING_NODE_BYTES
  const second = version === RAY_TRACING_SECOND_SET_VERSION
  const cornerBytesEach = second ? RAY_TRACING_SECOND_SET_CORNER_BYTES : RAY_TRACING_CORNER_BYTES
  const maskCount = version === RAY_TRACING_VERSION ? view.getUint32(28, true) : 0
  if (maskCount % 3 !== 0 || (maskCount !== 0 && cornerCount === 0))
    refuse(`${maskCount} cutout corners for ${cornerCount} corners`)
  const tailBytes = cornerCount * cornerBytesEach + maskCount * RAY_TRACING_MASK_CORNER_BYTES
  const triangles = trianglesOf(bytes, nodesEnd, triangleCount, vertexCount, tailBytes)
  const records = wordsOf(bytes, RAY_TRACING_HEAD_BYTES, recordCount * RAY_TRACING_RECORD_WORDS)
  const nodes = wordsOf(bytes, nodesAt, nodeCount * RAY_TRACING_NODE_WORDS)
  const floats = new Float32Array(records.buffer, records.byteOffset, records.length)
  const A = RAY_TRACING_RECORD_AT
  const byPrimitive = new Map<number, Map<number, number>>()
  let world: number | undefined
  let actorRanks = 0
  const actors: number[] = []
  const next = { node: 0, triangle: 0, mask: 0 }
  for (let r = 0; r < recordCount; r++) {
    const at = r * RAY_TRACING_RECORD_WORDS
    const [mesh, primitive] = [records[at + A.mesh], records[at + A.primitive]]
    const kind = kindOf(records, r)
    if (cornerCount === 0 && (records[at + A.flags] & RAY_TRACING_FLAG_ATTRIBUTES) !== 0)
      refuse(`record ${r} carries corner attributes and the file has none`)
    if (kind === 'primitive') {
      const meshRecords = byPrimitive.get(mesh) ?? new Map<number, number>()
      if (meshRecords.has(primitive)) refuse(`primitive ${mesh}/${primitive} twice`)
      byPrimitive.set(mesh, meshRecords.set(primitive, r))
    } else {
      if (mesh !== RAY_TRACING_NO_PRIMITIVE) refuse(`the world's record ${r} names a mesh`)
      if (kind === 'actor') {
        actors.push(r)
        // An actor's number is the rank of the material it wears; a file before the version that wrote it has none.
        if (primitive !== RAY_TRACING_NO_PRIMITIVE) {
          if (primitive >= MAX_ACTOR_RANKS) refuse(`the actor ${r} wears material ${primitive}`)
          actorRanks = Math.max(actorRanks, primitive + 1)
        }
      } else if (primitive !== RAY_TRACING_NO_PRIMITIVE)
        refuse(`the world's directory ${r} names a primitive`)
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
  if (next.mask * 3 !== maskCount) refuse('cutout corners that no record holds')
  const cornersAt = bytes.byteLength - tailBytes
  const held = wordsOf(bytes, cornersAt, (cornerCount * cornerBytesEach) / 4)
  const corners = second ? withoutSecondSet(held, cornerCount) : held
  const maskCorners = wordsOf(
    bytes,
    bytes.byteLength - maskCount * RAY_TRACING_MASK_CORNER_BYTES,
    maskCount * RAY_TRACING_MASK_CORNER_WORDS,
  )
  return {
    records,
    nodes,
    triangles,
    corners,
    maskCorners,
    byPrimitive,
    world,
    actorCells,
    actorRanks,
  }
}
