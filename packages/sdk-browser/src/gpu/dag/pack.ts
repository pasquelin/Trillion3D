import { maxStretch, worldToRenderOrigin } from '../../../../sdk-core/src/index.ts';
import { REQUEST_PAGE_MAX } from './request.ts';
import { SELECTION_NONE as NONE } from '../core/selection.ts';
import { DAG_NODE_FLOATS, type DagCutLinks, type DagRoot, type PackedDag } from './types.ts';
import { cullingLinks } from '../../page/cut/readiness.ts';
import { cullingBoundsFor, packCullingNodes } from './packNodes.ts';
import { flatHierarchy, hierarchyLevelSizes } from './hierarchy.ts';
import { CLUSTER_WORDS, COLD_WORDS, coldBase } from './layout.ts';
import { createRecordTable } from './packRecords.ts';

/**
 * Pack the cluster bands, their cone/box records and the per-primitive culling nodes.
 *
 * Records are stored once per unique cluster (`packRecords.ts`): the placements of one
 * primitive share them, and the working table names each page's placement, whose record
 * shift leads the page to its record (`layout.ts`). Nodes stay per placement.
 */
export function packDagSelection(roots: readonly DagRoot[]): PackedDag {
  const pageUrls: string[] = [];
  // Every primitive descends the same hierarchy: the manifest's, or the one packing
  // gives it — once per page array, so placements sharing their pages share it too.
  // One path, and level descent never has a page range without a root.
  const flats = new Map<DagRoot['pages'], NonNullable<DagRoot['culling']>>();
  const cullings = roots.map((root) => {
    if (root.culling) return root.culling;
    let flat = flats.get(root.pages);
    if (!flat) flats.set(root.pages, (flat = flatHierarchy(root.pages)));
    return flat;
  });
  let clusterCount = 0,
    nodeCount = 0;
  // Levels of every primitive, summed level by level: pass `L`'s queue only holds
  // nodes of level `L`, so this total upper-bounds it, and the pass launches flat.
  //
  // All placements of the same primitive share the node array — collection copies
  // the envelope, not the data — and the walk depends only on it: done once per
  // array, recovered by identity for later placements.
  const levelTotals: number[] = [];
  const parTableau = new Map<Float64Array, readonly number[]>();
  // Cut bounds follow the same sharing: the host already derives them per primitive,
  // and a mount that does not supply them receives them here, once per node array.
  const bornesParTableau = new Map<Float64Array, Float64Array>();
  for (let w = 0; w < roots.length; w++) {
    clusterCount += roots[w].pages.length;
    nodeCount += cullings[w].nodes.length / cullings[w].stride;
    let sizes = parTableau.get(cullings[w].nodes);
    if (!sizes) {
      sizes = hierarchyLevelSizes(cullings[w].nodes, cullings[w].stride);
      parTableau.set(cullings[w].nodes, sizes);
    }
    for (let level = 0; level < sizes.length; level++)
      levelTotals[level] = (levelTotals[level] ?? 0) + sizes[level];
  }
  const levelSizes = Uint32Array.from(levelTotals);
  // The request word names the page on twenty-two bits (`request.ts`). Beyond that,
  // the readout would return a page for another: better to refuse it by name.
  if (clusterCount > REQUEST_PAGE_MAX)
    throw new Error(`GPU_SELECTION_PAGE_RANGE: ${clusterCount} > ${REQUEST_PAGE_MAX}`);
  const nodes = new Float32Array(Math.max(1, nodeCount) * DAG_NODE_FLOATS),
    nodeInts = new Uint32Array(nodes.buffer);
  // The working table's word per page: its placement, the only field a placement owns.
  const pageWorlds = new Uint32Array(clusterCount);
  const worldSlots = Math.max(1, roots.length);
  const worlds = new Float32Array(worldSlots * 16),
    worldStretch = new Float32Array(worldSlots),
    recordShift = new Uint32Array(worldSlots),
    // Each primitive's root, which prepare deposits in pass 0's queue; a parked row deposits
    // none, and `rootBases` keeps the node it takes back.
    rootNodes = new Uint32Array(worldSlots).fill(NONE),
    rootBases = new Uint32Array(worldSlots).fill(NONE),
    unculled = new Uint8Array(worldSlots);
  const records = createRecordTable();
  // Culling links, shared by the placements of one node array as the hierarchy is.
  const linksOf = new Map<Float64Array, DagCutLinks['links']>();
  const cutLinks: DagCutLinks[] = [];
  let cluster = 0,
    node = 0,
    rootClusters = 0;
  for (let w = 0; w < roots.length; w++) {
    const root = roots[w],
      pageBase = cluster,
      nodeBase = node,
      culling = cullings[w];
    worlds.set(root.world.elements, w * 16);
    worldStretch[w] = maxStretch(root.world.elements);
    const owner = new Uint32Array(root.pages.length).fill(NONE);
    rootBases[w] = nodeBase;
    rootNodes[w] = root.parked ? NONE : nodeBase;
    unculled[w] = root.unculled ? 1 : 0;
    const packedNodes = packCullingNodes(
      nodes,
      nodeInts,
      culling,
      cullingBoundsFor(culling, root.pages, bornesParTableau),
      { world: w, nodeBase, pageBase },
      owner,
    );
    node += packedNodes;
    let links = culling.links ?? linksOf.get(culling.nodes);
    if (!links) linksOf.set(culling.nodes, (links = cullingLinks(culling, root.pages.length)));
    cutLinks.push({
      structure: root.structure,
      links,
      pageBase,
      pageCount: root.pages.length,
      nodeBase,
      nodeCount: packedNodes,
    });
    recordShift[w] = (records.place(root.pages, culling.nodes, owner, nodeBase) - pageBase) >>> 0;
    pageWorlds.fill(w, pageBase, pageBase + root.pages.length);
    for (const rec of root.pages) {
      pageUrls.push(rec.url);
      if (!(typeof rec.parentError === 'number' && Number.isFinite(rec.parentError)))
        rootClusters++;
    }
    cluster += root.pages.length;
  }
  // The hot record only holds what all five passes of a frame reread; the owner
  // node and the cone go to the cold, which the open pass alone reads. Residency bits
  // follow the working table: one word for thirty-two pages, written by delta.
  const recordSlots = Math.max(1, records.count),
    coldAt = coldBase(clusterCount);
  const clusters = new Float32Array(recordSlots * CLUSTER_WORDS),
    pageCones = new Float32Array(coldAt + recordSlots * COLD_WORDS);
  new Uint32Array(pageCones.buffer).set(pageWorlds);
  records.finish(clusters, pageCones, coldAt);
  return {
    kind: 'dag',
    clusters,
    nodes,
    pageCones,
    worlds,
    worldStretch,
    rootNodes,
    rootBases,
    unculled,
    levelSizes,
    nodeCount,
    worldCount: roots.length,
    pageCount: clusterCount,
    recordCount: records.count,
    recordShift,
    rootCount: rootClusters,
    pageUrls,
    cutLinks,
  };
}

/**
 * Brings packed world matrices into the RENDER FRAME whose origin is `origin` —
 * the frame's eye (`sdk-core/mathRenderOrigin.ts`). `packDagSelection` returns them
 * in absolute world: the engine rebases them per frame before sending them to the
 * GPU, and this is how a kernel caller without the engine — oracle, bench, test
 * mount — enters the frame of the uniforms it builds. Root matrices, in double,
 * are the source: subtraction precedes rounding.
 */
export function packedWorldsToRenderOrigin(
  packed: PackedDag,
  roots: readonly DagRoot[],
  origin: ArrayLike<number>,
) {
  rootWorldsToRenderOrigin(packed.worlds, roots, origin);
  return packed;
}

/** The loop itself: each root, sixteen floats, rebased to `origin` in `worlds`. */
export function rootWorldsToRenderOrigin(
  worlds: Float32Array,
  roots: readonly DagRoot[],
  origin: ArrayLike<number>,
) {
  for (let w = 0; w < roots.length; w++)
    worldToRenderOrigin(worlds, roots[w].world.elements, origin, w * 16);
}
