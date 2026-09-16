import type * as THREE from 'three';

/**
 * Recopie `camera` dans `into`, caméra sans parent qui garde sa pose monde au bit près : sa matrice
 * locale est la matrice monde de la source et ne se recompose plus depuis une position locale. Une
 * vue tenue d'une image à l'autre (historique Hi-Z) ou rendue à part (seconde vue de capture) décrit
 * ainsi la vue réellement dessinée, même quand la source est l'enfant d'un rig ; pour une caméra sans
 * parent, rien ne change. La source doit être à jour, ancêtres compris.
 *
 * La pose monde et son inverse sont posés ici, une fois : sans parent et sans mise à jour
 * automatique, `updateWorldMatrix` n'en referait que la copie et l'inversion 4×4 de la même matrice
 * figée — ce que `sameHizView` refaisait à chaque image pour un résultat invariant.
 */
export function holdCameraWorld<T extends THREE.PerspectiveCamera>(
  into: T,
  camera: THREE.PerspectiveCamera,
): T {
  into.copy(camera, false);
  into.matrixAutoUpdate = false;
  into.matrix.copy(camera.matrixWorld);
  into.matrixWorld.copy(into.matrix);
  into.matrixWorldInverse.copy(into.matrixWorld).invert();
  return into;
}
