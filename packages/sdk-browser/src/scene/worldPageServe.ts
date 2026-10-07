// The world stream's own code, a family on demand (`../host/families.ts`, #1238): the world pages
// named at their address in the cook's rank, and the server that reads each bundle once for every
// caller and both WebGPU views of each page. Nothing draws from the world pages yet (#1332,
// #1333), so a scene opens without it; it imports no engine code, so the CDN bundle makes one
// chunk of it alone (`scripts/bundle-fold.ts`), and the engine's shapes stay the core's
// (`worldRootsPage.ts`, `worldSuperRoots.ts`).
import { waitShared, type SharedRead } from '../../../sdk-core/src/runtime/sharedRead.ts'
import type {
  WorldRoots,
  WorldRootsCluster,
  WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'

/** The world address of one page: its binary, its bundle and its byte offset inside that bundle. */
export const worldRootsPageAddress = (url: string, bundle: number, offset: number) =>
  `${url}#${bundle}:${offset}`

/**
 * The world clusters of a table in the cook's rank, each the fields the cut projects and its page
 * named in the binary at `url` (a super-root; an object root's is left to its own stream), and the
 * world top — the clusters nothing replaces —, the structure's roots; and each cluster's `origin`,
 * the placed object whose own stream holds an object root's page, -1 for a super-root (the
 * residency mirror reads it, `gpu/dag/worldMirror.ts`). A cluster out of its rank is refused,
 * `WORLD_CLUSTER_RANK`, since the groups name clusters by rank.
 */
export function worldRootPages(clusters: readonly WorldRootsCluster[], url: string) {
  const roots: number[] = [],
    origins = new Int32Array(clusters.length)
  const pages = clusters.map((cluster, rank) => {
    if (cluster.cluster !== rank)
      throw new Error(`WORLD_CLUSTER_RANK: ${cluster.cluster} at ${rank}`)
    if (cluster.parentError === null) roots.push(rank)
    origins[rank] = cluster.origin ?? -1
    const { bundle, offset, cluster: _rank, material: _material, origin: _origin, ...cut } = cluster
    return {
      ...cut,
      url: bundle === null || offset === null ? '' : worldRootsPageAddress(url, bundle, offset),
    }
  })
  return { roots, pages, origins }
}

/** The bundle and the offset inside it that a world page address names. */
function worldRootsPageLocation(address: string): { bundle: number; offset: number } {
  const named = /#(\d+):(\d+)$/.exec(address)
  if (!named) throw new Error(`WORLD_PAGE_ADDRESS: ${address}`)
  return { bundle: Number(named[1]), offset: Number(named[2]) }
}

/** The pages of one bundle of the table, verified, in binary order. */
type BundlePages = (bundle: number, signal: AbortSignal) => Promise<WorldRootsPage[]>

/** What a caller takes of a page: one of its two WebGPU halves, or the whole page at once. */
type View = 'read' | 'attributes' | 'whole'

/** How many bundles may wait for the other GPU view of one of their pages, by default: the
 *  streamer's pending budget (capped like its pending page requests), never a scene's. */
const WORLD_PENDING_BUNDLES = 64

/**
 * The page server of `table`, its bundles read through `bundlePages`: a page is resolved at its
 * world address by the pages of its bundle and the rank of its offset among those the table lists
 * for that bundle. A bundle the table does not list, or an offset it does not name, is
 * `WORLD_PAGE_MISSING`. `pendingBundles` bounds the bundles kept for a page's other view.
 */
export function worldPageServer(
  table: WorldRoots,
  bundlePages: BundlePages,
  pendingBundles = WORLD_PENDING_BUNDLES,
) {
  // Each bundle's page offsets in binary order: a page's rank among them is its place in it,
  // resolved once here rather than searched per request.
  const offsets = new Map<number, number[]>()
  for (let page = 0; page < table.pages.count; page++) {
    const entry = table.pages.at(page),
      known = offsets.get(entry.bundle)
    if (known) known.push(entry.offset)
    else offsets.set(entry.bundle, [entry.offset])
  }
  const ranks = new Map<number, Map<number, number>>()
  for (const [bundle, known] of offsets)
    ranks.set(bundle, new Map(known.sort((a, b) => a - b).map((offset, rank) => [offset, rank])))
  /** A bundle read once: its pages, the callers still on it, and each page whose GPU half (`read`
   *  or `attributes`) is served and whose other half is still owed. */
  type Streamed = SharedRead<WorldRootsPage[]> & {
    bundle: number
    /** Aborted once its last asker let it go before it landed: its read is dropped. */
    stop: AbortController
    users: number
    owed: Map<number, View>
  }
  const streamed = new Map<number, Streamed>()
  /** The bundles owing a view, oldest first: past `pendingBundles`, the oldest is let go. */
  const owing = new Set<Streamed>()
  const letGo = (own: Streamed) => {
    if (own.owed.size === 0) owing.delete(own)
    if (own.users === 0 && own.owed.size === 0 && streamed.get(own.bundle) === own)
      streamed.delete(own.bundle)
  }
  // A bundle's read is shared by every caller, each waiting on it with its own signal: one caller
  // aborting never fails another's page, and the read is dropped once its last caller let it go
  // (`waitShared`): a closed session's engine waits on nothing, asks nothing. It is kept while a caller is on it or a page owes its other GPU view, so the two views of a page come
  // from one read whatever their order; what stays resident is the holder's and the GPU pool's.
  // A page whose other half aborts, or a bundle pushed past the pending budget (a view never asked:
  // an evicted slot), owes nothing more, so the retention is bounded.
  const serve = async (address: string, view: View, signal?: AbortSignal) => {
    const { bundle, offset } = worldRootsPageLocation(address)
    if (!table.bundles[bundle]) throw new Error(`WORLD_PAGE_MISSING: bundle ${bundle}`)
    let own = streamed.get(bundle)
    // A caller gone already joins nothing, and breaks the pair its page owed.
    if (signal?.aborted) {
      own?.owed.delete(ranks.get(bundle)?.get(offset) ?? -1)
      if (own) letGo(own)
      signal.throwIfAborted()
    }
    if (!own || own.stop.signal.aborted) {
      const stop = new AbortController()
      const fresh: Streamed = {
        ...{ bundle, promise: bundlePages(bundle, stop.signal), askers: 0, stop },
        ...{ users: 0, owed: new Map() },
      }
      fresh.promise.catch(() => void (streamed.get(bundle) === fresh && streamed.delete(bundle)))
      streamed.set(bundle, (own = fresh))
    }
    own.users++
    try {
      const shared = own,
        pages = await waitShared(own, signal, () => shared.stop.abort()),
        index = ranks.get(bundle)?.get(offset) ?? -1
      if (signal?.aborted) {
        own.owed.delete(index)
        signal.throwIfAborted()
      }
      if (index < 0 || index >= pages.length) throw new Error(`WORLD_PAGE_MISSING: ${address}`)
      const other = own.owed.get(index)
      if (view === 'whole' || (other && other !== view)) own.owed.delete(index)
      else if (!other) {
        own.owed.set(index, view)
        // Newest last, so the budget lets go of the bundle owed longest, never the one just served.
        owing.delete(own)
        owing.add(own)
        for (const oldest of owing) {
          if (owing.size <= pendingBundles) break
          oldest.owed.clear()
          letGo(oldest)
        }
      }
      return pages[index]
    } finally {
      own.users--
      letGo(own)
    }
  }
  return {
    /** The bytes of the bundles it keeps (in flight, or owing a page's other GPU view) past the
     *  pinned top that `held` does not hold. */
    keptBytes(held: { has(bundle: number): boolean }) {
      let kept = 0
      for (const bundle of streamed.keys())
        if (bundle >= table.pinned && !held.has(bundle)) kept += table.bundles[bundle].bytes
      return kept
    },
    /** The page at `address`: world-space vertices, `u16` triangles. */
    page: (address: string, signal?: AbortSignal) => serve(address, 'whole', signal),
    /** The bytes a GPU page slot holds: the page's widened `u32` index words. */
    read: async (key: string, signal?: AbortSignal) =>
      new Uint8Array(worldRootsIndices(await serve(key, 'read', signal)).buffer),
    /** Its world-space positions, the page's other WebGPU view. */
    positions: async (address: string, signal?: AbortSignal) =>
      (await serve(address, 'attributes', signal)).positions,
  }
}

/** The `u32` indices of a world page: the `u16` local list widened one-to-one, the width the
 *  WebGPU `array<u32>` reads. */
const worldRootsIndices = (page: WorldRootsPage) => new Uint32Array(page.indices)

export type WorldPageServer = ReturnType<typeof worldPageServer>
