import {
  PROXY_CHILDREN,
  PROXY_CHILD_WORDS,
  PROXY_NODE_FLOATS,
  PROXY_NODE_WORDS,
  PROXY_TRIANGLE_FLOATS,
  SCENE_PROXY_HEADER_WORDS,
  SCENE_PROXY_MAGIC,
  SCENE_PROXY_VERSION,
  type SceneProxy,
  type SceneProxyColumns,
  type SceneProxyDescriptor,
} from '../../contracts/proxy.ts'
import {
  PROXY_TRANSFORM_FLOATS,
  expandShapes,
  placedTriangles,
  type ProxyShapes,
} from './proxyShapes.ts'
import { decodeProxyOwnership } from './proxyOwnership.ts'
import { EngineError } from '../../contracts/index.ts'
import { invalidProxy as bad } from './proxyError.ts'

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
  for (const key of ['bytes', 'triangles', 'nodes', 'groups', 'owners', 'instances'] as const)
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
 * Each present child names either a node further in the array, or an interval of
 * triangles that exists. An absent child is not read: its presence bit is zero.
 */
function checkChildren(descriptor: SceneProxyDescriptor, columns: SceneProxyColumns) {
  const { nodeChildren } = columns
  for (let node = 0; node < descriptor.nodes; node++)
    for (let slot = 0; slot < PROXY_CHILDREN; slot++) {
      const base = node * PROXY_NODE_WORDS + slot * PROXY_CHILD_WORDS
      const words = nodeChildren[base + 1],
        offset = nodeChildren[base + 2]
      if (words >>> 24 === 0) continue
      const count = (words >>> 16) & 255
      if (count === 0 && offset <= node)
        throw bad('A scene proxy child does not point forward', { node, slot, offset })
      if (count === 0 && offset >= descriptor.nodes)
        throw bad('A scene proxy child names a node it does not have', { node, slot, offset })
      if (count > 0 && offset + count > descriptor.triangles)
        throw bad('A scene proxy leaf names triangles it does not have', { node, offset, count })
    }
}

/**
 * The proxy reread and rechecked before a single ray touches it.
 *
 * Layout: eleven little-endian header words, followed by shared/loose geometry, tree columns
 * and versioned ownership, read in the order the compiler writes them (`SceneProxy::encode`,
 * `packages/asset-compiler-rust/src/proxy/encode.rs`).
 * Each section has a length the header imposes; a file of another size is rejected in
 * bulk, because a node that named a missing triangle would make the shader read anything.
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
    words[2] !== descriptor.triangles ||
    words[3] !== descriptor.nodes ||
    words[4] !== descriptor.groups ||
    words[5] !== descriptor.owners ||
    words[6] !== descriptor.instances ||
    words[7] !== 0
  )
    throw bad('The scene proxy object disagrees with its manifest', {
      version: words[1],
      triangles: words[2],
      nodes: words[3],
    })
  const [, , triangles, nodes, , , , , shapeCount, shapeTriangles, placements] = words
  const tables =
    header +
    (shapeCount +
      shapeTriangles * (PROXY_TRIANGLE_FLOATS + 1) +
      placements * (1 + PROXY_TRANSFORM_FLOATS)) *
      4
  if (buffer.byteLength < tables) throw wrongLength(tables)
  let at = header
  const floats = (n: number) => ((at += n * 4), new Float32Array(buffer, at - n * 4, n))
  const integers = (n: number) => ((at += n * 4), new Uint32Array(buffer, at - n * 4, n))
  const shapes: ProxyShapes = {
    counts: integers(shapeCount),
    triangles: floats(shapeTriangles * PROXY_TRIANGLE_FLOATS),
    albedo: integers(shapeTriangles),
    shapeOf: integers(placements),
    maps: floats(placements * PROXY_TRANSFORM_FLOATS),
  }
  const placed = placedTriangles(shapes),
    loose = triangles - placed
  const wanted =
    tables +
    (placed +
      loose * (PROXY_TRIANGLE_FLOATS + 1) +
      nodes * (PROXY_NODE_FLOATS + PROXY_NODE_WORDS) +
      triangles +
      descriptor.groups +
      1 +
      descriptor.owners * 2) *
      4 +
    descriptor.instances * (4 + 4 + 16 * 8)
  if (loose < 0 || buffer.byteLength !== wanted) throw wrongLength(wanted)
  const positions = integers(placed)
  const flat = { triangles: floats(loose * PROXY_TRIANGLE_FLOATS), albedo: integers(loose) }
  const data: SceneProxyColumns = {
    ...(placements === 0 ? flat : expandShapes(triangles, shapes, positions, flat)),
    nodeBounds: floats(nodes * PROXY_NODE_FLOATS),
    nodeChildren: integers(nodes * PROXY_NODE_WORDS),
    ...decodeProxyOwnership(descriptor, buffer, at),
  }
  checkChildren(descriptor, data)
  return { ...descriptor, data }
}
