import { CULL_CHILD_COUNT, CULL_FIRST_PAGE, CULL_PAGE_COUNT } from '../dag/types.ts'
import type { ClusterStructureIndex } from '../selection/types.ts'

/** Per DAG: how many of each leaf's clusters a group produced — its open count with nothing
 *  resident; an inner node's is zero. A property of the DAG like its links, derived once and shared
 *  by its placements. */
const baseOpenOf = new WeakMap<CullingLinks, Int32Array>()

export function baseOpen(links: CullingLinks, structure: ClusterStructureIndex) {
  let base = baseOpenOf.get(links)
  if (base) return base
  base = new Int32Array(links.nodeCount)
  for (let page = 0; page < links.leafOfPage.length; page++) {
    const leaf = links.leafOfPage[page]
    if (structure.sources[page] >= 0 && leaf >= 0) base[leaf]++
  }
  baseOpenOf.set(links, base)
  return base
}

/**
 * Upward links of the culling hierarchy: each cluster's leaf node, and the node count. The DAG's
 * shape depends on no world matrix: they are computed once per primitive and shared by all of its
 * instances.
 *
 * They carry a cluster's readiness to the leaf that holds it (`open`), the one node the floor is
 * tested on (`../dag/shader/floorWgsl.ts`), without sweeping the hierarchy.
 */
export type CullingLinks = { nodeCount: number; leafOfPage: Int32Array }

export function cullingLinks(
  { nodes, stride }: { nodes: Float64Array; stride: number },
  pages: number,
): CullingLinks {
  const nodeCount = (nodes.length / stride) | 0
  const leafOfPage = new Int32Array(pages).fill(-1)
  for (let node = 0; node < nodeCount; node++) {
    const base = node * stride
    if (nodes[base + CULL_CHILD_COUNT] > 0) continue
    const firstPage = nodes[base + CULL_FIRST_PAGE],
      pageCount = nodes[base + CULL_PAGE_COUNT]
    for (let i = 0; i < pageCount; i++) leafOfPage[firstPage + i] = node
  }
  return { nodeCount, leafOfPage }
}

/** Links derived for a hierarchy collected without them, shared by its placements and by every
 *  backend that reads it: one `baseOpen` per DAG. */
const linksOf = new WeakMap<Float64Array, CullingLinks>()

/** The hierarchy's own links, or those derived once for it. */
export function linksFor(
  culling: { nodes: Float64Array; stride: number; links?: CullingLinks },
  pages: number,
) {
  if (culling.links) return culling.links
  let links = linksOf.get(culling.nodes)
  if (!links) linksOf.set(culling.nodes, (links = cullingLinks(culling, pages)))
  return links
}
