import { PROXY_CHILDREN, PROXY_CHILD_WORDS, PROXY_NODE_WORDS } from '../../../sdk-core/src/index.ts'
import { refitSchedule } from '../gpu/dag/placementTree.ts'
import { proxyChildCount } from '../../../sdk-core/src/scene/core/proxy.ts'

/**
 * The nodes of a mesh's wide tree by depth, the root's level first, each level's ranks increasing. A
 * node's children link forward (a child's rank is over its parent's, `decodeSceneProxy`), so one pass
 * in rank order finds each depth and each parent. The levels are the engine's one refit schedule
 * (`refitSchedule`, `gpu/dag/placementTree.ts`) over the whole tree: every node of a depth is fitted.
 */
export function poseLevels(nodeChildren: Uint32Array) {
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
  return refitSchedule(
    byDepth.length,
    [],
    (_level, id) => parent[id],
    (level) => byDepth[level],
  )
    .reverse()
    .map(({ ids }) => ids)
}

/**
 * The fit of every pose at once, as the refit's level loop runs it (`gpu/dag/treeRefitLevels.ts`): a
 * step a depth, the deepest first, each step the (pose, node rank) pairs of the poses whose tree
 * reaches that depth — `ids`, two words a pair, step `s` the pairs `[starts[s], starts[s + 1])`. The
 * trees are aligned on their roots: the last step fits every root.
 */
export function poseSchedule(levels: readonly (readonly Uint32Array[])[]) {
  let depth = 0,
    pairs = 0
  for (const tree of levels) {
    depth = Math.max(depth, tree.length)
    for (const level of tree) pairs += level.length
  }
  const ids = new Uint32Array(2 * pairs),
    starts = new Uint32Array(depth + 1)
  let at = 0
  for (let step = 0; step < depth; step++) {
    starts[step] = at
    const level = depth - 1 - step
    levels.forEach((tree, pose) => {
      const ranks = tree[level]
      if (!ranks) return
      for (const rank of ranks) {
        ids[2 * at] = pose
        ids[2 * at + 1] = rank
        at++
      }
    })
  }
  starts[depth] = at
  return { ids, starts, depth }
}
