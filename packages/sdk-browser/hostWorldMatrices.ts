import type * as THREE from 'three';
import { EngineError } from '../sdk-core/index.ts';

/**
 * La frontière de résolution du graphe hôte.
 *
 * La scène appartient à l'hôte : c'est lui qui écrit les poses locales de ses nœuds, et c'est sa
 * bibliothèque qui les compose. Le moteur ne recompose aucune matrice monde — il demande ici, une
 * fois par passe, que le graphe soit à jour, puis ne lit plus que `node.matrixWorld`.
 *
 * Ces deux fonctions sont les seules du paquet à appeler une mise à jour de matrice de l'hôte au
 * chargement ; tout le reste des calculs passe par le socle de `sdk-core`. Le test de structure
 * `test/engineNoThreeMath.test.mjs` le tient.
 */

/** Le sous-arbre entier de `node` : ce qu'on demande avant de parcourir une scène pour la lire. */
export function resolveHostSubtree(node: THREE.Object3D) {
  node.updateMatrixWorld(true);
}

/** La seule chaîne des ancêtres de `node`, ses enfants laissés en l'état : sa matrice monde à lui. */
export function resolveHostNode(node: THREE.Object3D) {
  node.updateWorldMatrix(true, false);
}

/**
 * La translation de la matrice monde de `node`, écrite à plat en `out[o..o+2]`. C'est ce que rendait
 * `getWorldPosition` : les trois dernières entrées de la colonne de translation, rien de plus. Le
 * nœud doit avoir été résolu.
 */
export function hostWorldPositionInto(out: Float64Array, o: number, node: THREE.Object3D) {
  const elements = node.matrixWorld.elements;
  out[o] = elements[12];
  out[o + 1] = elements[13];
  out[o + 2] = elements[14];
}

/**
 * Refuse une pose dont l'un des seize nombres n'est pas fini. Une transformation NaN ou infinie ne
 * se transporte dans aucune normale : le noyau d'inverse-transposée la verrait par sa somme non
 * finie et rendrait le vecteur nul, donc une surface éteinte sans que personne sache pourquoi.
 * Elle est donc refusée à l'ENTRÉE — au chargement (`explorerScene.ts`) et à chaque pose demandée
 * (`webgpuPagesTransform.ts`) —, avec le nom du nœud et le rang fautif. C'est le cas 4 de la
 * convention des normales singulières, écrite dans `inverseTransposeWgsl.ts` ; les cas 1 à 3 y
 * répondent par un calcul, celui-ci par un refus.
 */
export function assertFiniteTransform(elements: ArrayLike<number>, nodeName: string) {
  for (let index = 0; index < 16; index++)
    if (!Number.isFinite(elements[index]))
      throw new EngineError('NON_FINITE_TRANSFORM', `${nodeName}: matrice non finie`, {
        nodeName,
        index,
        value: elements[index],
      });
}
