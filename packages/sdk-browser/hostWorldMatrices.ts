import type * as THREE from 'three';

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
