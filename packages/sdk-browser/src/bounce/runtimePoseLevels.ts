import { PROXY_CHILDREN, PROXY_CHILD_WORDS, PROXY_NODE_WORDS } from '../../../sdk-core/src/index.ts'
import { proxyChildCount } from '../../../sdk-core/src/scene/core/proxy.ts'

/**
 * The nodes of a mesh's wide tree by depth, in the order a fit bottom-up needs them: the levels, then the
 * node ranks of each level (`order`), laid out as
 *
 *     [levels, start₀ … start_levels, node ranks of level 0, of level 1 …]
 *
 * with `startₖ` the first rank of level `k` among the ranks. A node's children link forward (a child's rank is
 * over its parent's, `decodeSceneProxy`), so one pass in rank order finds each depth, and a fit that runs the
 * levels from the deepest to the root finds every child's bounds fitted when it reads them. The same walk as
 * the placement tree's refit, one dispatch a level (`gpu/dag/proxyPose.ts`).
 */
export function nodeLevels(nodeChildren: Uint32Array) {
  const nodes = nodeChildren.length / PROXY_NODE_WORDS
  const depth = new Uint32Array(nodes)
  let levels = nodes ? 1 : 0
  for (let node = 0; node < nodes; node++)
    for (let slot = 0; slot < PROXY_CHILDREN; slot++) {
      const base = node * PROXY_NODE_WORDS + slot * PROXY_CHILD_WORDS
      const words = nodeChildren[base + 1]
      if (words >>> 24 === 0 || proxyChildCount(words) > 0) continue
      const child = nodeChildren[base + 2]
      depth[child] = depth[node] + 1
      levels = Math.max(levels, depth[child] + 1)
    }
  const counts = new Uint32Array(levels + 1)
  for (const d of depth) counts[d + 1]++
  for (let level = 0; level < levels; level++) counts[level + 1] += counts[level]
  const order = new Uint32Array(1 + levels + 1 + nodes)
  order[0] = levels
  order.set(counts, 1)
  const next = counts.slice(0, levels)
  for (let node = 0; node < nodes; node++) order[2 + levels + next[depth[node]]++] = node
  return order
}
