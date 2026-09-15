/**
 * Couleurs du socle mathématique : la courbe de transfert sRGB par morceaux, telle que le dépôt
 * l'écrit partout (seuils 0,04045 et 0,0031308, pente 12,92, exposant 2,4), la même que le
 * compilateur Rust et que la composition WGSL. La bibliothèque 3D de référence arrondit ses
 * constantes (`c · 0,0773993808`, `c · 0,9478672986 + 0,0521327014`) : l'écart est chiffré au banc
 * `sdk-browser/bench/socle-math.bench.mjs`, et ce n'est pas elle qui décide ici.
 */

/** Valeur sRGB encodée dans `[0, 1]` vers sa valeur linéaire. */
export function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Valeur linéaire vers sa valeur sRGB encodée, négatifs ramenés à zéro avant l'exposant. */
export function linearToSrgb(c: number) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
}
