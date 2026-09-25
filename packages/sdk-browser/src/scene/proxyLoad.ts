import {
  decodeSceneProxy,
  type ClusterManifest,
  type SceneProxy,
} from '../../../sdk-core/src/index.ts';
import { checked } from '../cluster/pages.ts';
import { verifyPageBytes } from '../page/decode/host.ts';
import { corruptObject } from '../streaming/fetch.ts';
import type { PageCache } from '../streaming/pageCache.ts';

/**
 * Read the resident proxy's cache object, next to the manifest that names it, and keep it whole in
 * `cache`, the decoded-page cache the world keeps across sessions (`PageCache.keep`): its announced
 * bytes come off the CPU total from the moment it is asked, no page evicts it, and a session reopened
 * after a device loss reads it from there, fetching nothing. Its own request, beside the page queue:
 * it neither waits for the pages nor holds them back, and it is not a page the streamer counts.
 * A refusal another request would meet again — a 404 — is asked once (`checked`).
 *
 * It is never read at prepare time: a scene that declares no light has nothing to bounce,
 * and its tens of megabytes would delay the first frame for nothing. The engine asks for it
 * on the first frame that carries a light, and the bounce appears when it arrives.
 *
 * Opened for a scene, the reader keeps that scene's proxy alone: another scene's leaves the cache.
 * The proxy is kept under its full address: it is `proxy.bin` in every key folder.
 */
export function createSceneProxyReader(
  proxy: ClusterManifest['proxy'],
  base: string,
  cache: PageCache | undefined,
  signal?: AbortSignal,
) {
  const url = proxy && new URL(proxy.url, base).href;
  cache?.keepOnly(url ? [url] : []);
  if (!proxy || !url) return undefined;
  const read = async () => {
    const buffer = await (await checked(url, signal)).arrayBuffer();
    // Sized before the fingerprint, which transfers the buffer to a worker and back.
    const bytes = buffer.byteLength;
    if (bytes !== proxy.bytes) throw corruptObject(url, proxy, bytes, undefined);
    const verified = await verifyPageBytes(buffer);
    if (verified.sha256 !== proxy.sha256) throw corruptObject(url, proxy, bytes, verified.sha256);
    return new Uint8Array(verified.source);
  };
  return async (): Promise<SceneProxy> => {
    let bytes = cache?.kept(url);
    if (!bytes) {
      cache?.keep(url, proxy.bytes);
      try {
        bytes = await read();
      } catch (error) {
        // What failed keeps nothing: its reservation leaves the total.
        cache?.keepOnly([]);
        throw error;
      }
      cache?.keep(url, bytes.byteLength, bytes);
    }
    // The columns are views of the bytes the cache keeps, whole: they are only read, never written.
    return decodeSceneProxy(proxy, bytes.buffer as ArrayBuffer);
  };
}
