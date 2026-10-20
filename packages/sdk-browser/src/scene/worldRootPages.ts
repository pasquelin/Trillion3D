// The world stream's own code, a family on demand (`../host/families.ts`): the world pages named at
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
} from '../../../sdk-core/src/manifest/worldRoots.ts'
import { geometryPageAddress } from '../../../sdk-core/src/page/contracts.ts'
import { refuseWorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts'

/** The place a cluster without a page names, bundle and offset (`dag_records.rs`, `nullable`). */
const NO_PLACE = 0xffffffff

/**
 * The world clusters of a table in the cook's rank, each the fields the cut projects, the primitive
 * it wears, its HLOD layer — its cell's level, `levels`, plus one — and its page named in the binary at `url`, whose `bundles` lie at their
 * offsets, with its facts; the clusters nothing replaces, the structure's `roots`, each naming its
 * bundle as its `holder` and `held` by it — its HLOD cell holds it while its actor is
 * loaded, joining the cover (`webgpu/pages/prepare/worldRoot.ts`) —; and each cluster's HLOD
 * cell (`hlod`), whose switch shows it (`gpu/dag/worldLinks.ts`). Every band is the cook's, the
 * build's own error. A cluster out of its rank is refused, `WORLD_CLUSTER_RANK`, since the groups
 * name clusters by rank; one naming a bundle or an HLOD cell the table lacks, `INVALID_CACHE`.
 */
export function worldRootPages(
  clusters: readonly WorldRootsCluster[],
  url: string,
  bundles: readonly Pick<WorldRootsBundle, 'offset'>[],
  levels: ArrayLike<number>,
) {
  const roots: number[] = [],
    held = new Map<number, number[]>(),
    hlod = new Int32Array(clusters.length)
  const pages = clusters.map((cluster, rank) => {
    if (cluster.cluster !== rank)
      throw new Error(`WORLD_CLUSTER_RANK: ${cluster.cluster} at ${rank}`)
    const { bundle, offset, cluster: _rank, hlod: cell, ...cut } = cluster
    // A cluster without a page names no place in the binary, both words none; any other place
    // names a bundle of the table, and every cluster an HLOD cell of the chain.
    const located = bundle !== NO_PLACE
    if (located ? bundle >= bundles.length : offset !== NO_PLACE)
      refuseWorldRoots(`cluster ${rank} bundle ${bundle}`)
    if (cell >= levels.length) refuseWorldRoots(`cluster ${rank} HLOD cell ${cell}`)
    const root = cut.parentError === null,
      holder = root && located
    if (root) roots.push(rank)
    if (holder) {
      const ranks = held.get(bundle)
      if (ranks) ranks.push(rank)
      else held.set(bundle, [rank])
    }
    hlod[rank] = cell
    return {
      ...cut,
      layer: levels[cell] + 1,
      // Without a place, no page: the record draws none (`worldRecords.ts`).
      url: located ? geometryPageAddress(url, bundles[bundle].offset + offset) : '',
      ...(holder && { holder: bundle }),
    }
  })
  return { roots, held, pages, hlod }
}
