import * as THREE from 'three';

/**
 * La copie de dessin d'une surface transparente.
 *
 * Une surface mélangée ou transmissive n'est pas dessinée par le chemin opaque : le moteur en tient
 * une copie, dans l'ordre source, avec le matériau du maillage. Ce que cette copie porte comme
 * placement est la SEULE chose qui la relie encore à la scène, et c'est là que le défaut vivait :
 * recopier `matrixWorld` à la préparation en faisait une photo, qu'aucun déplacement ultérieur —
 * `setTransform`, un parent déplacé, une écriture directe de l'hôte — ne venait plus corriger. Les
 * pages opaques, elles, ont toujours reçu la matrice monde du maillage telle quelle.
 *
 * La copie reçoit donc l'OBJET `matrixWorld` du maillage source, pas ses seize nombres : ce que la
 * hiérarchie y écrit, la copie le lit. `matrixAutoUpdate` reste faux, si bien que Three ne
 * recompose jamais cette matrice depuis la pose locale de la copie — qui n'en a pas.
 */
export function createBlendCopy(mesh: THREE.Mesh, renderOrder: number) {
  const copy = new THREE.Mesh(mesh.geometry, mesh.material);
  copy.matrixAutoUpdate = false;
  copy.matrix = mesh.matrixWorld;
  copy.frustumCulled = mesh.frustumCulled;
  copy.renderOrder = renderOrder;
  copy.userData.sourceMesh = mesh;
  return copy;
}
