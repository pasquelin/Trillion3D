/**
 * Sphère englobante d'une boîte, écrite à plat : centre `x, y, z` puis rayon, à partir de `o`.
 *
 * Le centre est le milieu des bornes, `(min + max) * 0.5` ; le rayon la moitié de la diagonale,
 * `‖max − min‖ * 0.5`, la norme étant `Math.sqrt(x² + y² + z²)`. Une boîte vide — une borne haute
 * sous sa borne basse — rend la sphère vide, centre nul et rayon `-1`. C'est l'arithmétique de la
 * boîte de Three.js terme à terme : les mêmes bits, NaN, zéros signés et infinis compris.
 */
export function sphereFromBounds(
  out: Float64Array,
  o: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  if (maxX < minX || maxY < minY || maxZ < minZ) {
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = 0;
    out[o + 3] = -1;
    return;
  }
  out[o] = (minX + maxX) * 0.5;
  out[o + 1] = (minY + maxY) * 0.5;
  out[o + 2] = (minZ + maxZ) * 0.5;
  const sx = maxX - minX,
    sy = maxY - minY,
    sz = maxZ - minZ;
  out[o + 3] = Math.sqrt(sx * sx + sy * sy + sz * sz) * 0.5;
}
