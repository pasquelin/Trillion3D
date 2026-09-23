import { maxStretch, worldToRenderOrigin } from '../../../../sdk-core/src/index.ts';
import { REQUEST_PAGE_MAX } from './request.ts';
import { leafCone, PAGE_CONE_FLOATS, SELECTION_NONE as NONE } from '../core/selection.ts';
import { DAG_NODE_FLOATS, type DagRoot, type PackedDag } from './types.ts';
import { cullingBoundsFor, packCullingNodes } from './packNodes.ts';
import { flatHierarchy, hierarchyLevelSizes } from './hierarchy.ts';
import {
  CLUSTER_WORDS,
  COLD_CONE,
  COLD_HAS_BOX,
  COLD_MAX,
  COLD_MIN,
  COLD_OWNER,
  COLD_TRIANGLES,
  HOT_FLAGS,
  HOT_LOD_ERROR,
  HOT_PARENT_ERROR,
  HOT_PARENT_SPHERE,
  HOT_SPHERE,
  HOT_WORLD,
  packClusterFlags,
  residentWords,
} from './layout.ts';

function writeSphere(
  target: Float32Array,
  at: number,
  sphere: ArrayLike<number> | null | undefined,
) {
  const ok = !!sphere && sphere.length >= 4;
  target[at] = ok ? sphere![0] : 0;
  target[at + 1] = ok ? sphere![1] : 0;
  target[at + 2] = ok ? sphere![2] : 0;
  target[at + 3] = ok ? sphere![3] : 0;
}

/** Pack the cluster bands, their cone/box records and the per-primitive culling nodes. */
export function packDagSelection(roots: readonly DagRoot[]): PackedDag {
  const pageUrls: string[] = [];
  // Every primitive descends the same hierarchy: the manifest's, or the one packing
  // gives it. One path, and level descent never has a page range without a root.
  const cullings = roots.map((root) => root.culling ?? flatHierarchy(root.pages));
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
  // The hot record only holds what all five passes of a frame reread; the owner
  // node and the cone go to the cold, which the open pass alone reads.
  const clusters = new Float32Array(Math.max(1, clusterCount) * CLUSTER_WORDS),
    clusterInts = new Uint32Array(clusters.buffer);
  const nodes = new Float32Array(Math.max(1, nodeCount) * DAG_NODE_FLOATS),
    nodeInts = new Uint32Array(nodes.buffer);
  // Residency bits extend the cold records: one word for thirty-two clusters,
  // written by delta rather than a float per cluster rewritten page by page.
  const pageCones = new Float32Array(
    Math.max(1, clusterCount) * PAGE_CONE_FLOATS + residentWords(Math.max(1, clusterCount)),
  );
  const coneInts = new Uint32Array(pageCones.buffer);
  const worldSlots = Math.max(1, roots.length);
  const worlds = new Float32Array(worldSlots * 16),
    worldStretch = new Float32Array(worldSlots),
    // Each primitive's root, which prepare deposits in pass 0's queue; a parked row deposits
    // none, and `rootBases` keeps the node it takes back.
    rootNodes = new Uint32Array(worldSlots).fill(NONE),
    rootBases = new Uint32Array(worldSlots).fill(NONE);
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
    node += packCullingNodes(
      nodes,
      nodeInts,
      culling,
      cullingBoundsFor(culling, root.pages, bornesParTableau),
      { world: w, nodeBase, pageBase },
      owner,
    );
    for (let i = 0; i < root.pages.length; i++) {
      const rec = root.pages[i],
        dst = cluster * CLUSTER_WORDS;
      pageUrls.push(rec.url);
      writeSphere(clusters, dst + HOT_SPHERE, rec.sphere);
      writeSphere(clusters, dst + HOT_PARENT_SPHERE, rec.parentSphere ?? rec.sphere);
      const parent =
        typeof rec.parentError === 'number' && Number.isFinite(rec.parentError)
          ? rec.parentError
          : -1;
      clusters[dst + HOT_LOD_ERROR] = rec.lodError ?? 0;
      clusters[dst + HOT_PARENT_ERROR] = parent;
      clusterInts[dst + HOT_WORLD] = w;
      // A cluster that no culling leaf owns is unreachable for the CPU cut too; never select it.
      clusterInts[dst + HOT_FLAGS] = packClusterFlags(
        parent < 0,
        owner[i] === NONE,
        rec.level ?? 0,
        !!rec.transparent,
      );
      if (parent < 0) rootClusters++;
      const cone = leafCone(rec),
        base = cluster * PAGE_CONE_FLOATS,
        hasBox = rec.min && rec.max ? 1 : 0;
      pageCones[base + COLD_CONE] = cone.axis[0];
      pageCones[base + COLD_CONE + 1] = cone.axis[1];
      pageCones[base + COLD_CONE + 2] = cone.axis[2];
      pageCones[base + COLD_CONE + 3] = cone.angle;
      pageCones[base + COLD_HAS_BOX] = hasBox;
      for (let a = 0; a < 3; a++) {
        pageCones[base + COLD_MIN + a] = hasBox ? rec.min![a] : 0;
        pageCones[base + COLD_MAX + a] = hasBox ? rec.max![a] : 0;
      }
      // The owner node is only read by the oracle, which replays descent: it stays cold.
      coneInts[base + COLD_OWNER] = owner[i];
      // Cluster triangles, as an integer word: the GPU now holds the totals.
      coneInts[base + COLD_TRIANGLES] = Math.max(0, Math.trunc(rec.triangles ?? 0));
      cluster++;
    }
  }
  return {
    kind: 'dag',
    clusters,
    nodes,
    pageCones,
    worlds,
    worldStretch,
    rootNodes,
    rootBases,
    levelSizes,
    nodeCount,
    worldCount: roots.length,
    pageCount: clusterCount,
    rootCount: rootClusters,
    pageUrls,
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
