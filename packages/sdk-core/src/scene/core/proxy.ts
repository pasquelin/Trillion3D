import {
  PROXY_CHILDREN,
  PROXY_CHILD_WORDS,
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
  SCENE_PROXY_HEADER_WORDS,
  SCENE_PROXY_MAGIC,
  SCENE_PROXY_VERSION,
  type RuntimeCutProxy,
  type SceneProxy,
  type SceneProxyDescriptor,
} from '../../contracts/proxy.ts'
import { EngineError } from '../../contracts/index.ts'
import { invalidProxy as bad } from './proxyError.ts'

/** The triangle count in bits 16–23 of a child's second word: a leaf's triangles, 0 for an inner
 *  child, whose link names a node. */
export const proxyChildCount = (word: number) => (word >>> 16) & 255

/** Words of a mesh's entry in the table: its triangles, its nodes, its grid step. */
const TABLE_WORDS = 3

/**
 * Rejects a proxy descriptor this engine could not read, before a single byte is
 * requested. A manifest without a descriptor is not an error: it is a cache from before bounce, and
 * the engine says so instead of guessing geometry it does not have.
 */
export function assertSceneProxy(value: unknown): asserts value is SceneProxyDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EngineError('UNSUPPORTED_FORMAT', 'The scene proxy descriptor is not an object', {})
  const descriptor = value as Partial<SceneProxyDescriptor>
  if (descriptor.version !== SCENE_PROXY_VERSION)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `Expected scene proxy version ${SCENE_PROXY_VERSION}, received ${String(descriptor.version)}`,
      { version: descriptor.version ?? null, expected: SCENE_PROXY_VERSION },
    )
  for (const key of ['url', 'sha256'] as const)
    if (typeof descriptor[key] !== 'string' || !descriptor[key])
      throw new EngineError('UNSUPPORTED_FORMAT', `The scene proxy descriptor misses ${key}`, {
        key,
      })
  for (const key of ['bytes', 'triangles', 'nodes', 'meshes'] as const)
    if (!Number.isSafeInteger(descriptor[key]) || descriptor[key]! < 0)
      throw new EngineError('UNSUPPORTED_FORMAT', `The scene proxy descriptor misses ${key}`, {
        key,
        value: descriptor[key] ?? null,
      })
  if (!Array.isArray(descriptor.bounds) || descriptor.bounds.length !== 6)
    throw new EngineError('UNSUPPORTED_FORMAT', 'The scene proxy has no world extent', {
      bounds: descriptor.bounds ?? null,
    })
}

/**
 * Each present child of a mesh names either a node further in its own array, or an interval of its own
 * triangles that exists. An absent child is not read: its presence bit is zero.
 */
function checkChildren(mesh: number, children: Uint32Array, nodes: number, triangles: number) {
  for (let node = 0; node < nodes; node++)
    for (let slot = 0; slot < PROXY_CHILDREN; slot++) {
      const base = node * PROXY_NODE_WORDS + slot * PROXY_CHILD_WORDS
      const words = children[base + 1],
        offset = children[base + 2]
      if (words >>> 24 === 0) continue
      const count = proxyChildCount(words)
      if (count === 0 && offset <= node)
        throw bad('A scene proxy child does not point forward', { mesh, node, slot, offset })
      if (count === 0 && offset >= nodes)
        throw bad('A scene proxy child names a node it does not have', { mesh, node, slot, offset })
      if (count > 0 && offset + count > triangles)
        throw bad('A scene proxy leaf names triangles it does not have', {
          mesh,
          node,
          offset,
          count,
        })
    }
}

/**
 * The proxy reread and rechecked before a single ray touches it.
 *
 * Layout: six little-endian header words, a table of three words a mesh, then every mesh's triangles, albedo,
 * node bounds and node children, each column of all the meshes in table order, read in the order the compiler
 * writes them (`SceneProxy::encode`, `packages/asset-compiler-rust/src/proxy/encode.rs`). Each section has a
 * length the header imposes; a file of another size is rejected in bulk, because a node that named a missing
 * triangle would make the shader read anything. The columns are views of the buffer.
 */
