// The world stream's own code, a family on demand (`../host/families.ts`): the world pages
// named at their address in the cook's rank, and the server that resolves each page in its
// bundle's read. A scene opens without it; it imports no engine code, so the CDN bundle makes
// one chunk of it alone (`scripts/bundle-fold.ts`), and the engine's shapes stay the core's
// (`worldSuperRoots.ts`).
//
// A world page (`world-roots.bin`, docs/FORMAT.md, World super-roots) is a `WGP3` geometry page:
// its vertices in world space, with the normals, texture coordinates and colour of the objects it
// stands for. The server is the ONE page source of the world (`PageSource`), read at a page's world
// address (`worldPageAddress`), in the shape the engine already uploads, binds and draws, no
// second draw stack and no second BVH (rule 7): `read` gives the page's own bytes, which a WebGPU
// page slot holds and its shaders decode in place, as any geometry page's. What stays resident is
// the caller's (`openWorldRoots`: the pinned top and the bundles the placed cells hold) and the GPU
// page pool's, never a second cache or a second shared read here. The world matrix stays the identity: the positions are
// already in world space, never placed by a per-cluster pose.
import { firstTrue } from '../../../math/src/scalar/search.ts'
import {
  firstPage,
  worldPageAddress,
  worldPageLocation,
  type WorldRoots,
  type WorldRootsCluster,
  type WorldRootsPage,
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import type { PageSource } from '../../../sdk-core/src/contracts/cache.ts'

/**
 * The world clusters of a table in the cook's rank, each the fields the cut projects, the primitive
 * it wears and its page named in the binary at `url` with its facts (a super-root; an object
 * root's is left to its own stream), and the clusters nothing replaces, the structure's `roots`:
 * those in the first `pinned` bundles, the world top, the session holds; past them, a root one
 * cell alone needs — a lone object's copy, a material's top only that cell wears — names its
 * bundle as its `holder`, and is `held` by it, joining the cover with its cell
 * (`webgpu/pages/prepare/worldRoot.ts`). With them, each cluster's `origin`, the placed object
 * whose own stream holds an object root's page, -1 for a super-root (the residency mirror reads
 * it, `gpu/dag/residencyMirror.ts`); and the quantization displacement every band is raised by. A
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
      url: bundle === null || offset === null ? '' : worldPageAddress(url, bundle, offset),
      ...(holder !== undefined && { holder }),
    }
  })
  return { roots, held, pages, origins, slack }
}

/** The rank among bundle `bundle`'s pages of the one at `offset`, its records lying in binary
 *  order from the bundle's first (`firstPage`): `page − firstPage(bundle)`, -1 for none. */
function rankAt(table: WorldRoots, bundle: number, offset: number) {
  const first = firstPage(table, bundle),
    count = table.bundles[bundle].count
  if (!count) return -1
  // The first page at or past `offset`: the one there, or none.
  const at = firstTrue(first, first + count - 1, (page) => table.pages.at(page).offset >= offset)
  return table.pages.at(at).offset === offset ? at - first : -1
}

/** The pages of one bundle of the table, verified, in binary order: read through the session's
 *  queue and the bundles' holds (`worldBundles.ts`), which share one read among the callers in
 *  flight, each waiting with its own signal, and hand them the one page list of that read. */
type BundlePages = (
  bundle: number,
  signal?: AbortSignal,
  priority?: number,
) => Promise<WorldRootsPage[]>

/**
 * The page server of `table`, its binary at the resolved `url`, its bundles read through
 * `bundlePages`: a page is resolved at its world address by the pages of its bundle and its rank
 * among them (`rankAt`). A bundle the table does not list, or an offset it does not name, is
 * `WORLD_PAGE_MISSING`. A bundle read lands its other pages too: `landed` is told their addresses
 * once per read — its page list —, so a reader that asks them then joins it — the GPU pool takes
 * them there (`../webgpu/pages/prepare/worldRoot.ts`) — and none is read again. It keeps no read
 * and no page of its own: what stays resident is the holder's and the GPU pool's.
 */
export function worldPageServer(
  table: WorldRoots,
  url: string,
  bundlePages: BundlePages,
  landed?: (addresses: readonly string[]) => void,
) {
  /** The page lists whose other pages were told: one per bundle read. */
  const told = new WeakSet<WorldRootsPage[]>()
  /** The other pages of `bundle` than the one at `rank`, told `landed`. */
  const tellOthers = (bundle: number, rank: number) => {
    const first = firstPage(table, bundle),
      others: string[] = []
    for (let k = 0; k < table.bundles[bundle].count; k++)
      if (k !== rank) others.push(worldPageAddress(url, bundle, table.pages.at(first + k).offset))
    if (others.length) landed?.(others)
  }
  /** The page at `address`, its bundle read at its asker's `priority`. */
  const serve = async (address: string, signal?: AbortSignal, priority?: number) => {
    const { bundle, offset } = worldPageLocation(address)
    if (!table.bundles[bundle]) throw new Error(`WORLD_PAGE_MISSING: bundle ${bundle}`)
    // A caller gone already joins nothing.
    signal?.throwIfAborted()
    const pages = await bundlePages(bundle, signal, priority),
      index = rankAt(table, bundle, offset)
    if (!told.has(pages)) {
      told.add(pages)
      tellOthers(bundle, index)
    }
    signal?.throwIfAborted()
    if (index < 0 || index >= pages.length) throw new Error(`WORLD_PAGE_MISSING: ${address}`)
    return pages[index]
  }
  /** What every address of its pages starts with: its binary's resolved address
   *  (`worldRootPages`), so two worlds' servers never claim each other's pages. */
  const prefix = `${url}#`
  const server = {
    /** Whether `address` names one of its pages: the one test a reader routes a page by. */
    serves: (address: string) => address.startsWith(prefix),
    /** The page at `address`: its geometry page's bytes. */
    page: serve,
    /** The bytes a GPU page slot holds: the page's own, decoded in place as any page's, read at the
     *  admission's `priority`. */
    read: async (key: string, signal?: AbortSignal, priority?: number) =>
      (await serve(key, signal, priority)).bytes,
  }
  return server satisfies PageSource
}

export type WorldPageServer = ReturnType<typeof worldPageServer>
