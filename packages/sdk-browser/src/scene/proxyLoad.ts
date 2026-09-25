import {
  decodeSceneProxy,
  type ClusterManifest,
  type SceneProxy,
} from '../../../sdk-core/src/index.ts';
import { ownBuffer } from '../page/decode/host.ts';

/**
 * Read the resident proxy's cache object through the session's page streamer, whose catalogue
 * names it beside the pages (`pageSources.ts`): its size and fingerprint are checked there, and its
 * bytes land in the decoded-page cache the world keeps, so a session reopened after a device loss
 * reads it from there and fetches nothing that cache still holds.
 *
 * It is never read at prepare time: a scene that declares no light has nothing to bounce,
 * and its tens of megabytes would delay the first frame for nothing. The engine asks for it
 * on the first frame that carries a light, and the bounce appears when it arrives.
 */
export function createSceneProxyReader(
  proxy: ClusterManifest['proxy'],
  readBytes: (url: string) => Promise<Uint8Array>,
) {
  if (!proxy) return undefined;
  return async (): Promise<SceneProxy> => {
    // The columns are views of the bytes the cache holds: they are only read, never written.
    return decodeSceneProxy(proxy, ownBuffer(await readBytes(proxy.url)));
  };
}
