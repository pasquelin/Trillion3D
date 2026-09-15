import { decodeSceneProxy, EngineError, type SceneProxy } from '../sdk-core/index.ts';
import { checked } from './clusterPages.ts';

/**
 * Lit l'objet de cache du proxy résident, à côté du manifeste qui le nomme.
 *
 * Il n'est jamais lu à la préparation : une scène qui ne déclare aucune lampe n'a rien à faire
 * rebondir, et ses dizaines de mégaoctets retarderaient la première image pour rien. Le moteur le
 * demande à la première image qui porte une lampe, et le rebond apparaît quand il arrive.
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
        `${url}: ${buffer.byteLength} octets reçus, ${proxy.bytes} annoncés`,
        { url, bytes: buffer.byteLength, expected: proxy.bytes },
      );
    return decodeSceneProxy(proxy as Parameters<typeof decodeSceneProxy>[0], buffer);
  };
}
