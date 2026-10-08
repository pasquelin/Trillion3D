import { maxStretch, worldToRenderOrigin } from '../../../../sdk-core/src/index.ts'
import { sameMatrixFloat32 } from '../../../../math/src/matrix/matrixElements.ts'
import { SELECTION_NONE as NONE } from '../core/selection.ts'
import {
  DAG_NODE_FLOATS,
  type DagCutLinks,
  type DagPackShared,
  type DagRoot,
  type PackedDag,
} from './types.ts'
import { linksFor } from '../../page/cut/links.ts'
import { cullingBoundsFor, packCullingNodes } from './packNodes.ts'
import { flatHierarchy, hierarchyLevelSizes } from './hierarchy.ts'
import { CLUSTER_WORDS, COLD_WORDS, coldBase, keyBase } from './layout.ts'
import { KEY_PAGE_MAX, canonicalPage, writeKeyColumn } from './evict.ts'
import { createRecordTable } from './packRecords.ts'

/** One root's world brought back to the origin, in double precision, before it is compared. */
const rebased = new Float64Array(16)

type Culling = NonNullable<DagRoot['culling']>

/** Room a packing keeps past its live pages, nodes and placements, for roots a growth appends
 *  (`appendDagRoots`): inert — no root names them — until one does. */
export type DagCapacity = { pages: number; nodes: number; worlds: number }

type PackShared = DagPackShared
const emptyShared = (): PackShared => ({
  flats: new Map(),
  levelSizesOf: new Map(),
  boundsOf: new Map(),
  firstOf: new Map(),
})

/** The tables a packing writes a root into, and its live counts (`placeRoot`). */
type Packing = Pick<
  PackedDag,
  'nodes' | 'worlds' | 'worldStretch' | 'rootNodes' | 'rootBases' | 'mark' | 'recordShift'
> & {
  nodeInts: Uint32Array
  pageWorlds: Uint32Array
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
 * Root `root` packed as placement `w`, behind the live pages and nodes: its world, stretch, root
 * node and mark, its culling nodes, its links, its pages' placement words, and the shift that leads
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
    nodeBase = p.live.nodes,
    count = root.pages.length
  p.worlds.set(root.world.elements, w * 16)
  p.worldStretch[w] = maxStretch(root.world.elements)
  p.rootBases[w] = nodeBase
  p.rootNodes[w] = root.parked ? NONE : nodeBase
  p.mark[w] = root.mark ?? 0
  const owner = new Uint32Array(count).fill(NONE)
  const bounds = cullingBoundsFor(culling, root.pages, p.shared.boundsOf)
  const place = { world: w, nodeBase, pageBase }
  const nodeCount = packCullingNodes(p.nodes, p.nodeInts, culling, bounds, place, owner)
  const links = linksFor(culling, count)
  const { structure } = root
  p.cutLinks.push({ structure, links, pageBase, pageCount: count, nodeBase, nodeCount })
  const base = recordBase(culling, owner, nodeBase)
  if (!p.shared.firstOf.has(root.pages))
    p.shared.firstOf.set(root.pages, { pageBase, recordBase: base })
  p.recordShift[w] = (base - pageBase) >>> 0
  p.pageWorlds.fill(w, pageBase, pageBase + count)
  for (const rec of root.pages)
    if (!(typeof rec.parentError === 'number' && Number.isFinite(rec.parentError))) p.rootClusters++
  p.live.pages += count
  p.live.nodes += nodeCount
  p.live.worlds = w + 1
}

/** The live counts of `roots`, their levels summed level by level — pass `L`'s queue only holds
 *  nodes of level `L`, so this total upper-bounds it, and the pass launches flat. */
function countRoots(roots: readonly DagRoot[], shared: PackShared) {
  let pages = 0,
    nodes = 0
  const levels: number[] = []
  for (const root of roots) {
    const culling = cullingOf(root, shared),
      sizes = levelSizesOf(culling, shared)
    pages += root.pages.length
    nodes += culling.nodes.length / culling.stride
    for (let level = 0; level < sizes.length; level++)
      levels[level] = (levels[level] ?? 0) + sizes[level]
  }
  return { pages, nodes, levels }
}

