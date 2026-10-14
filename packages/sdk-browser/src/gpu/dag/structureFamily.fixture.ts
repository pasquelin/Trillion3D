import { structureIndex } from '../../page/selection/structure.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import type { ClusterStructureIndex } from '../../page/selection/types.ts'

/**
 * A generated group structure: `leaves` finest clusters, each level's clusters shuffled into groups
 * of one to `widest` members, each group making one to as many outputs as members — the next
 * level, shuffled again, so a group's outputs go to several parents —, until a level holds four
 * clusters or fewer: the roots, which nothing replaces. Pages are the clusters, finest first.
 */
export function structureFamily(seed: number, leaves: number, widest = 6): ClusterStructureIndex {
  const random = lcgRandom(seed)
  const pick = (n: number) => Math.floor(random() * n)
  const shuffled = (list: number[]) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = pick(i + 1)
      ;[list[i], list[j]] = [list[j], list[i]]
    }
    return list
  }
  let pages = leaves,
    level = Array.from({ length: leaves }, (_, i) => i)
  const groups: { children: number[]; outputs: number[] }[] = []
  while (level.length > 4) {
    const next: number[] = []
    shuffled(level)
    for (let at = 0; at < level.length;) {
      const children = level.slice(at, (at += 1 + pick(widest)))
      const outputs = Array.from(
        { length: 1 + pick(Math.max(1, children.length - 1)) },
        () => pages++,
      )
      groups.push({ children, outputs })
      next.push(...outputs)
    }
    if (next.length >= level.length) next.length = Math.max(1, level.length - 1)
    level = next
  }
  // Outputs a shortened level dropped are produced by their group still, and owned by none.
  const made = groups.map((g) => ({ level: 0, error: 1, sphere: [0, 0, 0, 1], ...g }))
  const owned = new Set(groups.flatMap((g) => g.children))
  const roots = Array.from({ length: pages }, (_, p) => p).filter(
    (p) => p >= leaves && !owned.has(p),
  )
  return structureIndex({ version: 1, roots, groups: made } as never, pages)!
}
