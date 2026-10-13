import { alignUp, workgroupCount } from '../../../../math/src/scalar/integers.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { ClusterRoot } from '../../page/selection/types.ts'
import type { BlendGpuItem } from '../blend/state.ts'
import { createPageCatalogue, type PageList } from '../../page/selection/catalogue.ts'
import { createSparseInts } from '../../page/cut/sparseInts.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'

/** Entries one counting group of the compaction covers. Item ranges are aligned on it, so a group
 *  never spans two items and the per-item prefix is a walk over whole groups. */
export const TRANSPARENT_GROUP = 64

export type TransparentTable = ReturnType<typeof transparentTable>

/** The draw rank of a transparent cluster: the rank its source recorded, the catalogue rank else. */
const drawRank = (rec: PageRec) => rec.sourceOrder ?? rec.id

/**
 * The order the cluster cut visits a primitive's pages in, whatever it ends up keeping.
 *
 * Several clusters of one primitive share a source rank — a coarse cluster inherits the earliest
 * source triangle of the group it replaces — so the rank alone does not order them. What separated
 * them was the order the cut emitted them in, and that order is the culling walk's: a stack, so the
 * children of a node are visited last-pushed-first, and a leaf's pages in their own order. The walk
 * is a property of the tree, not of the camera, and the pages any image keeps are a subsequence of
 * it — which is exactly what a stable sort by rank needs to reproduce the draw order it had.
 */
function visitOrder(root: ClusterRoot<PageRec>) {
  const order = new Int32Array(root.pages.length).fill(root.pages.length)
  const culling = root.culling
  if (!culling) {
    for (let i = 0; i < order.length; i++) order[i] = i
    return order
  }
  const { nodes, stride } = culling
  const stack = [0]
  let rank = 0
  while (stack.length) {
    const base = stack.pop()! * stride,
      children = nodes[base + 12]
    if (children > 0) {
      const first = nodes[base + 11]
      for (let child = 0; child < children; child++) stack.push(first + child)
      continue
    }
    const firstPage = nodes[base + 13]
    for (let i = 0; i < nodes[base + 14]; i++) order[firstPage + i] = rank++
  }
  return order
}

/** Each paged item's catalogue ranks in draw order, and the entries they take once each item's is
 *  aligned on `TRANSPARENT_GROUP`. `roots` are ranked from packed rank `base` on. */
function itemOrders(
  roots: ReadonlyArray<ClusterRoot<PageRec>>,
  paged: readonly BlendGpuItem[],
  base: number,
) {
  /** Where each root's pages start in the catalogue, and how the cut walks them, by the world of
   *  their root: a paged item and the root of its placement read the same one. */
  const rootOfPlacement = new Map<object, { base: number; root: ClusterRoot<PageRec> }>()
  for (const root of roots) {
    const first = root.pages[0]
    if (first?.transparent) rootOfPlacement.set(root.world, { base, root })
    base += root.pages.length
  }
  const orders: number[][] = []
  let length = 0
  for (const item of paged) {
    const owner = rootOfPlacement.get(item.matrix)
    const order: number[] = []
    if (owner) {
      const visited = visitOrder(owner.root)
      const local = owner.root.pages.map((_, index) => index)
      // Source rank first, the cut's own walk to separate the clusters that share one.
      local.sort(
        (a, b) =>
          drawRank(owner.root.pages[a]) - drawRank(owner.root.pages[b]) || visited[a] - visited[b],
      )
      for (const index of local) order.push(owner.base + index)
    }
    orders.push(order)
    length += alignUp(order.length, TRANSPARENT_GROUP)
  }
  return { orders, length }
}

/**
 * The static draw order of every transparent cluster, item by item.
 *
 * A transparent primitive draws its clusters in the order its source recorded — `sourceOrder`, the
 * rank the compiler wrote on each page — and that order is a property of the scene, not of the
 * image: the set selected changes every frame, the order it must be drawn in never does. So the
 * whole catalogue is sorted once here, and what an image adds is only *which* of those entries it
 * keeps. A compaction that preserves the order of its input therefore preserves the draw order
 * exactly, with no sort and no CPU list per image.
 *
 * Each item owns a range aligned on `TRANSPARENT_GROUP`, and its instance list is written in place
 * inside that range, so an item's base is known before the image starts and never moves.
 *
 * The table is the open's order of the items it holds, and `append` is the same function run on the
 * items a session brings later: their ranges follow the held ones, so a table appended to is the
 * table an open of all of them makes. A table full doubles; the rows it holds stay where they are.
 */