/** The pages, nodes and placements `roots` fill: what a growth's capacity starts from. */
export function dagRootCounts(roots: readonly DagRoot[]): DagCapacity {
  const { pages, nodes } = countRoots(roots, emptyShared())
  return { pages, nodes, worlds: roots.length }
}

/** A packing's tables at `capacity`: every placement past the live ones parked, every page past
 *  them in no placement (`NONE`). */
function allocatePacking(capacity: DagCapacity, shared: PackShared): Packing {
  const nodes = new Float32Array(Math.max(1, capacity.nodes) * DAG_NODE_FLOATS),
    worldSlots = Math.max(1, capacity.worlds)
  return {
    nodes,
    nodeInts: new Uint32Array(nodes.buffer),
    pageWorlds: new Uint32Array(capacity.pages).fill(NONE),
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
    live: { pages: 0, nodes: 0, worlds: 0 },
    shared,
    rootClusters: 0,
  }
}

/**
 * Pack the cluster bands, their cone/box records and the per-primitive culling nodes, at
 * `capacity` — exactly the roots' when none is given.
 *
 * Records are stored once per unique cluster (`packRecords.ts`): the placements of one
 * primitive share them, and the working table names each page's placement, whose record
 * shift leads the page to its record (`layout.ts`). Nodes stay per placement. A packing with room
 * past its roots (a growth's, `grownCapacity`) takes later placements of its primitives in place
 * (`appendDagRoots`); one that packs the world DAG (#1333) keeps none.
 */
export function packDagSelection(roots: readonly DagRoot[], capacity?: DagCapacity): PackedDag {
  const shared = emptyShared()
  const counted = countRoots(roots, shared),
    world = roots.findIndex((root) => root.origins),
    room = world < 0 ? capacity : undefined
  const size: DagCapacity = {
    pages: Math.max(counted.pages, room?.pages ?? 0),
    nodes: Math.max(counted.nodes, room?.nodes ?? 0),
    worlds: Math.max(roots.length, room?.worlds ?? 0),
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
  // The hot record only holds what all five passes of a frame reread; the owner node and the cone
  // go to the cold, which the open pass alone reads. Residency bits follow the working table: one
  // word for thirty-two pages, written by delta.
  const recordSlots = Math.max(1, records.count),
    coldAt = coldBase(size.pages)
  const clusters = new Float32Array(recordSlots * CLUSTER_WORDS),
    pageCones = new Float32Array(coldAt + recordSlots * COLD_WORDS)
  new Uint32Array(pageCones.buffer).set(p.pageWorlds)
  writeKeyColumn(roots, new Uint32Array(pageCones.buffer), keyBase(size.pages))
  records.finish(clusters, pageCones, coldAt)
  const worldSources = [...roots]
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
    levelSizes: Uint32Array.from(counted.levels),
    nodeCount: size.nodes,
    worldCount: size.worlds,
    pageCount: size.pages,
    recordCount: records.count,
    recordShift: p.recordShift,
    rootCount: p.rootClusters,
    pageUrlOf: pageUrlReader(worldSources, p.cutLinks, pageCones, p.live),
    cutLinks: p.cutLinks,
    live: p.live,
    ...(room && { shared }),
    ...(world >= 0 && { world: { root: world, origins: roots[world].origins! } }),
  }
}

/** The live ranges `appendDagRoots` filled: pages, nodes and placements `[from, to)`. */
export type DagAppended = {
  pages: readonly [number, number]
  nodes: readonly [number, number]
  worlds: readonly [number, number]
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
    keyAt = keyBase(packed.pageCount)
  const p: Packing = {
    ...packed,
    nodeInts: new Uint32Array(packed.nodes.buffer, packed.nodes.byteOffset, packed.nodes.length),
    pageWorlds: words.subarray(0, packed.pageCount),
    live,
    shared,
    rootClusters: packed.rootCount,
  }
  for (const root of roots) {
    const first = shared.firstOf.get(root.pages)!,
      pageBase = live.pages
    placeRoot(p, root, live.worlds, () => first.recordBase)
    // Each page's content key is its template page's canonical one (`writeKeyColumn`).
    for (let k = 0; k < root.pages.length; k++)
      words[keyAt + pageBase + k] = canonicalPage(words[keyAt + first.pageBase + k])
    const sizes = levelSizesOf(cullingOf(root, shared), shared)
    for (let level = 0; level < sizes.length; level++) packed.levelSizes[level] += sizes[level]
    ;(packed.worldSources as DagRoot[]).push(root)
  }
  packed.rootCount = p.rootClusters
  return {
    pages: [from.pages, live.pages],
    nodes: [from.nodes, live.nodes],
    worlds: [from.worlds, live.worlds],
  }
}

