import type { ClusterStructureIndex } from '../selection/types.ts';

/** Per DAG: how many of each node's clusters a group produced — its open count with nothing
 *  resident. A property of the DAG like its links, derived once and shared by its placements. */
const baseOpenOf = new WeakMap<CullingLinks, Int32Array>();

export function baseOpen(
  links: CullingLinks,
  structure: ClusterStructureIndex,
  pageCount: number,
  nodeCount: number,
) {
  let base = baseOpenOf.get(links);
  if (base?.length === nodeCount) return base;
  base = new Int32Array(nodeCount);
  for (let page = 0; page < pageCount; page++)
    if (structure.sources[page] >= 0)
      for (let node = links.leafOfPage[page]; node >= 0; node = links.parents[node]) base[node]++;
  baseOpenOf.set(links, base);
  return base;
}

/**
 * Upward links of the culling hierarchy: each node's parent, each cluster's leaf node. The DAG's
 * shape depends on no world matrix: these two arrays are computed once per primitive and shared
 * by all of its instances.
 *
 * They carry a cluster's readiness up to the nodes that hold it (`open`), without sweeping a
 * subtree.
 */
export type CullingLinks = { parents: Int32Array; leafOfPage: Int32Array };

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
