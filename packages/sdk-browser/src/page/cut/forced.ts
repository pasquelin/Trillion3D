import type { ClusterStructureIndex } from '../selection/types.ts';

/**
 * Upward links of the culling hierarchy: each node's parent, each cluster's leaf node. The DAG's
 * shape depends on no world matrix: these two arrays are computed once per primitive and shared
 * by all of its instances.
 *
 * They serve one thing: knowing, without sweeping a subtree, whether a forced group touches it.
 * The forcing fallback does not test the cut but the forced group — a subtree that no forced
 * group touches therefore decides like the ordinary cut, and a touched subtree is descended.
 */
export type CullingLinks = { parents: Int32Array; leafOfPage: Int32Array };

/** Forcing marks of an instance: how many forced clusters each subtree contains.
 *  Zero means "no forced group here", the only read the descent makes of it. */
export type ForcedMarks = Int32Array;

export function cullingLinks(
  { nodes, stride }: { nodes: Float64Array; stride: number },
  pages: number,
): CullingLinks {
  const count = (nodes.length / stride) | 0;
  const parents = new Int32Array(count).fill(-1),
    leafOfPage = new Int32Array(pages).fill(-1);
  for (let node = 0; node < count; node++) {
    const base = node * stride,
      children = nodes[base + 12];
    if (children > 0) {
      const first = nodes[base + 11];
      for (let child = 0; child < children; child++) parents[first + child] = node;
      continue;
    }
    const firstPage = nodes[base + 13],
      pageCount = nodes[base + 14];
    for (let i = 0; i < pageCount; i++) leafOfPage[firstPage + i] = node;
  }
  return { parents, leafOfPage };
}

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
