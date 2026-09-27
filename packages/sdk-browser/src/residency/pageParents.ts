import type { PageRec } from '../page/selection/selection.ts';
import type { ClusterRoot } from '../page/selection/types.ts';

const NONE: readonly PageRec[] = [];

/**
 * The pages a cluster depends on: the clusters of the group that replaces it, read from the
 * compiled group links of its own placement (`structure.outputs`). A root depends on nothing.
 * `roots` are the selection roots, indexed by the `placementIndex` the layout posts on each page.
 */
export function createPageParents(roots: readonly ClusterRoot<PageRec>[]) {
  return (rec: PageRec): readonly PageRec[] => {
    const root = rec.placementIndex === undefined ? undefined : roots[rec.placementIndex],
      structure = root?.structure,
      group = rec.group;
    if (!root || !structure || group == null || group < 0 || group >= structure.groupCount)
      return NONE;
    const { outputOffsets, outputs } = structure;
    const parents: PageRec[] = [];
    for (let i = outputOffsets[group]; i < outputOffsets[group + 1]; i++)
      parents.push(root.pages[outputs[i]]);
    return parents;
  };
}
