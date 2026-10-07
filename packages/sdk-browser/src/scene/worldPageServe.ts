// The world stream's own code, a family on demand (`../host/families.ts`, #1238): the world pages
// named at their address in the cook's rank, and the server that reads each bundle once for every
// caller in flight. A scene opens without it; it imports no engine code, so the CDN bundle makes
// one chunk of it alone (`scripts/bundle-fold.ts`), and the engine's shapes stay the core's
// (`worldRootsPage.ts`, `worldSuperRoots.ts`).
import type {
  WorldRoots,
  WorldRootsCluster,
  WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'

/** The world address of one page: its binary, its bundle and its byte offset inside that bundle. */
export const worldRootsPageAddress = (url: string, bundle: number, offset: number) =>
  `${url}#${bundle}:${offset}`

/**
 * The world clusters of a table in the cook's rank, each the fields the cut projects, the primitive
 * it wears and its page named in the binary at `url` with its facts (a super-root; an object
 * root's is left to its own stream), and the clusters nothing replaces, the structure's `roots`:
 * those in the first `pinned` bundles, the world top, the session holds; past them, a root one
 * cell alone needs — a lone object's copy, a material's top only that cell wears — names its
 * bundle as its `holder`, and is `held` by it, joining the cover with its cell
 * (`webgpu/pages/prepare/worldRoot.ts`). With them, each cluster's `origin`, the placed object
 * whose own stream holds an object root's page, -1 for a super-root (the residency mirror reads
 * it, `gpu/dag/worldMirror.ts`); and the quantization displacement every band is raised by. A
 * cluster out of its rank is refused, `WORLD_CLUSTER_RANK`, since the groups name clusters by rank.
 */
export function worldRootPages(
  clusters: readonly WorldRootsCluster[],
  url: string,
  pinned: number,
) {
  const roots: number[] = [],
    held = new Map<number, number[]>(),
    origins = new Int32Array(clusters.length)
  // The world's largest quantization displacement raises every band alike, as a primitive's
  // raises its own (`clusterErrorFields`): equal bands stay equal (`gpu/dag/worldLinks.ts`).
  let slack = 0
  for (const { page } of clusters) slack = Math.max(slack, page?.quantizationError ?? 0)
  const pages = clusters.map((cluster, rank) => {
    if (cluster.cluster !== rank)
      throw new Error(`WORLD_CLUSTER_RANK: ${cluster.cluster} at ${rank}`)
    const { bundle, offset, cluster: _rank, origin: _origin, ...cut } = cluster
    const root = cut.parentError === null,
      holder = root && bundle !== null && bundle >= pinned ? bundle : undefined
    if (root) roots.push(rank)
    const ranks = holder === undefined ? undefined : held.get(holder)
    if (ranks) ranks.push(rank)
    else if (holder !== undefined) held.set(holder, [rank])
    origins[rank] = cluster.origin ?? -1
    return {
      ...cut,
      lodError: cut.lodError + slack,
      parentError: root ? null : cut.parentError! + slack,
      url: bundle === null || offset === null ? '' : worldRootsPageAddress(url, bundle, offset),
      ...(holder !== undefined && { holder }),
    }
  })
  return { roots, held, pages, origins, slack }
}

/** The bundle and the offset inside it that a world page address names. */
function worldRootsPageLocation(address: string): { bundle: number; offset: number } {
  const named = /#(\d+):(\d+)$/.exec(address)
  if (!named) throw new Error(`WORLD_PAGE_ADDRESS: ${address}`)
  return { bundle: Number(named[1]), offset: Number(named[2]) }
}

/** The pages of one bundle of the table, verified, in binary order. */
type BundlePages = (bundle: number) => Promise<WorldRootsPage[]>

/**
 * The page server of `table`, its bundles read through `bundlePages`: a page is resolved at its
 * world address by the pages of its bundle and the rank of its offset among those the table lists
 * for that bundle. A bundle the table does not list, or an offset it does not name, is
 * `WORLD_PAGE_MISSING`.
 */
export function worldPageServer(table: WorldRoots, bundlePages: BundlePages) {
  // Each bundle's page offsets in binary order: a page's rank among them is its place in it,
  // resolved once here rather than searched per request.
  const ranks = new Map<number, Map<number, number>>()
  for (let page = 0; page < table.pages.count; page++) {
    const { bundle, offset } = table.pages.at(page),
      known = ranks.get(bundle) ?? new Map<number, number>()
    known.set(offset, known.size)
    ranks.set(bundle, known)
  }
  /** A bundle read once, and the callers still on it. */
  type Streamed = { pages: Promise<WorldRootsPage[]>; users: number }
  const streamed = new Map<number, Streamed>()
  // A bundle's read is shared by every caller in flight, so it carries no caller's signal: one
  // caller aborting must not fail another's page (`serve` checks its own signal after the read).
  // It is let go once no caller is on it: what stays resident is the holder's and the GPU pool's.
  const serve = async (address: string, signal?: AbortSignal) => {
    const { bundle, offset } = worldRootsPageLocation(address)
    if (!table.bundles[bundle]) throw new Error(`WORLD_PAGE_MISSING: bundle ${bundle}`)
    let own = streamed.get(bundle)
    if (!own) {
      const fresh: Streamed = { pages: bundlePages(bundle), users: 0 }
      fresh.pages.catch(() => void (streamed.get(bundle) === fresh && streamed.delete(bundle)))
      streamed.set(bundle, (own = fresh))
    }
    own.users++
    try {
      const pages = await own.pages,
        index = ranks.get(bundle)?.get(offset) ?? -1
      signal?.throwIfAborted()
      if (index < 0 || index >= pages.length) throw new Error(`WORLD_PAGE_MISSING: ${address}`)
      return pages[index]
    } finally {
      if (--own.users === 0 && streamed.get(bundle) === own) streamed.delete(bundle)
    }
  }
  return {
    /** The bytes of the bundles it reads now past the pinned top that `held` does not hold. */
    keptBytes(held: { has(bundle: number): boolean }) {
      let kept = 0
      for (const bundle of streamed.keys())
        if (bundle >= table.pinned && !held.has(bundle)) kept += table.bundles[bundle].bytes
      return kept
    },
    /** The page at `address`: its geometry page's bytes. */
    page: serve,
    /** The bytes a GPU page slot holds: the page's own, decoded in place as any page's. */
    read: async (key: string, signal?: AbortSignal) => (await serve(key, signal)).bytes,
  }
}

export type WorldPageServer = ReturnType<typeof worldPageServer>
