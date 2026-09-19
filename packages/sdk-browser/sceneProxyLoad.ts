import { decodeSceneProxy, EngineError, type SceneProxy } from '../sdk-core/index.ts';
import { checked } from './clusterPages.ts';

/**
 * Read the resident proxy's cache object, next to the manifest that names it.
 *
 * It is never read at prepare time: a scene that declares no light has nothing to bounce,
 * and its tens of megabytes would delay the first frame for nothing. The engine asks for it
 * on the first frame that carries a light, and the bounce appears when it arrives.
 */
export function createSceneProxyReader(
  proxy: { url: string; sha256: string; bytes: number } | undefined,
  base: string,
  signal?: AbortSignal,
) {
  if (!proxy) return undefined;
  return async (): Promise<SceneProxy> => {
    const url = new URL(proxy.url, base).href;
    const buffer = await (await checked(url, signal)).arrayBuffer();
    if (buffer.byteLength !== proxy.bytes)
      throw new EngineError(
        'INVALID_CACHE',
        `${url}: ${buffer.byteLength} bytes received, ${proxy.bytes} announced`,
        { url, bytes: buffer.byteLength, expected: proxy.bytes },
      );
    return decodeSceneProxy(proxy as Parameters<typeof decodeSceneProxy>[0], buffer);
  };
}
