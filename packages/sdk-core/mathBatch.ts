import { BOX_VALUES, boxTransform } from './mathBox.ts';
import { multiplyMatrix4, type NumberSink } from './mathMatrix4.ts';

/**
 * Les opérations du socle mathématique jouées EN LOT : `n` éléments rangés à plat, une seule entrée
 * de fonction, aucune allocation. C'est le chemin JavaScript de référence, et le chemin de repli :
 * les noyaux WebAssembly de `packages/page-codec-wasm/src/math.rs` reproduisent ces boucles terme à
 * terme, et le gouverneur (`mathPathGovernor.ts`) choisit lequel des deux tourne.
 *
 * Les matrices sont passées en SOUS-VUES de seize nombres et non en offsets : `multiplyMatrix4` et
 * `boxCornersInto` lisent leurs entrées à des indices constants, et un décalage en paramètre les
 * rendrait calculés — mesuré à 6 % du produit entier (`mathMatrix4.ts`). Les sous-vues sont
 * construites une fois pour le lot, comme la hiérarchie tient déjà `worldViews` sur `world`.
 */

/** Flottants d'une matrice 4×4 rangée à plat. */
export const MATRIX_VALUES = 16;

/** Sous-vues de `pas` nombres sur un tampon plat, construites une fois pour tout le lot. */
export function batchViews(buffer: Float64Array, pas: number, n: number) {
  const vues: Float64Array[] = new Array(n);
  for (let i = 0; i < n; i++) vues[i] = buffer.subarray(i * pas, i * pas + pas);
  return vues;
}

/**
 * `n` boîtes transformées par `n` matrices : `out[i] = boxTransform(boxes[i], mats[i])`. `out` et
 * `boxes` portent six nombres par élément, `mats` une sous-vue de seize par élément.
 */
export function boxTransformBatch(
  out: Float64Array,
  boxes: ArrayLike<number>,
  mats: readonly ArrayLike<number>[],
  n: number,
) {
  for (let i = 0; i < n; i++) {
    const at = i * BOX_VALUES;
    boxTransform(out, at, boxes, at, mats[i]);
  }
}

/** `n` produits `out[i] = a[i] · b[i]`, les trois côtés donnés en sous-vues de seize nombres. */
export function multiplyMatrix4Batch(
  out: readonly NumberSink[],
  a: readonly ArrayLike<number>[],
  b: readonly ArrayLike<number>[],
  n: number,
) {
  for (let i = 0; i < n; i++) multiplyMatrix4(out[i], a[i], b[i]);
}
