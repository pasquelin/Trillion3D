// The world stream's own code, a family on demand (`../../session/host/families.ts`): the world pages named at
// their address in the cook's rank. A scene opens without it; it imports no engine code, so the CDN
// bundle makes one chunk of it alone (`scripts/build/bundle-fold.ts`), and the engine's shapes stay the
// core's (`worldHlod.ts`).
//
// A world page (`world-roots.bin`, docs/FORMAT.md, World HLOD) is a `WGP3` geometry page: its
// vertices in world space, with the normals, texture coordinates and colour of the objects it
// merges, a slice of its bundle named where it lies in the binary (`geometryPageAddress`) and
// read by the one reader every page goes through (`worldRuns.ts`), in the shape the engine already
// uploads, binds and draws, no second draw stack and no second BVH (rule 7). The world matrix
// stays the identity: the positions are already in world space, never placed by a per-cluster
// pose.
import type {
  WorldRootsBundle,
  WorldRootsCluster,
} from '../../../../sdk-core/src/manifest/worldRoots.ts'
import {
  geometryPageAddress,
  streamBundleAddress,
} from '../../../../sdk-core/src/page/contracts.ts'
import { refuseWorldRoots } from '../../../../sdk-core/src/manifest/worldRoots.ts'
import { halfNearest } from '../../../../math/src/float/half.ts'
import { parentErrorOf } from '../selection/helpers.ts'
import { appendTo } from '../../../../math/src/sequence/counts.ts'

/** The place a cluster without a page names, bundle and offset (`dag_records.rs`, `nullable`). */
const NO_PLACE = 0xffffffff

/**
 * The world clusters of a table in the cook's rank, each the fields the cut projects, the primitive
 * it wears, its HLOD layer — its cell's actor's HLOD level, `actorLevels`, what the HLOD view
 * paints — and its page named in the binary at `url`, whose `bundles` lie at their
 * offsets, with its facts; the clusters nothing replaces, the structure's `roots`; every cluster
 * of one of an actor's ROOT PAGES — the bundles its HLOD cell lists (`cellPages`, the table's
 * `hlod`): its roots and the coarsest groups the cook packed beside them, as many pages as its
 * layer's always-resident size asks (`compiler/pages/bundles.rs`, `root_pages`) — naming that
 * bundle as its `holder` and `held` by it — its HLOD cell holds it while its actor is loaded,
 * joining the cover (`frame/prepare/worldRoot.ts`), in a grain of the pool's root region —; each
 * cluster's HLOD
 * cell (`hlod`), whose switch shows it (`geometry/dag/worlds/worldLinks.ts`); and each cluster's
 * bundle (`bundleOf`, -1 without a page), whose order a warm-up asks an actor's pages in
 * (`frame/prepare/hlodWarm.ts`). Every band is the cook's, the
 * build's own error, kept as a half float. A cluster out of its rank is refused, `WORLD_CLUSTER_RANK`, since the groups
 * name clusters by rank; one naming a bundle or an HLOD cell the table lacks, `INVALID_CACHE`.
 */
export function worldRootPages(
  clusters: readonly WorldRootsCluster[],
  url: string,
  bundles: readonly Pick<WorldRootsBundle, 'offset'>[],
  actorLevels: ArrayLike<number>,
  cellPages: readonly (readonly number[])[],
) {
  const roots: number[] = [],
    held = new Map<number, number[]>(),
    hlod = new Int32Array(clusters.length),
    bundleOf = new Int32Array(clusters.length)
  /** The root pages the cells hold. */
  const rootPages = new Set(cellPages.flat())
  const pages = clusters.map((cluster, rank) => {
    if (cluster.cluster !== rank)
      throw new Error(`WORLD_CLUSTER_RANK: ${cluster.cluster} at ${rank}`)
    const { bundle, offset, cluster: _rank, hlod: cell, ...cut } = cluster
    // A cluster without a page names no place in the binary, both words none; any other place
    // names a bundle of the table, and every cluster an HLOD cell of the chain.
    const located = bundle !== NO_PLACE
    if (located ? bundle >= bundles.length : offset !== NO_PLACE)
      refuseWorldRoots(`cluster ${rank} bundle ${bundle}`)
    if (cell >= actorLevels.length) refuseWorldRoots(`cluster ${rank} HLOD cell ${cell}`)
    const holder = located && rootPages.has(bundle)
    if (parentErrorOf(cut) === null) roots.push(rank)
    if (holder) appendTo(held, bundle, rank)
    hlod[rank] = cell
    bundleOf[rank] = located ? bundle : -1
    return {
      ...cut,
      // Each error kept as the nearest half float, as a primitive's (`clusterErrorFields`).
      lodError: halfNearest(cut.lodError),
      parentError: cut.parentError === null ? null : halfNearest(cut.parentError),
      layer: actorLevels[cell],
      // Without a place, no page: the record draws none (`worldRecords.ts`).
      url: located ? geometryPageAddress(url, bundles[bundle].offset + offset) : '',
      // The streaming page it lies in, by its catalogue name (`worldRuns.ts`), and where.
      ...(located && {
        stream: { url: streamBundleAddress(url, bundles[bundle].offset), offset },
      }),
      ...(holder && { holder: bundle }),
    }
  })
  return { roots, held, pages, hlod, bundleOf }
}
