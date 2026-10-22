import { rootOfPacked, type PlacementIndex } from '../../selection/placements.ts'
import type { DagCutLinks, DagRoot, PackedDag } from '../types.ts'
import { CLUSTER_WORDS, COLD_WORDS, coldBase } from '../layout.ts'
import { createRecordTable } from './packRecords.ts'
import { packWorldLinks, worldLinkWords } from '../worlds/worldLinks.ts'
import { packPlacementTree } from '../placement/placementTreePack.ts'
import { allocatePacking, emptyShared, placeRoot, type Packing } from './packRoots.ts'
import { packPlan, roomFor, type DagCapacity } from './packCapacity.ts'

/**
 * Pack the cluster bands, their box records and the per-primitive culling nodes, at
 * `capacity` — exactly the roots' when none is given.
 *
 * Records are stored once per unique cluster (`packRecords.ts`): the placements of one
 * primitive share them, and the working table names each page's placement, whose record
 * shift leads the page to its record (`../layout.ts`). Nodes are each primitive's once, shared by its
 * placements — a queue entry names the placement beside the node (`../shader/levelWgsl.ts`) —, and the
 * placement tree's are named after them all, held in the tree (`../placement/placementTree.ts`). A packing with room past its roots (a growth's,
 * `grownLength`) takes later placements of its primitives in place (`appendDagRoots`), each a
 * member of its tree and linked to the world DAG as the others.
 */
export function packDagSelection(roots: readonly DagRoot[], capacity?: DagCapacity): PackedDag {
  const shared = emptyShared()
  const plan = packPlan(roots, shared, capacity),
    { worldRoots, tree, room } = plan
  const size: DagCapacity = {
    pages: Math.max(plan.pages, room?.pages ?? 0),
    nodes: plan.nodes,
    worlds: plan.worlds,
  }
  // The table holds the placements' own nodes; the tree's live in its own (`../tree/treeTable.ts`).
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
  const { clusters, coldWords, cold, linkBase, recordSlots } = recordTables(
    roots,
    p,
    records,
    size.pages,
    plan,
  )
  return {
    kind: 'dag',
    clusters,
    nodes: p.nodes,
    coldWords,
    worlds: p.worlds,
    worldSources,
    rootNodes: p.rootNodes,
    rootBases: p.rootBases,
    mark: p.mark,
    drawDistance: p.drawDistance,
    levelSizes: Uint32Array.from(plan.levels, (count) => count ?? 0),
    nodeCount: size.nodes,
    entryCount: plan.entries,
    worldCount: size.worlds,
    pageCount: size.pages,
    recordCount: recordSlots,
    primitiveNodeCount: plan.primitiveNodes,
    pageIndex: p.pageIndex,
    recordShift: p.recordShift,
    rootCount: p.rootClusters,
    pageUrlOf: pageUrlReader(worldSources, p.cutLinks, p.pageIndex),
    cutLinks: p.cutLinks,
    live: p.live,
    ...(room && { shared }),
    ...(tree && { placementTree: tree }),
    ...(worldRoots.length && {
      world: packWorldLinks(roots, worldRoots, plan.worlds, {
        ...{ cutLinks: p.cutLinks, cold, at: linkBase },
      }),
    }),
  }
}

/**
 * The hot records and the cold table of a packing of `pages` pages. The hot record only holds what
 * all five passes of a frame reread; the owner node, the box and the triangles go to the cold. The
 * cold table opens on the residency bits, one word for thirty-two pages, written by delta, then the
 * cold records: no word per page. The placements' links to the world DAG follow the cold records
 * (`../worlds/worldLinks.ts`).
 */
function recordTables(
  roots: readonly DagRoot[],
  p: Packing,
  records: ReturnType<typeof createRecordTable>,
  pages: number,
  { worldRoots, worlds, room }: ReturnType<typeof packPlan>,
) {
  const recordSlots = roomFor(records.count, room?.records, room),
    coldAt = coldBase(pages)
  const linkBase = coldAt + Math.max(1, recordSlots) * COLD_WORDS
  // Every instance of the world DAG shares its records and its cells, each its own states.
  const world = worldRoots[0],
    worldWords =
      world === undefined
        ? 0
        : worldLinkWords(
            worlds,
            p.cutLinks[world],
            roots[world].hlod!.parent.length,
            worldRoots.length,
          )
  const clusters = new Float32Array(Math.max(1, recordSlots) * CLUSTER_WORDS),
    coldWords = new Float32Array(linkBase + worldWords),
    cold = new Uint32Array(coldWords.buffer)
  records.finish(clusters, coldWords, coldAt)
  return { clusters, coldWords, cold, linkBase, recordSlots }
}

/**
 * A page's url is its placement's shared record, the placement read from the page's world word
 * (as `../readiness.ts` does): nothing more is stored per page, as an instance reads
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
