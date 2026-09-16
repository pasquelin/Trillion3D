import { BOX_VALUES, MATRIX_VALUES, boxUnion } from '../sdk-core/index.ts';
import { createBoxTransformLot, type BoxTransformLot } from './mathBatchRuntime.ts';
import type { ClusterRoot, PageRec } from './pageSelectionTypes.ts';

/**
 * Les boîtes monde calculées EN LOT : les deux outils que partagent les sites qui unissent des
 * bornes (`explorerScene.ts`, `hostWorldBounds.ts`), et le tampon des racines de sélection.
 *
 * Les boîtes monde des racines de sélection, calculées EN LOT par le gouverneur : un seul tampon
 * réservé à la préparation, et plus une allocation ensuite. Le chargement le joue une fois sur
 * toutes les racines ; un déplacement de nœud (R8) réécrit les matrices des seules racines déplacées
 * et le rejoue. Les racines que le déplacement n'atteint pas repassent par le noyau avec les mêmes
 * entrées qu'à la réservation : leur sortie est ignorée, et rien d'autre ne la lit.
 *
 * LES BOÎTES DES RACINES RESTENT DES TABLEAUX JAVASCRIPT, recopiées dans le tampon au lieu d'en être
 * des vues. La mémoire linéaire du module est celle du décodeur de pages : un décodage replié sur le
 * fil principal (`pageDecodeHost.ts`) y réserve, peut la faire grandir, et détache alors toutes les
 * vues déjà construites. Une vue détachée lit zéro sans rien signaler — une racine partirait à
 * l'origine sans cause lisible. Une recopie, elle, se contente de constater le tampon mort et de
 * rendre la main au chemin JavaScript, boîte par boîte.
 */

/**
 * Le lot, quand il porte EXACTEMENT `n` boîtes et que ses vues désignent encore la mémoire du
 * module — une réservation faite depuis a pu la faire grandir et les détacher. `null` sinon :
 * l'appelant repasse alors boîte par boîte, par le même noyau et sur les mêmes entrées.
 */
export function lotBoxesReady(lot: BoxTransformLot | null | undefined, n: number) {
  return lot && n > 0 && lot.boxes.length === n * BOX_VALUES ? lot : null;
}

/** Union dans `into` des `n` premières boîtes que le lot vient de rendre. */
export function unionLotBoxes(into: Float64Array, lot: BoxTransformLot, n: number) {
  const out = lot.out;
  for (let at = 0; at < n * BOX_VALUES; at += BOX_VALUES)
    boxUnion(into, 0, out[at], out[at + 1], out[at + 2], out[at + 3], out[at + 4], out[at + 5]);
}

/** Boîte locale et matrice monde de la racine `i` écrites dans le lot. */
function ecrit(lot: BoxTransformLot, i: number, root: ClusterRoot<PageRec>) {
  lot.boxes.set(root.localBox!, i * BOX_VALUES);
  lot.mats.set(root.world.elements, i * MATRIX_VALUES);
}

/** Boîte monde de la racine `i` relue du lot. */
function relit(lot: BoxTransformLot, i: number, root: ClusterRoot<PageRec>) {
  const out = lot.out,
    box = root.worldBox!,
    at = i * BOX_VALUES;
  for (let k = 0; k < BOX_VALUES; k++) box[k] = out[at + k];
}

/**
 * Réserve le lot des racines et le joue une première fois : les boîtes monde qu'il rend sont celles
 * que la collecte a déjà calculées, aux mêmes bits. `null` quand il n'y a rien à calculer ou qu'une
 * racine ne déclare pas ses boîtes — l'appelant reste alors sur le chemin JavaScript.
 */
export async function reserveRootBoxes(roots: readonly ClusterRoot<PageRec>[]) {
  if (!roots.length || roots.some((root) => !root.localBox || !root.worldBox)) return null;
  const lot = await createBoxTransformLot(roots.length);
  if (!lotBoxesReady(lot, roots.length)) return null;
  for (let i = 0; i < roots.length; i++) ecrit(lot, i, roots[i]);
  lot.run();
  for (let i = 0; i < roots.length; i++) relit(lot, i, roots[i]);
  return lot;
}

/**
 * Rejoue le lot pour les racines que `deplacee` retient. Rend `false` quand le tampon n'est plus
 * jouable : l'appelant reprend alors le calcul boîte par boîte, avec le même résultat.
 */
export function transformRootBoxes(
  lot: BoxTransformLot,
  roots: readonly ClusterRoot<PageRec>[],
  deplacee: (root: ClusterRoot<PageRec>) => boolean,
) {
  if (roots.length !== lot.n || !lotBoxesReady(lot, lot.n)) return false;
  for (let i = 0; i < roots.length; i++) if (deplacee(roots[i])) ecrit(lot, i, roots[i]);
  lot.run();
  for (let i = 0; i < roots.length; i++) if (deplacee(roots[i])) relit(lot, i, roots[i]);
  return true;
}