export function createTransparentTable(
  roots: ReadonlyArray<ClusterRoot<PageRec>>,
  packedPages: PageList,
  items: readonly BlendGpuItem[],
) {
  const table = transparentTable(createPageCatalogue(packedPages).recordOf)
  table.append(roots, 0, items)
  return table
}

/** An empty table over the catalogue `recordOf` reads. */
function transparentTable(recordOf: (packed: number) => PageRec | undefined) {
  // Each blended instance's entry, plus one: held for them alone, never one word a page.
  const entryPlus = createSparseInts()
  const table = {
    entries: new Uint32Array(0),
    /** Words of the resident page, then the index words it holds: what one instance draws. */
    spans: new Uint32Array(0),
    pageOfEntry: new Int32Array(0),
    itemRanges: new Uint32Array(2),
    /** The entry packed page `page` draws from, -1 when it is no blended instance. */
    entryOf: (page: number) => entryPlus.get(page) - 1,
    /** Items the table describes, in the order the transparent pass draws them. */
    pagedItems: [] as BlendGpuItem[],
    /** Entries in use, including alignment padding. */
    length: 0,
    capacity: 0,
    groupCount: 0,
    /** Vertices one instance draws: the longest index run any transparent cluster holds. */
    maxVertexWords: 0,
    /**
     * The paged items of `items` join the table behind those it holds, their pages ranked from
     * packed rank `base` on in `roots`: O(entries added), and the rows of a table that fills are
     * copied once into one twice as long.
     */
    append(
      roots: ReadonlyArray<ClusterRoot<PageRec>>,
      base: number,
      items: readonly BlendGpuItem[],
    ): void {
      const paged = items.filter((item) => item.paged)
      const { orders, length } = itemOrders(roots, paged, base)
      growEntries(table, table.length + length)
      growItems(table, table.pagedItems.length + paged.length)
      let at = table.length
      for (let item = 0; item < paged.length; item++) {
        const order = orders[item],
          rank = table.pagedItems.length
        paged[item].pagedIndex = rank
        table.pagedItems.push(paged[item])
        table.itemRanges[rank * 2] = at
        table.itemRanges[rank * 2 + 1] = order.length
        for (let i = 0; i < order.length; i++) {
          const pageIndex = order[i],
            entry = at + i,
            words = recordOf(pageIndex)!.triangles * 3
          table.entries[entry] = pageIndex
          table.pageOfEntry[entry] = pageIndex
          entryPlus.set(pageIndex, entry + 1)
          if (words > table.maxVertexWords) table.maxVertexWords = words
        }
        at += alignUp(order.length, TRANSPARENT_GROUP)
      }
      table.length = at
    },
  }
  return table
}

/** The entries of `table` made room for `needed` of them. */
function growEntries(table: TransparentTable, needed: number) {
  if (table.capacity && needed <= table.capacity) return
  const capacity = Math.max(TRANSPARENT_GROUP, needed, table.length ? 2 * table.capacity : 0)
  // Padding entries name no cluster: never selected, never drawn.
  const entries = new Uint32Array(capacity).fill(NO_INDEX)
  entries.set(table.entries)
  const spans = new Uint32Array(capacity * 4)
  spans.set(table.spans)
  const pageOfEntry = new Int32Array(capacity).fill(-1)
  pageOfEntry.set(table.pageOfEntry)
  Object.assign(table, { entries, spans, pageOfEntry, capacity })
  table.groupCount = workgroupCount(capacity, TRANSPARENT_GROUP)
}

/** The item ranges of `table` made room for `needed` items. */
function growItems(table: TransparentTable, needed: number) {
  if (needed * 2 <= table.itemRanges.length) return
  const ranges = new Uint32Array(Math.max(needed, 2 * table.pagedItems.length) * 2)
  ranges.set(table.itemRanges)
  table.itemRanges = ranges
}
