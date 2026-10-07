import type { PageRec } from './selection.ts'
import type { ClusterRoot } from './types.ts'
import type { PlacementIndex } from './placements.ts'

const NONE: readonly PageRec[] = []

/**
 * The pages a cluster depends on: the clusters of the group that replaces it, read from the
 * compiled group links of its own placement (`structure.outputs`), reached through the placement
 * tables the layout owns. A root depends on nothing. `rankOf` gives a record's first
 * packed rank — a per-page lookup, since one record serves many placements.
 */
export function createPageParents(
  roots: readonly ClusterRoot<PageRec>[],
  placement: PlacementIndex,
  rankOf: (rec: PageRec) => number,
) {
  return (rec: PageRec): readonly PageRec[] => {
    const packed = rankOf(rec),
      root = packed < 0 ? undefined : roots[placement.rootOfPacked[packed]],
      structure = root?.structure,
      group = rec.group
    if (!root || !structure || group == null || group < 0 || group >= structure.groupCount)
      return NONE
    const { outputOffsets, outputs } = structure
    const parents: PageRec[] = []
    for (let i = outputOffsets[group]; i < outputOffsets[group + 1]; i++)
      parents.push(root.pages[outputs[i]])
    return parents
  }
}
