// A fixture world DAG ranked as the cook ranks its own: in the order of its culling hierarchy.
import { buildCullingHierarchy } from '../page/codec/cullingHierarchy.ts'
import { sdkWasm } from '../wasm/sdkWasm.fixture.ts'
import type { ClusterGroup, CullingHierarchy } from '../../../sdk-core/src/contracts/geometry.ts'
import type { WorldRootsCluster } from '../../../sdk-core/src/manifest/worldRoots.ts'

/**
 * `dag` as the cook writes it (`compiler_world_roots/merge.rs`, `in_culling_order`): its clusters
 * ranked in the order of the culling hierarchy the one builder gives them, the groups' children and
 * outputs renumbered with them, and that hierarchy. In place: the caller's arrays are the DAG's.
 */
export function inCullingOrder<C extends WorldRootsCluster>(dag: {
  clusters: C[]
  groups: ClusterGroup[]
  culling?: CullingHierarchy
}) {
  const { order, culling } = buildCullingHierarchy(sdkWasm, dag.clusters)
  const rank = new Array<number>(order.length)
  order.forEach((slot, at) => (rank[slot] = at))
  const ranked = Array.from(order, (slot, at) => ({ ...dag.clusters[slot], cluster: at }))
  ranked.forEach((cluster, at) => (dag.clusters[at] = cluster))
  for (const group of dag.groups) {
    group.children = group.children.map((child) => rank[child])
    group.outputs = group.outputs.map((output) => rank[output])
  }
  dag.culling = culling
  return dag
}