export function decodeSceneProxy(
  descriptor: SceneProxyDescriptor,
  buffer: ArrayBuffer,
): SceneProxy {
  assertSceneProxy(descriptor)
  const header = SCENE_PROXY_HEADER_WORDS * 4
  const wrongLength = (expected: number) =>
    bad('The scene proxy object does not have the length its manifest declares', {
      bytes: buffer.byteLength,
      expected,
    })
  if (buffer.byteLength < header || buffer.byteLength !== descriptor.bytes)
    throw wrongLength(Math.max(header, descriptor.bytes))
  const words = new Uint32Array(buffer, 0, SCENE_PROXY_HEADER_WORDS)
  if (words[0] !== SCENE_PROXY_MAGIC)
    throw bad('The scene proxy object has no WGPX signature', { magic: words[0] })
  if (
    words[1] !== SCENE_PROXY_VERSION ||
    words[2] !== descriptor.meshes ||
    words[3] !== descriptor.triangles ||
    words[4] !== descriptor.nodes ||
    words[5] !== 0
  )
    throw bad('The scene proxy object disagrees with its manifest', {
      version: words[1],
      meshes: words[2],
      triangles: words[3],
      nodes: words[4],
    })
  const [, , meshes, triangles, nodes] = words
  const wanted =
    header +
    (meshes * TABLE_WORDS +
      triangles * (PROXY_TRIANGLE_FLOATS + 1) +
      nodes * (PROXY_NODE_FLOATS + PROXY_NODE_WORDS)) *
      4
  if (buffer.byteLength !== wanted) throw wrongLength(wanted)
  const table = new Uint32Array(buffer, header, meshes * TABLE_WORDS)
  const cells = new Float32Array(buffer, header, meshes * TABLE_WORDS)
  let at = header + meshes * TABLE_WORDS * 4
  const floats = (n: number) => ((at += n * 4), new Float32Array(buffer, at - n * 4, n))
  const integers = (n: number) => ((at += n * 4), new Uint32Array(buffer, at - n * 4, n))
  const columns = {
    triangles: floats(triangles * PROXY_TRIANGLE_FLOATS),
    albedo: integers(triangles),
    nodeBounds: floats(nodes * PROXY_NODE_FLOATS),
    nodeChildren: integers(nodes * PROXY_NODE_WORDS),
  }
  let triangleAt = 0,
    nodeAt = 0
  const list: RuntimeCutProxy[] = []
  for (let mesh = 0; mesh < meshes; mesh++) {
    const count = table[mesh * TABLE_WORDS],
      nodeCount = table[mesh * TABLE_WORDS + 1]
    const children = columns.nodeChildren.subarray(
      nodeAt * PROXY_NODE_WORDS,
      (nodeAt + nodeCount) * PROXY_NODE_WORDS,
    )
    checkChildren(mesh, children, nodeCount, count)
    list.push({
      triangles: columns.triangles.subarray(
        triangleAt * PROXY_TRIANGLE_FLOATS,
        (triangleAt + count) * PROXY_TRIANGLE_FLOATS,
      ) as Float32Array<ArrayBuffer>,
      albedo: columns.albedo.subarray(triangleAt, triangleAt + count) as Uint32Array<ArrayBuffer>,
      nodeBounds: columns.nodeBounds.subarray(
        nodeAt * PROXY_NODE_FLOATS,
        (nodeAt + nodeCount) * PROXY_NODE_FLOATS,
      ) as Float32Array<ArrayBuffer>,
      nodeChildren: children as Uint32Array<ArrayBuffer>,
      cellMetres: cells[mesh * TABLE_WORDS + 2],
    })
    triangleAt += count
    nodeAt += nodeCount
  }
  if (triangleAt !== triangles || nodeAt !== nodes)
    throw bad('The scene proxy table disagrees with its header', { triangleAt, nodeAt })
  return { ...descriptor, data: { meshes: list } }
}
