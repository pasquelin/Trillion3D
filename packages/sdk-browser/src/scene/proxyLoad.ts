import {
  decodeSceneProxy,
  type ClusterManifest,
  type SceneProxy,
} from '../../../sdk-core/src/index.ts';
import { fetchVerified } from '../cluster/pages.ts';
import type { PageCache } from '../streaming/pageCache.ts';

/**
 * Read the resident proxy's cache object, next to the manifest that names it, and keep it whole in
 * `cache`, the decoded-page cache the world keeps across sessions (`PageCache.keep`): its announced
 * bytes come off the CPU total from the moment it is asked, no page evicts it, and a session reopened
 * after a device loss reads it from there, fetching nothing. Its own request, beside the page queue:
 * it neither waits for the pages nor holds them back, and it is not a page the streamer counts.
 * A refusal another request would meet again — a 404 — is asked once (`checked`). The kept read is
 * not the session's: a session closed on a device loss leaves it to the next one, and only a scene
 * gone (`keepOnly`) cancels it. Without a world's cache, the read is the session's (`signal`).
 *
 * It is never read at prepare time: a scene that declares no light has nothing to bounce,
 * and its tens of megabytes would delay the first frame for nothing. The engine asks for it
 * on the first frame that carries a light, and the bounce appears when it arrives.
 *
 * Opened for a scene, the reader keeps that scene's proxy alone: another scene's leaves the cache.
 * The proxy is kept under its full address and its fingerprint: it is `proxy.bin` in every key
 * folder, and a folder cooked again may rewrite it at the same size.
 */
export function createSceneProxyReader(
  proxy: ClusterManifest['proxy'],
  base: string,
  cache: PageCache | undefined,
  signal?: AbortSignal,
) {
  if (!proxy) {
    cache?.keepOnly();
    return undefined;
  }
  const url = new URL(proxy.url, base).href;
  const key = `${url}#${proxy.sha256}`;
  cache?.keepOnly(key);
  const read = (readSignal = signal) => fetchVerified(url, proxy, readSignal);
  return async (): Promise<SceneProxy> => {
    const buffer = await (cache ? cache.keep(key, proxy.bytes, read) : read());
    // The kept read outlives its session, its caller does not: an engine disposed meanwhile builds
    // nothing on the device from it, which nothing would release.
    signal?.throwIfAborted();
    // The columns are views of the bytes the cache keeps, whole: they are only read, never written.
    return decodeSceneProxy(proxy, buffer);
  };
}
