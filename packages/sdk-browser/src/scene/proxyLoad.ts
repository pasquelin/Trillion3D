import {
  assertSceneProxy,
  decodeSceneProxy,
  EngineError,
  type ClusterManifest,
  type SceneProxy,
} from '../../../sdk-core/src/index.ts'
import { fetchVerified } from '../cluster/pages.ts'
import type { PageCache } from '../streaming/pageCache.ts'

// The cache owns each buffer's lifetime; its expanded columns survive session/device recreation.
const decoded = new WeakMap<ArrayBuffer, SceneProxy>()

/**
 * Read the resident proxy's cache object, next to the manifest that names it, and keep it whole in
 * `cache`, the session's page cache, the one its pages and texture levels are read through
 * (`../world/session/pageSources.ts`) — its world's, kept across sessions, or the session's own
 * (`PageCache.keep`, which says how long it stays): a session reopened after a device loss reads it
 * from there, fetching nothing. Its own request, beside the page queue: it neither waits for the
 * pages nor holds them back, and it is not a page the streamer counts. A refusal another request
 * would meet again — a 404 — is asked once (`checked`). The kept read is the cache's, not the
 * session's: a session closed on a device loss leaves it to the next one, and only a scene gone
 * (`keepOnly`) cancels it.
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
  cache: PageCache,
  signal?: AbortSignal,
) {
  if (!proxy) {
    cache.keepOnly()
    return undefined
  }
  assertSceneProxy(proxy)
  const url = new URL(proxy.url, base).href
  const key = `${url}#${proxy.sha256}`
  cache.keepOnly(key)
  const read = (readSignal: AbortSignal) => fetchVerified(url, proxy, readSignal)
  return async (): Promise<SceneProxy> => {
    const buffer = await cache.keep(key, proxy.bytes, read)
    // The kept read outlives its session, its caller does not: an engine disposed meanwhile builds
    // nothing on the device from it, which nothing would release.
    signal?.throwIfAborted()
    // Tree/ownership columns may view the bytes; shared triangles and unaligned matrices are
    // allocated once. All columns remain immutable; dynamic refits own separate copies.
    let result = decoded.get(buffer)
    if (!result) {
      result = decodeSceneProxy(proxy, buffer)
      decoded.set(buffer, result)
    }
    for (const field of [
      'version',
      'bytes',
      'triangles',
      'nodes',
      'groups',
      'owners',
      'instances',
    ] as const)
      if (proxy[field] !== result[field])
        throw new EngineError(
          'INVALID_CACHE',
          'The scene proxy object disagrees with its manifest',
          { field },
        )
    const allocations = new Set(Object.values(result.data).map((column) => column.buffer))
    allocations.delete(buffer)
    const expandedBytes = [...allocations].reduce(
      (sum, allocation) => sum + allocation.byteLength,
      0,
    )
    cache.weigh(key, buffer.byteLength + expandedBytes)
    return { ...proxy, data: result.data }
  }
}