/** Whether `roots` fit the room `packed` kept: each a placement of a page array it packed, no
 *  deeper than its levels, within its pages, nodes and placements. */
function fitsRoom(packed: PackedDag, roots: readonly DagRoot[], shared: PackShared) {
  const live = packed.live!
  let pages = live.pages,
    nodes = live.nodes
  for (const root of roots) {
    if (!shared.firstOf.has(root.pages)) return false
    const culling = cullingOf(root, shared)
    if (levelSizesOf(culling, shared).length > packed.levelSizes.length) return false
    pages += root.pages.length
    nodes += culling.nodes.length / culling.stride
  }
  return (
    pages <= packed.pageCount &&
    nodes <= packed.nodeCount &&
    live.worlds + roots.length <= packed.worldCount
  )
}

/** The loop itself: each root, sixteen floats, rebased to `origin` in `worlds`, and its translation
 *  kept in `translations` as it was read, three doubles per root: what
 *  `rootTranslationsToRenderOrigin` subtracts the next eye from, by the same subtraction as
 *  `matrixAtRenderOrigin` of `packages/math/src/projection/renderOrigin.ts`. */
export function rootWorldsToRenderOrigin(
  worlds: Float32Array,
  roots: readonly DagRoot[],
  origin: ArrayLike<number>,
  translations: Float64Array,
) {
  for (let w = 0; w < roots.length; w++) {
    const world = roots[w].world.elements
    worldToRenderOrigin(worlds, world, origin, w * 16)
    translations[w * 3] = world[12]
    translations[w * 3 + 1] = world[13]
    translations[w * 3 + 2] = world[14]
  }
}

/**
 * Whether a root's world is no longer the one `worlds` holds rebased to `origin`: the same
 * subtraction and the same single-precision rounding as `rootWorldsToRenderOrigin`, so a pose the
 * host left alone compares bit for bit, whatever eye the next rebase takes. Nothing is written.
 */
export function rootWorldsMoved(
  worlds: Float32Array,
  roots: readonly DagRoot[],
  origin: ArrayLike<number>,
) {
  for (let w = 0; w < roots.length; w++) {
    worldToRenderOrigin(rebased, roots[w].world.elements, origin)
    if (!sameMatrixFloat32(worlds, rebased, w * 16)) return true
  }
  return false
}

/**
 * The same loop when only the origin moved since the last `rootWorldsToRenderOrigin` into
 * `worlds`, the roots unchanged: the three translation numbers of each root, the only ones that
 * depend on the origin, rewritten by the same double subtraction on the doubles that rebase kept
 * in `translations` — the buffer ends bit for bit as a full rebase would leave it. They are read
 * from one flat array, not from each root's matrix: a hundred thousand roots are as many objects
 * apart in memory, for three numbers each.
 */
export function rootTranslationsToRenderOrigin(
  worlds: Float32Array,
  translations: Float64Array,
  origin: ArrayLike<number>,
) {
  const x = origin[0],
    y = origin[1],
    z = origin[2]
  for (let t = 0, at = 12; t < translations.length; t += 3, at += 16) {
    worlds[at] = translations[t] - x
    worlds[at + 1] = translations[t + 1] - y
    worlds[at + 2] = translations[t + 2] - z
  }
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
  pageCones: Float32Array,
  live: { readonly pages: number },
) {
  const worldOfPage = new Uint32Array(pageCones.buffer, pageCones.byteOffset)
  return (page: number) => {
    if (!(page >= 0 && page < live.pages)) return undefined
    const w = worldOfPage[page]
    return roots[w]?.pages[page - cutLinks[w].pageBase]?.url
  }
}
