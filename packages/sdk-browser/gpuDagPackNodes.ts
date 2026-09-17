import {
  BOUND_STRIDE,
  cullingBounds,
  HAS_ROOT,
  OWN_FLOOR,
  OWN_SPHERE,
} from './pageSelectionCutBounds.ts';
import { CULL_STRIDE, DAG_NODE_FLOATS, type DagRoot } from './gpuDagTypes.ts';

/**
 * Le nœud de coupe tel que la carte le lit, et le PLANCHER d'erreur du sous-arbre qu'il porte
 * désormais.
 *
 * Le manifeste ne donne au nœud que le PLAFOND d'erreur du remplaçant : la descente ne sait donc
 * écarter qu'un sous-arbre trop fin, et descend jusqu'aux pages un sous-arbre trop grossier dont la
 * coupe ne prendra rien. Le plancher — la plus petite erreur propre du sous-arbre, avec la sphère
 * qui englobe celles qu'il résume — est l'autre moitié, celle que la coupe processeur pose déjà
 * (`pageSelectionCutNode.ts`). `cullingBounds` le dérive des pages à la préparation : rien du
 * compilateur, rien du format de page.
 *
 * Quatre mots de plus par nœud, soit seize flottants devenus vingt-quatre : la sphère du plancher,
 * le plancher lui-même et un mot de drapeaux dont le seul bit dit si le sous-arbre porte une grappe
 * que rien ne remplace. Le repli épinglé de `dagMask` dessine ces grappes-là sans consulter aucun
 * seuil : la descente ne doit donc jamais les élaguer, quelle que soit leur erreur.
 */
/** Les rangs du nœud empaqueté, dans l'ordre où `struct CullNode` du nuanceur les déclare. Trois
 *  lecteurs les relisent — le nuanceur, l'oracle (`gpuDagOracleMath.ts`) et le comptage de frontière
 *  —, et ils ne sont écrits qu'ici : un champ déplacé ne peut donc pas laisser un lecteur derrière. */
export const NODE_MIN = 0,
  NODE_FIRST_CHILD = 3,
  NODE_MAX = 4,
  /** Plafond d'erreur du remplaçant du sous-arbre, -1 quand le manifeste n'en porte pas. */
  NODE_CEIL = 7,
  NODE_SPHERE = 8,
  NODE_WORLD = 12,
  NODE_FIRST_PAGE = 13,
  NODE_PAGE_COUNT = 14,
  NODE_CHILD_COUNT = 15,
  NODE_FLOOR_SPHERE = 16,
  NODE_FLOOR = 20,
  NODE_FLAGS = 21;
/** Les deux mots de calage qui portent le nœud à quatre-vingt-seize octets, alignés sur le vec4. */
const NODE_PAD = 22;
/** Bit 0 des drapeaux de nœud : le sous-arbre porte une grappe que rien ne remplace. */
export const NODE_HAS_ROOT = 1;
/** Le plus grand f32 : le nuanceur ne peut pas écrire une constante infinie, et son plancher lit
 *  cette valeur là où la borne processeur rend l'infini. Les deux rejettent le même sous-arbre. */
const INF32 = 3.4e38;

type Culling = NonNullable<DagRoot['culling']>;

/** Les bornes de la primitive : celles que l'hôte a déjà dérivées, sinon les nôtres. Un même
 *  tableau de nœuds vient toujours avec les mêmes pages — un placement copie l'enveloppe, pas la
 *  donnée —, si bien que la réduction est faite une fois par tableau et retrouvée par identité. */
export function cullingBoundsFor(
  culling: Culling,
  pages: DagRoot['pages'],
  cache: Map<Float64Array, Float64Array>,
) {
  if (culling.bounds) return culling.bounds;
  let values = cache.get(culling.nodes);
  if (!values) {
    values = cullingBounds(culling, pages);
    cache.set(culling.nodes, values);
  }
  return values;
}

/**
 * Recopie les nœuds d'une primitive dans le tableau de la carte et rend, par grappe, le nœud feuille
 * qui la possède. `owner` est rempli sur place ; une grappe qu'aucune feuille ne range reste à
 * `SELECTION_NONE`, comme pour la coupe processeur, et n'est jamais sélectionnée.
 */
export function packCullingNodes(
  nodes: Float32Array,
  nodeInts: Uint32Array,
  culling: Culling,
  bounds: Float64Array,
  place: { world: number; nodeBase: number; pageBase: number },
  owner: Uint32Array,
) {
  if (culling.stride < CULL_STRIDE) throw new Error('GPU_DAG_CULLING_STRIDE');
  const { world, nodeBase, pageBase } = place;
  const count = culling.nodes.length / culling.stride;
  if (bounds.length !== count * BOUND_STRIDE) throw new Error('GPU_DAG_CULLING_BOUNDS');
  for (let n = 0; n < count; n++) {
    const src = n * culling.stride,
      dst = (nodeBase + n) * DAG_NODE_FLOATS,
      at = n * BOUND_STRIDE;
    for (let a = 0; a < 3; a++) {
      nodes[dst + NODE_MIN + a] = culling.nodes[src + a];
      nodes[dst + NODE_MAX + a] = culling.nodes[src + 3 + a];
    }
    for (let a = 0; a < 4; a++) {
      nodes[dst + NODE_SPHERE + a] = culling.nodes[src + 6 + a];
      nodes[dst + NODE_FLOOR_SPHERE + a] = bounds[at + OWN_SPHERE + a];
    }
    nodes[dst + NODE_CEIL] = culling.nodes[src + 10];
    nodeInts[dst + NODE_FIRST_CHILD] = nodeBase + culling.nodes[src + 11];
    nodeInts[dst + NODE_CHILD_COUNT] = culling.nodes[src + 12];
    nodeInts[dst + NODE_FIRST_PAGE] = pageBase + culling.nodes[src + 13];
    nodeInts[dst + NODE_PAGE_COUNT] = culling.nodes[src + 14];
    nodeInts[dst + NODE_WORLD] = world;
    const floor = bounds[at + OWN_FLOOR];
    nodes[dst + NODE_FLOOR] = Number.isFinite(floor) ? floor : INF32;
    nodeInts[dst + NODE_FLAGS] = bounds[at + HAS_ROOT] ? NODE_HAS_ROOT : 0;
    nodeInts[dst + NODE_PAD] = 0;
    nodeInts[dst + NODE_PAD + 1] = 0;
    if (!culling.nodes[src + 12]) {
      const first = culling.nodes[src + 13],
        pages = culling.nodes[src + 14];
      for (let i = 0; i < pages && first + i < owner.length; i++) owner[first + i] = nodeBase + n;
    }
  }
  return count;
}
