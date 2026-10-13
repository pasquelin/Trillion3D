import { maxStretch } from '../../../../sdk-core/src/index.ts'
import { sameMatrixFloat32 } from '../../../../math/src/matrix/matrixElements.ts'
import { clamp, clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { rootOfPacked, type PlacementIndex } from '../../page/selection/placements.ts'

import { SELECTION_NONE as NONE } from '../core/selection.ts'
import {
  DAG_NODE_FLOATS,
  type DagCutLinks,
  type DagPackShared,
  type DagRoot,
  type PackedDag,
} from './types.ts'
import { baseOpen, linksFor } from '../../page/cut/links.ts'
import { cullingBoundsFor, packCullingNodes } from './packNodes.ts'
import { flatHierarchy, hierarchyLevelSizes } from './hierarchy.ts'
import {
  CANDIDATES_START,
  CLUSTER_WORDS,
  COLD_WORDS,
  QUEUE_ENTRIES_START,
  coldBase,
  keyWordBase,
  recordKeyBase,
} from './layout.ts'
import { KEY_PAGE_MAX, keyCount, writeKeyTables } from './evict.ts'
import { createRecordTable } from './packRecords.ts'
import { packWorldLinks, worldLinkWords } from './worldLinks.ts'
import {
  joinPlacementTree,
  joinStart,
  packPlacementTree,
  placementTreeShape,
  treeNodeCount,
} from './placementTree.ts'

/** The first page of a placement the room holds and no root filled: past every page. */
const ROOM_BASE = 0x7fffffff

type Culling = NonNullable<DagRoot['culling']>

/** Room a packing keeps past its live pages, queue entries (`nodes`: a placement's node each) and
 *  placements, for roots a growth appends (`appendDagRoots`): inert — no root names them — until
 *  one does. Placements of packed primitives add no node: they share theirs. */
export type DagCapacity = { pages: number; nodes: number; worlds: number }

type PackShared = DagPackShared
const emptyShared = (): PackShared => ({
  flats: new Map(),
  levelSizesOf: new Map(),
  boundsOf: new Map(),
  firstOf: new Map(),
  nodeBlocks: new Map(),
})

/** The tables a packing writes a root into, and its live counts (`placeRoot`). */
type Packing = Pick<
  PackedDag,
  'nodes' | 'worlds' | 'worldStretch' | 'rootNodes' | 'rootBases' | 'mark' | 'recordShift'
> & {
  nodeInts: Uint32Array
  pageIndex: PlacementIndex
  cutLinks: DagCutLinks[]
  live: NonNullable<PackedDag['live']>
  shared: PackShared
  rootClusters: number
}

/** Every primitive descends the same hierarchy: the manifest's, or the one packing gives it — once
 *  per page array, so placements sharing their pages share it too. */
function cullingOf(root: DagRoot, shared: PackShared) {
  if (root.culling) return root.culling
  let flat = shared.flats.get(root.pages)
  if (!flat) shared.flats.set(root.pages, (flat = flatHierarchy(root.pages)))
  return flat
}

/** A node array's level sizes, walked once per array: every placement of a primitive shares it. */
function levelSizesOf(culling: Culling, shared: PackShared) {
  let sizes = shared.levelSizesOf.get(culling.nodes)
  if (!sizes) {
    sizes = hierarchyLevelSizes(culling.nodes, culling.stride)
    shared.levelSizesOf.set(culling.nodes, sizes)
  }
  return sizes
}

/**
 * The nodes of `root`'s primitive in the node table, packed behind the live ones at its first
 * placement and shared by every later one: each node's first page counted from the primitive's,
 * its open count the DAG's with nothing resident (`baseOpen`), and the node owning each page.
 */
function nodeBlockOf(p: Packing, root: DagRoot, culling: Culling) {
  const known = p.shared.nodeBlocks.get(culling.nodes)
  if (known) return known
  const count = root.pages.length,
    nodeBase = p.live.nodes,
    owner = new Uint32Array(count).fill(NONE)
  const bounds = cullingBoundsFor(culling, root.pages, p.shared.boundsOf)
  const open = root.structure && baseOpen(linksFor(culling, count), root.structure)
  const place = { nodeBase, pageBase: 0 }
  const nodeCount = packCullingNodes(p.nodes, p.nodeInts, culling, bounds, place, owner, open)
  const block = { nodeBase, nodeCount, owner }
  p.shared.nodeBlocks.set(culling.nodes, block)
  p.live.nodes += nodeCount
  return block
}

/**
 * Root `root` packed as placement `w`, behind the live pages: its world, stretch, root node — its
 * primitive's, shared — and mark, its links, its pages' placement words, and the shift that leads
 * its pages to their records, the first record `recordBase` gives for its owner nodes.
 */
function placeRoot(
  p: Packing,
  root: DagRoot,
  w: number,
  recordBase: (culling: Culling, owner: Uint32Array, nodeBase: number) => number,
) {
  const culling = cullingOf(root, p.shared),
    pageBase = p.live.pages,
    count = root.pages.length
  const { nodeBase, nodeCount, owner } = nodeBlockOf(p, root, culling)
  p.worlds.set(root.world.elements, w * 16)
  p.worldStretch[w] = maxStretch(root.world.elements)
  p.rootBases[w] = nodeBase
  p.rootNodes[w] = root.parked ? NONE : nodeBase
  p.mark[w] = root.mark ?? 0
  const links = linksFor(culling, count)
  const { structure } = root
  p.cutLinks.push({ structure, links, pageBase, pageCount: count, nodeBase, nodeCount })
  // A page array placed before, on the same nodes, has its records: one lookup, no record written.
  let first = p.shared.firstOf.get(root.pages)
  const base =
    first?.nodes === culling.nodes ? first.recordBase : recordBase(culling, owner, nodeBase)
  if (!first)
    p.shared.firstOf.set(
      root.pages,
      (first = {
        pageBase,
        recordBase: base,
        nodes: culling.nodes,
        rootClusters: rootClusterCount(root),
      }),
    )
  p.recordShift[w] = (base - pageBase) >>> 0
  p.pageIndex.baseOfRoot[w] = pageBase
  p.rootClusters += first.rootClusters
  p.live.pages += count
  p.pageIndex.packedCount = p.live.pages
  p.live.entries += nodeCount
  p.live.worlds = w + 1
}

/** The pages of `root` whose parent error is not finite: the clusters a view starts a descent on. */
function rootClusterCount(root: DagRoot) {
  let count = 0
  for (const rec of root.pages)
    if (!(typeof rec.parentError === 'number' && Number.isFinite(rec.parentError))) count++
  return count
}

/** The live counts of `roots` — pages, queue entries (a placement's node each), and nodes, each
 *  primitive's once —, their levels summed level by level: pass `L`'s queue only holds entries of
 *  level `L`, so this total upper-bounds it, and the pass launches flat. Placement `w`'s levels lie
 *  `shift(w)` below the placement tree's (`placementTree.ts`). */
function countRoots(
  roots: readonly DagRoot[],
  shared: PackShared,
  shift: (w: number) => number = () => 0,
) {
  let pages = 0,
    entries = 0,
    nodes = 0
  const levels: number[] = [],
    seen = new Set<Float64Array>()
  roots.forEach((root, w) => {
    const culling = cullingOf(root, shared),
      sizes = levelSizesOf(culling, shared),
      below = shift(w),
      count = culling.nodes.length / culling.stride
    pages += root.pages.length
    entries += count
    if (!seen.has(culling.nodes)) nodes += count
    seen.add(culling.nodes)
    for (let level = 0; level < sizes.length; level++)
      levels[level + below] = (levels[level + below] ?? 0) + sizes[level]
  })
  return { pages, entries, nodes, levels }
}

/** The pages, queue entries (`nodes`) and placements `roots` fill: what a growth's capacity starts
 *  from. */
export function dagRootCounts(roots: readonly DagRoot[]): DagCapacity {
  const { pages, entries } = countRoots(roots, emptyShared())
  return { pages, nodes: entries, worlds: roots.length }
}

/** A packing's tables at `capacity`: every placement past the live ones parked, every page past
 *  them in no placement (`NONE`). */
function allocatePacking(capacity: DagCapacity, shared: PackShared): Packing {
  const nodes = new Float32Array(Math.max(1, capacity.nodes) * DAG_NODE_FLOATS),
    worldSlots = Math.max(1, capacity.worlds)
  return {
    nodes,
    nodeInts: new Uint32Array(nodes.buffer),
    // Each placement's first page; the room past the live ones names no page (`rootOfPacked`).
    pageIndex: { baseOfRoot: new Int32Array(worldSlots).fill(ROOM_BASE), packedCount: 0 },
    worlds: new Float32Array(worldSlots * 16),
    worldStretch: new Float32Array(worldSlots),
    recordShift: new Uint32Array(worldSlots),
    // Each primitive's root, which prepare deposits in pass 0's queue; a parked row deposits none,
    // and `rootBases` keeps the node it takes back.
    rootNodes: new Uint32Array(worldSlots).fill(NONE),
    rootBases: new Uint32Array(worldSlots).fill(NONE),
    // The whole frame word: the mark's bits, and the deformation reach above them (`markReach`).
    mark: new Uint32Array(worldSlots),
    cutLinks: [],
    live: { pages: 0, nodes: 0, worlds: 0, entries: 0 },
    shared,
    rootClusters: 0,
  }
}

/**
 * What a packing of `roots` at `capacity` holds before any is written: its live counts, the
 * placement tree over every placement but the world DAG's — wherever it sits, which starts its own
 * descent —, laid out for the capacity's placements, and its levels: a member's lie below the
 * tree's. The world DAG's rank is named (`PackedWorld.root`), so a packing that holds it keeps
 * room as any other, its links laid out for every placement the room takes.
 */
function packPlan(roots: readonly DagRoot[], shared: PackShared, capacity?: DagCapacity) {
  const world = roots.findIndex((root) => root.origins),
    room = capacity,
    worlds = Math.max(roots.length, room?.worlds ?? 0),
    members = worlds - (world >= 0 ? 1 : 0)
  // The tree's nodes follow the primitives' shared ones: an append adds none of either.
  const first = countRoots(roots, shared)
  const tree = placementTreeShape(roots, world, { members, worlds }, first.nodes)
  const shift = tree?.depth ?? 0
  const counted = shift ? countRoots(roots, shared, (w) => (w === world ? 0 : shift)) : first
  tree?.levels.forEach(({ count }, l) => (counted.levels[l] = (counted.levels[l] ?? 0) + count))
  const treeNodes = treeNodeCount(tree),
    nodes = first.nodes + treeNodes
  // Every placement's entry for each of its nodes — the room's included —, one at least for each
  // placement's root slot (`dagPrepare`), then the tree's.
  const entries = Math.max(first.entries, room?.nodes ?? 0, worlds) + treeNodes
  return { ...counted, nodes, entries, tree, world, room, worlds }
}

/**
 * Pack the cluster bands, their cone/box records and the per-primitive culling nodes, at
 * `capacity` — exactly the roots' when none is given.
 *
 * Records are stored once per unique cluster (`packRecords.ts`): the placements of one
 * primitive share them, and the working table names each page's placement, whose record
 * shift leads the page to its record (`layout.ts`). Nodes are each primitive's once, shared by its
 * placements — a queue entry names the placement beside the node (`shader/levelWgsl.ts`) —, and the
 * placement tree's follow them all (`placementTree.ts`). A packing with room past its roots (a growth's,
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
  const p = allocatePacking(size, shared),
    records = createRecordTable()
  roots.forEach((root, w) =>
    placeRoot(p, root, w, (culling, owner, nodeBase) =>
      records.place(root.pages, culling.nodes, owner, nodeBase),
    ),
  )
  const worldSources = [...roots]
  if (tree) packPlacementTree({ ...p, worldSources }, tree)
  const tables = recordTables(roots, p, records, size.pages, plan),
    { clusters, pageCones, cold, linkBase } = tables
  return {
    kind: 'dag',
    clusters,
    nodes: p.nodes,
    pageCones,
    worlds: p.worlds,
    worldSources,
    worldStretch: p.worldStretch,
    rootNodes: p.rootNodes,
    rootBases: p.rootBases,
    mark: p.mark,
    levelSizes: Uint32Array.from(plan.levels, (count) => count ?? 0),
    nodeCount: size.nodes,
    entryCount: plan.entries,
    worldCount: size.worlds,
    pageCount: size.pages,
    recordCount: records.count,
    keyCount: tables.keyCount,
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
 * (`evict.ts`): no word per page. The tree's order rides behind the cold records: what its groups
 * name their members by; the placements' links to the world DAG follow it (`worldLinks.ts`).
 */
function recordTables(
  roots: readonly DagRoot[],
  p: Packing,
  records: ReturnType<typeof createRecordTable>,
  pages: number,
  { tree, world, worlds }: ReturnType<typeof packPlan>,
) {
  const recordSlots = Math.max(1, records.count),
    keys = keyCount(roots),
    shape = { pageCount: pages, recordCount: records.count, keyCount: keys },
    coldAt = coldBase(shape)
  // The tree's order behind the cold records, for every member slot.
  const members = coldAt + recordSlots * COLD_WORDS,
    linkBase = members + (tree?.capacity ?? 0)
  const clusters = new Float32Array(recordSlots * CLUSTER_WORDS),
    pageCones = new Float32Array(linkBase + (world >= 0 ? worldLinkWords(worlds) : 0)),
    cold = new Uint32Array(pageCones.buffer)
  if (tree) cold.set(tree.order, (tree.members = members))
  const at = { recordKey: recordKeyBase(pages), keyWord: keyWordBase(shape) }
  writeKeyTables(roots, p, cold, at)
  records.finish(clusters, pageCones, coldAt)
  return { clusters, pageCones, cold, linkBase, keyCount: keys }
}

/** The live ranges `appendDagRoots` filled: pages and placements `[from, to)` — no node: an
 *  appended placement reads its primitive's —, and the placement tree's nodes it rewrote and member
 *  slots it filled. */
export type DagAppended = {
  pages: readonly [number, number]
  worlds: readonly [number, number]
  tree: { nodes: Int32Array; members: readonly [number, number] }
}

/**
 * `roots` packed in place behind the live ones, into the room `packed` kept (`DagCapacity`): each
 * a later placement of a primitive it holds — the page array of a root already packed —, so its
 * records are that root's and its pages' content keys the canonical ones that root's name. The
 * tables then read as a packing of every root at that capacity would: the same words, appended.
 * `undefined` when they do not fit, or name a primitive the packing does not hold — the caller
 * packs them all again, at a grown capacity.
 */
export function appendDagRoots(
  packed: PackedDag,
  roots: readonly DagRoot[],
): DagAppended | undefined {
  const { shared, live } = packed
  if (!shared || !live || !fitsRoom(packed, roots, shared)) return undefined
  const from = { ...live },
    words = new Uint32Array(packed.pageCones.buffer, packed.pageCones.byteOffset),
    tree = packed.placementTree,
    batch: number[] = []
  const p: Packing = {
    ...packed,
    nodeInts: new Uint32Array(packed.nodes.buffer, packed.nodes.byteOffset, packed.nodes.length),
    live,
    shared,
    rootClusters: packed.rootCount,
  }
  for (const root of roots) {
    // Its records are its template's, and their keys with them (`writeKeyTables`).
    const first = shared.firstOf.get(root.pages)!
    placeRoot(p, root, live.worlds, () => first.recordBase)
    const sizes = levelSizesOf(cullingOf(root, shared), shared),
      shift = tree?.depth ?? 0
    for (let level = 0; level < sizes.length; level++)
      packed.levelSizes[level + shift] += sizes[level]
    ;(packed.worldSources as DagRoot[]).push(root)
    batch.push(live.worlds - 1)
  }
  packed.rootCount = p.rootClusters
  // Members of the tree from now on, in new groups (`joinPlacementTree`): their order words sent
  // with the tree nodes they rewrote.
  const joined = tree ? joinPlacementTree(packed, tree, batch) : undefined
  if (joined)
    for (let k = joined.members[0]; k < joined.members[1]; k++)
      words[tree!.members + k] = tree!.order[k]
  return {
    pages: [from.pages, live.pages],
    worlds: [from.worlds, live.worlds],
    tree: { nodes: joined?.nodes ?? new Int32Array(0), members: joined?.members ?? [0, 0] },
  }
}

/** Whether `roots` fit the room `packed` kept: each a placement of a page array it packed, no
 *  deeper than its levels, within its pages, queue entries and placements. */
function fitsRoom(packed: PackedDag, roots: readonly DagRoot[], shared: PackShared) {
  const live = packed.live!
  let pages = live.pages,
    entries = live.entries
  for (const root of roots) {
    if (!shared.firstOf.has(root.pages)) return false
    const culling = cullingOf(root, shared),
      shift = packed.placementTree?.depth ?? 0
    if (levelSizesOf(culling, shared).length + shift > packed.levelSizes.length) return false
    pages += root.pages.length
    entries += culling.nodes.length / culling.stride
  }
  // Its member slots take the batch from a new group on (`joinStart`).
  const tree = packed.placementTree
  if (tree && joinStart(tree) + roots.length > tree.capacity) return false
  return (
    pages <= packed.pageCount &&
    entries <= packed.entryCount - treeNodeCount(tree) &&
    live.worlds + roots.length <= packed.worldCount
  )
}

/** Each root's world as the cut's worlds hold it — or those of `ranks` alone, the others left —:
 *  its sixteen numbers in single precision, the translation kept exactly beside them
 *  (`worldOrigins.ts`), which each cut reads at its own eye (`shader/worldPoseWgsl.ts`). */
export function rootWorlds(
  worlds: Float32Array,
  roots: readonly DagRoot[],
  ranks?: ArrayLike<number>,
) {
  const count = ranks ? ranks.length : roots.length
  for (let k = 0; k < count; k++) {
    const w = ranks ? ranks[k] : k
    worlds.set(roots[w].world.elements, w * 16)
  }
}

/**
 * The roots whose world is no longer the one `worlds` holds (`rootWorlds`), increasing, listed in
 * `into` — one entry a root at least —: the same single-precision rounding, so a pose the host
 * left alone compares bit for bit, whatever the eye. Nothing is written.
 */
export function rootWorldsMoved(worlds: Float32Array, roots: readonly DagRoot[], into: Int32Array) {
  let count = 0
  for (let w = 0; w < roots.length; w++)
    if (!sameMatrixFloat32(worlds, roots[w].world.elements, w * 16)) into[count++] = w
  return into.subarray(0, count)
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
