/**
 * Les poids du filtre de l'image courante : un par voisin de la fenêtre 3×3, pour une gigue donnée.
 * Fenêtre de Blackman-Harris sur un rayon d'UN pixel, centrée sur le centre non décalé du pixel :
 * un voisin ne pèse que lorsque l'échantillon de cette image est loin du centre, ce qui recentre
 * sans adoucir. Ils ne dépendent que de la gigue, donc ils se calculent une fois par image, ici,
 * et jamais par pixel — vingt-sept cosinus de moins par pixel.
 */

/** Neuf poids, rangés voisin par voisin (dy puis dx, de −1 à 1), trois `vec4f` dans l'uniforme. */
export const TAA_WEIGHTS = 12;

/** La fenêtre sur `[0, 1]` du rayon, nulle au-delà. */
function blackmanHarris(distance: number) {
  const x = Math.min(1, Math.max(0, distance)) * Math.PI + Math.PI;
  return 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x);
}

/**
 * Écrit les neuf poids normalisés à `out[at..]`, à partir de la gigue `(jx, jy)` en pixels. Un
 * point qui atterrit au centre d'un pixel de l'image décalée serait, sans gigue, `jx` colonnes plus
 * à gauche et `jy` lignes plus bas — le NDC monte quand l'écran descend —, donc l'échantillon est à
 * `(−jx, +jy)` du centre, et chaque voisin `(dx, dy)` à `(dx − jx, dy + jy)`.
 */
export function taaWeights(jx: number, jy: number, out: Float32Array, at: number) {
  let sum = 0,
    k = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++, k++) {
      const w = blackmanHarris(Math.hypot(dx - jx, dy + jy));
      out[at + k] = w;
      sum += w;
    }
  for (k = 0; k < 9; k++) out[at + k] /= sum;
  for (; k < TAA_WEIGHTS; k++) out[at + k] = 0;
  return out;
}
