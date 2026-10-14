import { clamp, clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { rootOfPacked, type PlacementIndex } from '../../page/selection/placements.ts'
import type { DagCutLinks, DagRoot, PackedDag } from './types.ts'
import {
  CANDIDATES_START,
  CLUSTER_WORDS,
  COLD_WORDS,
  QUEUE_ENTRIES_START,
  coldBase,
  groupParentBase,
  keyGroupBase,
  keyWordBase,
  recordKeyBase,
} from './layout.ts'
import { KEY_PAGE_MAX, createContentKeys } from './evict.ts'
import { createRecordTable } from './packRecords.ts'
import { packWorldLinks, worldLinkWords } from './worldLinks.ts'
import { packPlacementTree } from './placementTreePack.ts'
import { allocatePacking, emptyShared, placeRoot, type Packing } from './packRoots.ts'
import { packPlan, roomAhead, type DagCapacity } from './packCapacity.ts'

/**
 * Pack the cluster bands, their cone/box records and the per-primitive culling nodes, at
 * `capacity` — exactly the roots' when none is given.
 *
 * Records are stored once per unique cluster (`packRecords.ts`): the placements of one
 * primitive share them, and the working table names each page's placement, whose record
 * shift leads the page to its record (`layout.ts`). Nodes are each primitive's once, shared by its
 * placements — a queue entry names the placement beside the node (`shader/levelWgsl.ts`) —, and the
 * placement tree's are named after them all, held in the tree (`placementTree.ts`). A packing with room past its roots (a growth's,
 * `grownLength`) takes later placements of its primitives in place (`appendDagRoots`), each a
 * member of its tree and linked to the world DAG as the others.
 */
export function packDagSelection(roots: readonly DagRoot[], capacity?: DagCapacity): PackedDag {
  const shared = emptyShared()
  const plan = packPlan(roots, shared, capacity),
    { world, tree, room } = plan
  const size: DagCapacity = {
    pages: Math.max(plan.pages, room?.pages ?? 0),
    nodes: plan.nodes,
    worlds: plan.worlds,
  }
  // A key word names its canonical page on twenty-seven bits (`evict.ts`). Beyond that, the
  // eviction queue would stamp a page for another: better to refuse it by name.
  if (size.pages > KEY_PAGE_MAX)
    throw new Error(`GPU_SELECTION_PAGE_RANGE: ${size.pages} > ${KEY_PAGE_MAX}`)
  // The table holds the placements' own nodes; the tree's live in its own (`treeTable.ts`).
  const p = allocatePacking({ ...size, nodes: plan.primitiveNodes }, shared),
    records = createRecordTable()
  roots.forEach((root, w) =>
    placeRoot(p, root, w, (culling, owner, nodeBase) =>
      records.place(root.pages, culling.nodes, owner, nodeBase),
    ),
  )
  shared.records = records
  const worldSources = [...roots]
  if (tree) packPlacementTree({ ...p, worldSources }, tree)
  const tables = recordTables(roots, p, records, size.pages, plan),
    { clusters, pageCones, cold, linkBase } = tables
  shared.keys = tables.keys
  shared.coldAt = tables.coldAt
  return {
    kind: 'dag',
    clusters,
    nodes: p.nodes,
    pageCones,
    worlds: p.worlds,
    worldSources,
    rootNodes: p.rootNodes,
    rootBases: p.rootBases,
    mark: p.mark,
    levelSizes: Uint32Array.from(plan.levels, (count) => count ?? 0),
    nodeCount: size.nodes,
    entryCount: plan.entries,
    worldCount: size.worlds,
    pageCount: size.pages,
    recordCount: tables.recordSlots,
    keyCount: tables.keyCount,
    primitiveNodeCount: plan.primitiveNodes,
    groupCount: tables.groupCount,
    groupEdges: tables.groupEdges,
    // The lists and queues a view's reach holds, the catalogue's at most: grown on demand.
    candCount: clampLowWins(size.pages, 1, CANDIDATES_START),
    // Queue 0 holds a root slot a placement without a tree (`dagPrepare`): never fewer.
    queueEntries: clamp(plan.worlds, QUEUE_ENTRIES_START, plan.entries),
    pageIndex: p.pageIndex,
    recordShift: p.recordShift,
    rootCount: p.rootClusters,
    pageUrlOf: pageUrlReader(worldSources, p.cutLinks, p.pageIndex),
    cutLinks: p.cutLinks,
    live: p.live,
    ...(room && { shared }),
    ...(tree && { placementTree: tree }),
    ...(world >= 0 && {
      world: packWorldLinks(roots, [world, p.recordShift[world]], plan.worlds, {
        ...{ cutLinks: p.cutLinks, cold, at: linkBase },
      }),
    }),
  }
}

/**
 * The hot records and the cold table of a packing of `pages` pages. The hot record only holds what
 * all five passes of a frame reread; the owner node and the cone go to the cold, which the open
 * pass alone reads. The cold table opens on the residency bits, one word for thirty-two pages,
 * written by delta, then the pool's list, then a content key per unique record and a word per key
 * (`evict.ts`): no word per page. The placements' links to the world DAG follow the cold records
 * (`worldLinks.ts`).
 */
function recordTables(
  roots: readonly DagRoot[],
  p: Packing,
  records: ReturnType<typeof createRecordTable>,
  pages: number,
  { world, worlds, room }: ReturnType<typeof packPlan>,
) {
  // Placed in order behind one another: the keys and groups are made as an appended root's are.
  const content = createContentKeys()
  roots.forEach((root, w) =>
    content.place(root, p.cutLinks[w].pageBase, (p.cutLinks[w].pageBase + p.recordShift[w]) >>> 0),
  )
  const recordSlots = Math.max(
      records.count,
      room?.records ?? 0,
      room?.ahead ? roomAhead(records.count) : 0,
    ),
    keys = Math.max(content.count, room?.keys ?? 0, room?.ahead ? roomAhead(content.count) : 0),
    groups = Math.max(
      content.groups,
      room?.groups ?? 0,
      room?.ahead ? roomAhead(content.groups) : 0,
    ),
    edges = Math.max(content.edges, room?.edges ?? 0, room?.ahead ? roomAhead(content.edges) : 0),
    shape = {
      pageCount: pages,
      recordCount: recordSlots,
      keyCount: Math.max(1, keys),
      groupCount: groups,
      groupEdges: edges,
    },
    coldAt = coldBase(shape)
  const linkBase = coldAt + Math.max(1, recordSlots) * COLD_WORDS
  const clusters = new Float32Array(Math.max(1, recordSlots) * CLUSTER_WORDS),
    pageCones = new Float32Array(linkBase + (world >= 0 ? worldLinkWords(worlds) : 0)),
    cold = new Uint32Array(pageCones.buffer)
  const at = {
    recordKey: recordKeyBase(pages),
    keyWord: keyWordBase(shape),
    keyGroup: keyGroupBase(shape),
    groupParent: groupParentBase(shape),
    groupCapacity: shape.groupCount,
  }
  content.flush(cold, at)
  records.finish(clusters, pageCones, coldAt)
  return { clusters, pageCones, cold, linkBase, ...shape, recordSlots, keys: content, coldAt }
}

/**
 * A page's url is its placement's shared record, the placement read from the page's world word
 * (as `readiness.ts` does): nothing more is stored per page, as an instance reads
 * its primitive's clusters from its base. Built outside `packDagSelection` so the reader keeps
 * only these, not the packing's working state.
 */
function pageUrlReader(
  roots: readonly DagRoot[],
  cutLinks: readonly DagCutLinks[],
  pageIndex: PlacementIndex,
) {
  return (page: number) => {
    const w = rootOfPacked(pageIndex, page)
    return w < 0 ? undefined : roots[w]?.pages[page - cutLinks[w].pageBase]?.url
  }
}
