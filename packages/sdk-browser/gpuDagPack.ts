import { maxStretch, worldToRenderOrigin } from '../sdk-core/index.ts';
import { leafCone, PAGE_CONE_FLOATS, SELECTION_NONE as NONE } from './gpuSelection.ts';
import { DAG_NODE_FLOATS, type DagRoot, type PackedDag } from './gpuDagTypes.ts';
import { cullingBoundsFor, packCullingNodes } from './gpuDagPackNodes.ts';
import { flatHierarchy, hierarchyLevelSizes } from './gpuDagHierarchy.ts';
import {
  CLUSTER_WORDS,
  COLD_CONE,
  COLD_HAS_BOX,
  COLD_MAX,
  COLD_MIN,
  COLD_OWNER,
  HOT_FLAGS,
  HOT_LOD_ERROR,
  HOT_PARENT_ERROR,
  HOT_PARENT_SPHERE,
  HOT_SPHERE,
  HOT_WORLD,
  packClusterFlags,
  residentWords,
} from './gpuDagLayout.ts';

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
    nodeCount = 0;
  // Les étages de toutes les primitives, additionnés étage par étage : la file de la passe `L` ne
  // porte que des nœuds de l'étage `L`, ce total la majore donc, et la passe se lance à plat.
  //
  // Tous les placements d'une même primitive partagent le tableau de nœuds — la collecte en copie
  // l'enveloppe, pas la donnée —, et le parcours ne dépend que de lui : il est fait une fois par
  // tableau, retrouvé par identité pour les placements suivants.
  const levelTotals: number[] = [];
  const parTableau = new Map<Float64Array, readonly number[]>();
  // Les bornes de coupe suivent le même partage : l'hôte les dérive déjà par primitive, et un
  // montage qui n'en donne pas les reçoit ici, une fois par tableau de nœuds.
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
  // L'enregistrement chaud ne porte que ce que les cinq passes d'une image relisent toutes ; le
  // nœud propriétaire et le cône partent au froid, que la seule passe d'ouverture lit.
  const clusters = new Float32Array(Math.max(1, clusterCount) * CLUSTER_WORDS),
    clusterInts = new Uint32Array(clusters.buffer);
  const nodes = new Float32Array(Math.max(1, nodeCount) * DAG_NODE_FLOATS),
    nodeInts = new Uint32Array(nodes.buffer);
  // Les bits de résidence prolongent les enregistrements froids : un mot pour trente-deux grappes,
  // écrit par delta plutôt qu'un flottant par grappe réécrit page par page.
  const pageCones = new Float32Array(
    Math.max(1, clusterCount) * PAGE_CONE_FLOATS + residentWords(Math.max(1, clusterCount)),
  );
  const coneInts = new Uint32Array(pageCones.buffer);
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
    rootNodes[w] = nodeBase;
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
      // Le nœud propriétaire n'est lu que par l'oracle, qui rejoue la descente : il reste au froid.
      coneInts[base + COLD_OWNER] = owner[i];
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
    levelSizes,
    nodeCount,
    worldCount: roots.length,
    pageCount: clusterCount,
    rootCount: rootClusters,
    pageUrls,
  };
}

/**
 * Ramène les matrices monde empaquetées dans le REPÈRE DE RENDU dont `origin` est l'origine —
 * l'œil de l'image (`sdk-core/mathRenderOrigin.ts`). `packDagSelection` les rend en monde absolu :
 * le moteur les rebase par image avant de les porter à la carte, et c'est par ici qu'un appelant du
 * noyau sans moteur — oracle, banc, montage de test — se met dans le repère des uniformes qu'il
 * fabrique. Les matrices des racines, en double, sont la source : la soustraction précède l'arrondi.
 */
export function packedWorldsToRenderOrigin(
  packed: PackedDag,
  roots: readonly DagRoot[],
  origin: ArrayLike<number>,
) {
  rootWorldsToRenderOrigin(packed.worlds, roots, origin);
  return packed;
}

/** La boucle elle-même : chaque racine, seize flottants, rebasée à `origin` dans `worlds`. */
export function rootWorldsToRenderOrigin(
  worlds: Float32Array,
  roots: readonly DagRoot[],
  origin: ArrayLike<number>,
) {
  for (let w = 0; w < roots.length; w++)
    worldToRenderOrigin(worlds, roots[w].world.elements, origin, w * 16);
}
