// A fixture world DAG with the culling hierarchy the cook writes beside its clusters.
import { manifestCulling } from '../dag/culling.fixture.ts'
import type { ClusterGroup, CullingHierarchy } from '../../../../sdk-core/src/contracts/geometry.ts'
import type { WorldRootsCluster } from '../../../../sdk-core/src/manifest/worldRoots.ts'

/**
 * `dag` as the cook writes it (`chain/merge.rs`, `in_culling_order`), its clusters at their ranks
 * with the hierarchy the one builder gives them, each cluster a leaf of its own (`manifestCulling`).
 * In place: the caller's arrays are the DAG's.
 */
export function inCullingOrder<C extends WorldRootsCluster>(dag: {
  clusters: C[]
  groups: ClusterGroup[]
  culling?: CullingHierarchy
}) {
  dag.culling = manifestCulling(dag.clusters)
  return dag
}
