/**
 * Les seize flottants d'une matrice, retenus d'une image à l'autre pour savoir si la vue a bougé.
 * Deux tenues comparent exactement la même chose — la vue et la projection de l'image — et chacune
 * écrivait sa propre boucle ; elles lisent la même arithmétique, au flottant près et sans tolérance.
 */
export function sameElements(held: Float64Array, now: ArrayLike<number>) {
  for (let i = 0; i < 16; i++) if (held[i] !== now[i]) return false;
  return true;
}

export function copyElements(held: Float64Array, now: ArrayLike<number>) {
  for (let i = 0; i < 16; i++) held[i] = now[i];
}
