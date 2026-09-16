import { maxStretch } from '../sdk-core/index.ts';
import { leafCone, PAGE_CONE_FLOATS, SELECTION_NONE as NONE } from './gpuSelection.ts';
import {
  CLUSTER_FLOATS,
  DAG_NODE_FLOATS,
  CULL_STRIDE,
  CLUSTER_ROOT,
  CLUSTER_NEVER,
  type DagRoot,
  type PackedDag,
} from './gpuDagTypes.ts';
import { flatHierarchy, hierarchyDepth } from './gpuDagHierarchy.ts';
import { residentWords } from './gpuDagLayout.ts';

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
  // Toute primitive descend la même hiérarchie : celle du manifeste, ou celle que le rangement lui
  // donne. Un seul chemin, et la descente par niveaux n'a jamais de plage de pages sans racine.
  const cullings = roots.map((root) => root.culling ?? flatHierarchy(root.pages));
  let clusterCount = 0,
    nodeCount = 0,
    levelCount = 0;
  for (let w = 0; w < roots.length; w++) {
    clusterCount += roots[w].pages.length;
    nodeCount += cullings[w].nodes.length / cullings[w].stride;
    levelCount = Math.max(levelCount, hierarchyDepth(cullings[w].nodes, cullings[w].stride));
  }
  const clusters = new Float32Array(Math.max(1, clusterCount) * CLUSTER_FLOATS),
    clusterInts = new Uint32Array(clusters.buffer);
  const nodes = new Float32Array(Math.max(1, nodeCount) * DAG_NODE_FLOATS),
    nodeInts = new Uint32Array(nodes.buffer);
  // Les bits de résidence prolongent les enregistrements froids : un mot pour trente-deux grappes,
  // écrit par delta plutôt qu'un flottant par grappe réécrit page par page.
  const pageCones = new Float32Array(
    Math.max(1, clusterCount) * PAGE_CONE_FLOATS + residentWords(Math.max(1, clusterCount)),
  );
  const worldSlots = Math.max(1, roots.length);
  const worlds = new Float32Array(worldSlots * 16),
    worldStretch = new Float32Array(worldSlots),
    // La racine de chaque primitive, que la préparation dépose dans la file de la passe 0.
    rootNodes = new Uint32Array(worldSlots).fill(NONE);
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
    if (culling.stride < CULL_STRIDE) throw new Error('GPU_DAG_CULLING_STRIDE');
    const count = culling.nodes.length / culling.stride;
    rootNodes[w] = nodeBase;
    for (let n = 0; n < count; n++) {
      const src = n * culling.stride,
        dst = (nodeBase + n) * DAG_NODE_FLOATS;
      nodes[dst] = culling.nodes[src];
      nodes[dst + 1] = culling.nodes[src + 1];
      nodes[dst + 2] = culling.nodes[src + 2];
      nodeInts[dst + 3] = nodeBase + culling.nodes[src + 11];
      nodes[dst + 4] = culling.nodes[src + 3];
      nodes[dst + 5] = culling.nodes[src + 4];
      nodes[dst + 6] = culling.nodes[src + 5];
      nodes[dst + 7] = culling.nodes[src + 10];
      nodes[dst + 8] = culling.nodes[src + 6];
      nodes[dst + 9] = culling.nodes[src + 7];
      nodes[dst + 10] = culling.nodes[src + 8];
      nodes[dst + 11] = culling.nodes[src + 9];
      nodeInts[dst + 12] = w;
      nodeInts[dst + 13] = pageBase + culling.nodes[src + 13];
      nodeInts[dst + 14] = culling.nodes[src + 14];
      nodeInts[dst + 15] = culling.nodes[src + 12];
      if (!culling.nodes[src + 12]) {
        const first = culling.nodes[src + 13],
          pages = culling.nodes[src + 14];
        for (let i = 0; i < pages && first + i < owner.length; i++) owner[first + i] = nodeBase + n;
      }
    }
    node += count;
    for (let i = 0; i < root.pages.length; i++) {
      const rec = root.pages[i],
        dst = cluster * CLUSTER_FLOATS;
      pageUrls.push(rec.url);
      writeSphere(clusters, dst, rec.sphere);
      writeSphere(clusters, dst + 4, rec.parentSphere ?? rec.sphere);
      const parent =
        typeof rec.parentError === 'number' && Number.isFinite(rec.parentError)
          ? rec.parentError
          : -1;
      clusters[dst + 8] = rec.lodError ?? 0;
      clusters[dst + 9] = parent;
      clusterInts[dst + 10] = w;
      clusterInts[dst + 11] = rec.level ?? 0;
      clusterInts[dst + 12] = owner[i];
      // A cluster that no culling leaf owns is unreachable for the CPU cut too; never select it.
      clusterInts[dst + 13] =
        (parent < 0 ? CLUSTER_ROOT : 0) | (owner[i] === NONE ? CLUSTER_NEVER : 0);
      clusterInts[dst + 14] = 0;
      clusterInts[dst + 15] = 0;
      if (parent < 0) rootClusters++;
      const cone = leafCone(rec),
        base = cluster * PAGE_CONE_FLOATS,
        hasBox = rec.min && rec.max ? 1 : 0;
      pageCones[base] = cone.axis[0];
      pageCones[base + 1] = cone.axis[1];
      pageCones[base + 2] = cone.axis[2];
      pageCones[base + 3] = cone.angle;
      pageCones[base + 4] = hasBox ? rec.min![0] : 0;
      pageCones[base + 5] = hasBox ? rec.min![1] : 0;
      pageCones[base + 6] = hasBox ? rec.min![2] : 0;
      pageCones[base + 7] = hasBox;
      pageCones[base + 8] = hasBox ? rec.max![0] : 0;
      pageCones[base + 9] = hasBox ? rec.max![1] : 0;
      pageCones[base + 10] = hasBox ? rec.max![2] : 0;
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
    levelCount,
    nodeCount,
    worldCount: roots.length,
    pageCount: clusterCount,
    rootCount: rootClusters,
    pageUrls,
  };
}
