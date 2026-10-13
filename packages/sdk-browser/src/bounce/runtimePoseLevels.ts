import { PROXY_CHILDREN, PROXY_CHILD_WORDS, PROXY_NODE_WORDS } from '../../../sdk-core/src/index.ts'
import { refitSchedule } from '../gpu/dag/placementTree.ts'
import { proxyChildCount } from '../../../sdk-core/src/scene/core/proxy.ts'

/**
 * The nodes of a mesh's wide tree by depth, in the order a fit bottom-up needs them: the levels, then the
 * node ranks of each level (`order`), laid out as
 *
 *     [levels, start₀ … start_levels, node ranks of level 0, of level 1 …]
 *
 * with `startₖ` the first rank of level `k` among the ranks. A node's children link forward (a child's rank is
 * over its parent's, `decodeSceneProxy`), so one pass in rank order finds each depth and each parent. The
 * levels are the placement tree's refit schedule (`refitSchedule`, `gpu/dag/placementTree.ts`) over the
 * whole tree — every node of a depth is fitted, the deepest level first when the pose runs them —, one
 * dispatch a level (`gpu/dag/proxyPose.ts`).
 */
export function poseOrder(nodeChildren: Uint32Array) {
  const nodes = nodeChildren.length / PROXY_NODE_WORDS
  const depth = new Uint32Array(nodes),
    parent = new Uint32Array(nodes)
  const byDepth: number[][] = []
  for (let node = 0; node < nodes; node++) {
    ;(byDepth[depth[node]] ??= []).push(node)
    for (let slot = 0; slot < PROXY_CHILDREN; slot++) {
      const base = node * PROXY_NODE_WORDS + slot * PROXY_CHILD_WORDS
      const words = nodeChildren[base + 1]
      if (words >>> 24 === 0 || proxyChildCount(words) > 0) continue
      const child = nodeChildren[base + 2]
      depth[child] = depth[node] + 1
      parent[child] = node
    }
  }
  const schedule = refitSchedule(
    byDepth.length,
    [],
    (_level, id) => parent[id],
    (level) => byDepth[level],
  ).reverse()
  const levels = schedule.length
  const order = new Uint32Array(1 + levels + 1 + nodes)
  order[0] = levels
  let at = 2 + levels
  schedule.forEach(({ ids }, level) => {
    order[1 + level] = at - (2 + levels)
    order.set(ids, at)
    at += ids.length
  })
  order[1 + levels] = nodes
  return order
}
