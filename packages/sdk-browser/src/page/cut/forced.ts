import type { ClusterStructureIndex } from '../selection/types.ts';
import type { CullingLinks } from './readiness.ts';

/** Forcing marks of an instance: how many forced clusters each subtree contains.
 *  Zero means "no forced group here", the only read the descent makes of it. */
export type ForcedMarks = Int32Array;

/** Carries a cluster and its ancestors to the mark `delta`. A cluster outside the hierarchy carries nothing. */
function markPage(links: CullingLinks, marks: ForcedMarks, page: number, delta: number) {
  let node = links.leafOfPage[page];
  while (node >= 0) {
    marks[node] += delta;
    node = links.parents[node];
  }
}

/**
 * Marks (`delta` 1) or unmarks (`delta` -1) the nodes this group touches: those whose subtree
 * contains a cluster the group produces or a cluster it replaces. Those are exactly the two
 * reads `drawnUnderForcing` makes of the forced-group array, `forced[source]` and `forced[group]`;
 * outside those subtrees, forcing changes nothing.
 *
 * The cost is that of the group's clusters, times the depth of the hierarchy: a forced group
 * touches a few dozen, never the whole primitive.
 *
 * The manifest's group links are the only source: `outputs` names the clusters whose `source` is
 * this group, `children` those whose `group` is. That is the correspondence `forceCoarse` already
 * lives on — it pushes `pages[structure.outputs[i]]` then re-reads `rec.group` — not a second
 * table derived from the records.
 */
export function markForcedGroup(
  links: CullingLinks,
  marks: ForcedMarks,
  structure: ClusterStructureIndex,
  group: number,
  delta: number,
) {
  const { childOffsets, children, outputOffsets, outputs } = structure;
  for (let i = childOffsets[group]; i < childOffsets[group + 1]; i++)
    markPage(links, marks, children[i], delta);
  for (let i = outputOffsets[group]; i < outputOffsets[group + 1]; i++)
    markPage(links, marks, outputs[i], delta);
}
