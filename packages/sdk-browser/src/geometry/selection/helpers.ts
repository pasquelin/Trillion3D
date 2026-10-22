import {
  CULL_CEIL,
  CULL_CHILD_COUNT,
  CULL_FIRST_CHILD,
  CULL_FIRST_PAGE,
  CULL_FLOOR,
  CULL_PAGE_COUNT,
  CULL_STRIDE,
} from '../dag/types.ts'
import {
  clusterSphereValid,
  pageCarriesClusterError,
  type CullingHierarchy,
  type Page,
  type StreamCatalogue,
} from '../../../../sdk-core/src/contracts/geometry.ts'
import type { PageRec } from './types.ts'
import { halfFloor, halfNearest } from '../../../../math/src/float/half.ts'

/** Validate and unpack the flat culling hierarchy. Absent or malformed, the flat path scans pages.
 *  Each node's subtree replacement bound and floor are kept as half floats, as every error the cut
 *  compares: the bound the nearest half (`halfNearest`), the floor the greatest half at or below
 *  it (`halfFloor`), so a floor never rises above the least own error it bounds. */
export function cullingNodes(culling: CullingHierarchy | null | undefined, pageCount: number) {
  if (
    !culling ||
    !Array.isArray(culling.nodes) ||
    culling.stride < CULL_STRIDE ||
    culling.count < 1
  )
    return undefined
  if (culling.nodes.length !== culling.count * culling.stride)
    throw new Error('Inconsistent culling hierarchy')
  const nodes = Float64Array.from(culling.nodes)
  for (let node = 0; node < culling.count; node++) {
    const base = node * culling.stride,
      children = nodes[base + CULL_CHILD_COUNT]
    // -1 says the subtree holds a cluster nothing replaces; a bound is rounded, a sentinel is not.
    if (nodes[base + CULL_CEIL] >= 0) nodes[base + CULL_CEIL] = halfNearest(nodes[base + CULL_CEIL])
    // A floor above zero is the least own error of clusters a group produced; a floor of zero
    // holds a cluster no group produced.
    if (nodes[base + CULL_FLOOR] > 0) nodes[base + CULL_FLOOR] = halfFloor(nodes[base + CULL_FLOOR])
    if (children > 0) {
      if (nodes[base + CULL_FIRST_CHILD] + children > culling.count)
        throw new Error('Inconsistent culling hierarchy')
      continue
    }
    if (nodes[base + CULL_FIRST_PAGE] + nodes[base + CULL_PAGE_COUNT] > pageCount)
      throw new Error('Inconsistent culling hierarchy')
  }
  return { nodes, stride: culling.stride }
}

/** Only the fields a flat cut needs; a page without them keeps the hierarchy path.
 *  Always the same shape, so every page record stays one hidden class in the selection loop. */
const NO_CLUSTER_ERROR = {
  level: undefined,
  lodError: undefined,
  sphere: undefined,
  parentError: undefined,
  parentSphere: undefined,
  group: undefined,
  source: undefined,
} as const
/**
 * The error band of a cluster, in object units, as the cut certifies it: the cluster's own, and
 * its replacement's, as the compiler published them, nothing added.
 *
 * Both errors are kept as the nearest half float (`halfNearest`), the precision the cut compares
 * every error in: a node's bound (`cullingNodes`) and a group's band (`structureIndex`) alike.
 */
export function clusterErrorFields(
  page: Page,
): Pick<
  PageRec,
  'level' | 'lodError' | 'sphere' | 'parentError' | 'parentSphere' | 'group' | 'source'
> {
  if (!pageCarriesClusterError(page)) return NO_CLUSTER_ERROR
  const parent =
    typeof page.parentError === 'number' && Number.isFinite(page.parentError)
      ? page.parentError
      : null
  if (parent !== null && !(Array.isArray(page.parentSphere) && page.parentSphere.length === 4))
    throw new Error(`Page ${page.id}: parentError without parentSphere`)
  if (parent !== null && parent < page.lodError!)
    throw new Error(`Page ${page.id}: parentError below lodError`)
  // The parent sphere uses the same rule as the page's own sphere: rejected here,
  // at prepare time, never mid-frame. A zero error projects nothing and does not read
  // its sphere; it has nothing to validate.
  if (parent !== null && parent > 0 && !clusterSphereValid(page.parentSphere))
    throw new Error('Invalid cluster parameters')
  const source = typeof page.source === 'number' ? page.source : null
  return {
    level: page.level,
    lodError: halfNearest(page.lodError!),
    sphere: page.sphere,
    parentError: parent === null ? null : halfNearest(parent),
    parentSphere: parent === null ? null : page.parentSphere,
    group: typeof page.group === 'number' ? page.group : null,
    source,
  }
}
/** Bundle URL and offset of every page, and whether its bundle is one of the primitive's root pages
 *  (`streams.pinned`), or undefined when the cache predates streaming bundles. */
export function streamPlacement(
  streams: StreamCatalogue | null | undefined,
  pages: readonly Page[],
) {
  if (!streams || !Array.isArray(streams.pages) || !streams.pages.length) return undefined
  const placement = pages.map((page) => {
    if (typeof page.stream !== 'number' || typeof page.streamOffset !== 'number') return undefined
    const bundle = streams.pages[page.stream]
    if (!bundle) throw new Error(`Page ${page.id} outside streaming bundles`)
    // A page reads its geometry page from the bundle, or its indices where it has none.
    if (page.streamOffset + (page.geometry?.bytes ?? page.count * 4) > bundle.bytes)
      throw new Error(`Page ${page.id} exceeds its bundle`)
    return { url: bundle.url, offset: page.streamOffset, pinned: page.stream < streams.pinned }
  })
  return placement.every((entry) => entry)
    ? (placement as Array<{ url: string; offset: number; pinned: boolean }>)
    : undefined
}
