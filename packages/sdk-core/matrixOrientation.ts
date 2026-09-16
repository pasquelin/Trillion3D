/**
 * Orientation d'une transformation monde, seize nombres en entrée et rien d'autre : ni Three, ni
 * GPU, ni DOM. Rangée ici, à côté de `maxStretch`, elle se teste sans navigateur et le rasteriseur
 * CPU du tampon de visibilité n'a plus à la lire dans un module `webgpu*`.
 */

/**
 * La transformation renverse-t-elle l'orientation ? Le déterminant de la 3×3 d'une matrice monde
 * est négatif, donc la face à éliminer est l'autre.
 *
 * `elements` est une 4×4 rangée par colonnes comme le fait une bibliothèque 3D : la partie linéaire
 * occupe les indices 0,1,2 / 4,5,6 / 8,9,10. La dernière ligne d'une matrice monde affine valant
 * (0, 0, 0, 1), ce déterminant 3×3 EST celui de la 4×4 : les trois cofacteurs de la dernière ligne
 * y sont multipliés par zéro. Neuf multiplications au lieu d'une trentaine, et le même verdict —
 * sauf sur une matrice singulière à l'arrondi près, qui aplatit la primitive sur un plan ou une
 * droite et n'a plus de face à montrer.
 */
export function matrixWindingCw(elements: ArrayLike<number>) {
  return (
    elements[0] * (elements[5] * elements[10] - elements[6] * elements[9]) -
      elements[1] * (elements[4] * elements[10] - elements[6] * elements[8]) +
      elements[2] * (elements[4] * elements[9] - elements[5] * elements[8]) <
    0
  );
}
