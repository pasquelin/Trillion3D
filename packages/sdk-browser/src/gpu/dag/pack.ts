import { maxStretch, worldToRenderOrigin } from '../../../../sdk-core/src/index.ts'
import { REQUEST_PAGE_MAX } from './request.ts'
import { SELECTION_NONE as NONE } from '../core/selection.ts'
import { DAG_NODE_FLOATS, type DagCutLinks, type DagRoot, type PackedDag } from './types.ts'
import { linksFor } from '../../page/cut/links.ts'
import { cullingBoundsFor, packCullingNodes } from './packNodes.ts'
import { flatHierarchy, hierarchyLevelSizes } from './hierarchy.ts'
import { CLUSTER_WORDS, COLD_WORDS, coldBase, keyBase } from './layout.ts'
import { writeKeyColumn } from './evict.ts'
import { createRecordTable } from './packRecords.ts'

/**
 * Pack the cluster bands, their cone/box records and the per-primitive culling nodes.
 *
 * Records are stored once per unique cluster (`packRecords.ts`): the placements of one
 * primitive share them, and the working table names each page's placement, whose record
 * shift leads the page to its record (`layout.ts`). Nodes stay per placement.
 */
export function packDagSelection(roots: readonly DagRoot[]): PackedDag {
  // Every primitive descends the same hierarchy: the manifest's, or the one packing
  // gives it — once per page array, so placements sharing their pages share it too.
  // One path, and level descent never has a page range without a root.
  const flats = new Map<DagRoot['pages'], NonNullable<DagRoot['culling']>>()
  const cullings = roots.map((root) => {
    if (root.culling) return root.culling
    let flat = flats.get(root.pages)
    if (!flat) flats.set(root.pages, (flat = flatHierarchy(root.pages)))
    return flat
  })
  let clusterCount = 0,
    nodeCount = 0
  // Levels of every primitive, summed level by level: pass `L`'s queue only holds
  // nodes of level `L`, so this total upper-bounds it, and the pass launches flat.
  //
  // All placements of the same primitive share the node array — collection copies
  // the envelope, not the data — and the walk depends only on it: done once per
  // array, recovered by identity for later placements.
  const levelTotals: number[] = []
  const parTableau = new Map<Float64Array, readonly number[]>()
  // Cut bounds follow the same sharing: the host already derives them per primitive,
  // and a mount that does not supply them receives them here, once per node array.
  const bornesParTableau = new Map<Float64Array, Float64Array>()
  for (let w = 0; w < roots.length; w++) {
    clusterCount += roots[w].pages.length
    nodeCount += cullings[w].nodes.length / cullings[w].stride
    let sizes = parTableau.get(cullings[w].nodes)
    if (!sizes) {
      sizes = hierarchyLevelSizes(cullings[w].nodes, cullings[w].stride)
      parTableau.set(cullings[w].nodes, sizes)
    }
    for (let level = 0; level < sizes.length; level++)
      levelTotals[level] = (levelTotals[level] ?? 0) + sizes[level]
  }
  const levelSizes = Uint32Array.from(levelTotals)
  // The request word names the page on twenty-two bits (`request.ts`). Beyond that,
  // the readout would return a page for another: better to refuse it by name.
  if (clusterCount > REQUEST_PAGE_MAX)
    throw new Error(`GPU_SELECTION_PAGE_RANGE: ${clusterCount} > ${REQUEST_PAGE_MAX}`)
  const nodes = new Float32Array(Math.max(1, nodeCount) * DAG_NODE_FLOATS),
    nodeInts = new Uint32Array(nodes.buffer)
  // The working table's word per page: its placement, the only field a placement owns.
  const pageWorlds = new Uint32Array(clusterCount)
  const worldSlots = Math.max(1, roots.length)
  const worlds = new Float32Array(worldSlots * 16),
    worldStretch = new Float32Array(worldSlots),
    recordShift = new Uint32Array(worldSlots),
    // Each primitive's root, which prepare deposits in pass 0's queue; a parked row deposits
    // none, and `rootBases` keeps the node it takes back.
    rootNodes = new Uint32Array(worldSlots).fill(NONE),
    rootBases = new Uint32Array(worldSlots).fill(NONE),
    // The whole frame word: the mark's bits, and the deformation reach above them (`markReach`).
    mark = new Uint32Array(worldSlots)
  const records = createRecordTable()
  // Culling links, shared by the placements of one node array as the hierarchy is.
  const cutLinks: DagCutLinks[] = []
  let cluster = 0,
    node = 0,
    rootClusters = 0
  for (let w = 0; w < roots.length; w++) {
    const root = roots[w],
      pageBase = cluster,
      nodeBase = node,
      culling = cullings[w]
    worlds.set(root.world.elements, w * 16)
    worldStretch[w] = maxStretch(root.world.elements)
    const owner = new Uint32Array(root.pages.length).fill(NONE)
    rootBases[w] = nodeBase
    rootNodes[w] = root.parked ? NONE : nodeBase
    mark[w] = root.mark ?? 0
    const packedNodes = packCullingNodes(
      nodes,
      nodeInts,
      culling,
      cullingBoundsFor(culling, root.pages, bornesParTableau),
      { world: w, nodeBase, pageBase },
      owner,
    )
    node += packedNodes
    const links = linksFor(culling, root.pages.length)
    cutLinks.push({
      structure: root.structure,
      links,
      pageBase,
      pageCount: root.pages.length,
      nodeBase,
      nodeCount: packedNodes,
    })
    recordShift[w] = (records.place(root.pages, culling.nodes, owner, nodeBase) - pageBase) >>> 0
    pageWorlds.fill(w, pageBase, pageBase + root.pages.length)
    for (const rec of root.pages) {
      if (!(typeof rec.parentError === 'number' && Number.isFinite(rec.parentError))) rootClusters++
    }
    cluster += root.pages.length
  }
  // The hot record only holds what all five passes of a frame reread; the owner
  // node and the cone go to the cold, which the open pass alone reads. Residency bits
  // follow the working table: one word for thirty-two pages, written by delta.
  const recordSlots = Math.max(1, records.count),
    coldAt = coldBase(clusterCount)
  const clusters = new Float32Array(recordSlots * CLUSTER_WORDS),
    pageCones = new Float32Array(coldAt + recordSlots * COLD_WORDS)
  new Uint32Array(pageCones.buffer).set(pageWorlds)
  writeKeyColumn(roots, new Uint32Array(pageCones.buffer), keyBase(clusterCount))
  records.finish(clusters, pageCones, coldAt)
  const world = roots.findIndex((root) => root.origins)
  return {
    kind: 'dag',
    clusters,
    nodes,
    pageCones,
    worlds,
    worldSources: roots,
    worldStretch,
    rootNodes,
    rootBases,
    mark,
    levelSizes,
    nodeCount,
    worldCount: roots.length,
    pageCount: clusterCount,
    recordCount: records.count,
    recordShift,
    rootCount: rootClusters,
    pageUrlOf: pageUrlReader(roots, cutLinks, pageCones, clusterCount),
    cutLinks,
    ...(world >= 0 && { world: { root: world, origins: roots[world].origins! } }),
  }
}

/** The loop itself: each root, sixteen floats, rebased to `origin` in `worlds`, and its translation
 *  kept in `translations` as it was read, three doubles per root: what
 *  `rootTranslationsToRenderOrigin` subtracts the next eye from. */
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
    const world = roots[w].world.elements,
      at = w * 16
    for (let i = 0; i < 16; i++) {
      const value = i >= 12 && i < 15 ? world[i] - origin[i - 12] : world[i]
      if (worlds[at + i] !== Math.fround(value)) return true
    }
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
  pageCount: number,
) {
  const worldOfPage = new Uint32Array(pageCones.buffer, pageCones.byteOffset, pageCount)
  return (page: number) => {
    if (!(page >= 0 && page < pageCount)) return undefined
    const w = worldOfPage[page]
    return roots[w]?.pages[page - cutLinks[w].pageBase]?.url
  }
}
