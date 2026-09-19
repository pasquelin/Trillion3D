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
} from './proxyContracts.ts';
import { EngineError } from './contracts.ts';

const bad = (message: string, details: Record<string, unknown>) =>
  new EngineError('INVALID_CACHE', message, details);

/**
 * Rejects a proxy descriptor this engine could not read, before a single byte is
 * requested. A manifest without a descriptor is not an error: it is a cache from before bounce, and
 * the engine says so instead of guessing geometry it does not have.
 */
export function assertSceneProxy(value: unknown): asserts value is SceneProxyDescriptor {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EngineError('UNSUPPORTED_FORMAT', 'The scene proxy descriptor is not an object', {});
  const descriptor = value as Partial<SceneProxyDescriptor>;
  if (descriptor.version !== SCENE_PROXY_VERSION)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `Expected scene proxy version ${SCENE_PROXY_VERSION}, received ${String(descriptor.version)}`,
      { version: descriptor.version ?? null, expected: SCENE_PROXY_VERSION },
    );
  for (const key of ['url', 'sha256'] as const)
    if (typeof descriptor[key] !== 'string' || !descriptor[key])
      throw new EngineError('UNSUPPORTED_FORMAT', `The scene proxy descriptor misses ${key}`, {
        key,
      });
  for (const key of ['bytes', 'triangles', 'nodes'] as const)
    if (!Number.isSafeInteger(descriptor[key]) || descriptor[key]! < 0)
      throw new EngineError('UNSUPPORTED_FORMAT', `The scene proxy descriptor misses ${key}`, {
        key,
        value: descriptor[key] ?? null,
      });
  if (!Array.isArray(descriptor.bounds) || descriptor.bounds.length !== 6)
    throw new EngineError('UNSUPPORTED_FORMAT', 'The scene proxy has no world extent', {
      bounds: descriptor.bounds ?? null,
    });
}

/**
 * Each present child names either a node further in the array, or an interval of
 * triangles that exists. An absent child is not read: its presence bit is zero.
 */
function checkChildren(descriptor: SceneProxyDescriptor, columns: SceneProxyColumns) {
  const { nodeChildren } = columns;
  for (let node = 0; node < descriptor.nodes; node++)
    for (let slot = 0; slot < PROXY_CHILDREN; slot++) {
      const base = node * PROXY_NODE_WORDS + slot * PROXY_CHILD_WORDS;
      const words = nodeChildren[base + 1],
        offset = nodeChildren[base + 2];
      if (words >>> 24 === 0) continue;
      const count = (words >>> 16) & 255;
      if (count === 0 && offset <= node)
        throw bad('A scene proxy child does not point forward', { node, slot, offset });
      if (count === 0 && offset >= descriptor.nodes)
        throw bad('A scene proxy child names a node it does not have', { node, slot, offset });
      if (count > 0 && offset + count > descriptor.triangles)
        throw bad('A scene proxy leaf names triangles it does not have', { node, offset, count });
    }
}

/**
 * The proxy reread and rechecked before a single ray touches it.
 *
 * Layout, little-endian: `u32 'WGPX' · u32 version · u32 triangles · u32 nodes`, then the
 * world vertices, albedos, exact node bounds and their four children, concatenated.
 * Each section has a length the header imposes; a file of another size is rejected in
 * bulk, because a node that named a missing triangle would make the shader read anything.
 */
export function decodeSceneProxy(
  descriptor: SceneProxyDescriptor,
  buffer: ArrayBuffer,
): SceneProxy {
  assertSceneProxy(descriptor);
  const header = SCENE_PROXY_HEADER_WORDS * 4;
  const wanted =
    header +
    descriptor.triangles * (PROXY_TRIANGLE_FLOATS + 1) * 4 +
    descriptor.nodes * (PROXY_NODE_FLOATS + PROXY_NODE_WORDS) * 4;
  if (buffer.byteLength !== wanted)
    throw bad('The scene proxy object does not have the length its manifest declares', {
      bytes: buffer.byteLength,
      expected: wanted,
    });
  const words = new Uint32Array(buffer, 0, SCENE_PROXY_HEADER_WORDS);
  if (words[0] !== SCENE_PROXY_MAGIC)
    throw bad('The scene proxy object has no WGPX signature', { magic: words[0] });
  if (
    words[1] !== SCENE_PROXY_VERSION ||
    words[2] !== descriptor.triangles ||
    words[3] !== descriptor.nodes
  )
    throw bad('The scene proxy object disagrees with its manifest', {
      version: words[1],
      triangles: words[2],
      nodes: words[3],
    });
  let at = header;
  const take = <T>(make: (b: ArrayBuffer, o: number, n: number) => T, elements: number): T => {
    const column = make(buffer, at, elements);
    at += elements * 4;
    return column;
  };
  const data: SceneProxyColumns = {
    triangles: take(
      (b, o, n) => new Float32Array(b, o, n),
      descriptor.triangles * PROXY_TRIANGLE_FLOATS,
    ),
    albedo: take((b, o, n) => new Uint32Array(b, o, n), descriptor.triangles),
    nodeBounds: take((b, o, n) => new Float32Array(b, o, n), descriptor.nodes * PROXY_NODE_FLOATS),
    nodeChildren: take((b, o, n) => new Uint32Array(b, o, n), descriptor.nodes * PROXY_NODE_WORDS),
  };
  checkChildren(descriptor, data);
  return { ...descriptor, data };
}
