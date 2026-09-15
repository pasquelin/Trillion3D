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
 * Refuse un descriptif de proxy que ce moteur ne saurait pas lire, avant qu'un seul octet ne soit
 * demandé. Un manifeste sans descriptif n'est pas une erreur : c'est un cache d'avant le rebond, et
 * le moteur le dit au lieu de deviner une géométrie qu'il n'a pas.
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
 * Chaque enfant présent nomme soit un nœud plus loin dans le tableau, soit un intervalle de
 * triangles qui existe. Un enfant absent n'est pas lu : son bit de présence est à zéro.
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
 * Le proxy relu et revérifié avant qu'un seul rayon ne le touche.
 *
 * Disposition, en petit-boutiste : `u32 'WGPX' · u32 version · u32 triangles · u32 nœuds`, puis les
 * sommets monde, les albédos, les bornes exactes des nœuds et leurs quatre enfants, bout à bout.
 * Chaque section a une longueur que l'en-tête impose ; un fichier d'une autre taille est refusé en
 * bloc, parce qu'un nœud qui nommerait un triangle absent ferait lire n'importe quoi au nuanceur.
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
