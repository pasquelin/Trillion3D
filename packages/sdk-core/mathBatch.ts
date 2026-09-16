import { BOX_VALUES, boxTransform } from './mathBox.ts';
import { multiplyMatrix4 } from './mathMatrix4.ts';
import { composeMatrix4 } from './mathMatrix4Trs.ts';

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
  out: readonly Float64Array[],
  a: readonly Float64Array[],
  b: readonly Float64Array[],
  n: number,
) {
  for (let i = 0; i < n; i++) multiplyMatrix4(out[i], a[i], b[i]);
}

/** Flottants d'une position ou d'une échelle, et d'un quaternion `(x, y, z, w)`, rangés à plat. */
export const POSITION_VALUES = 3;
export const QUATERNION_VALUES = 4;

/**
 * La HIÉRARCHIE ENTIÈRE mise à jour en une passe : `n` nœuds rangés parents avant enfants, chacun
 * composant sa matrice locale puis la multipliant par la matrice monde de son parent. C'est le
 * parcours de `mathTransformTreeUpdate.ts`, avec ses deux mêmes formules dans le même ordre, sur des
 * tampons à plat : le noyau WebAssembly le reproduit terme à terme.
 *
 * `parents[i]` DOIT être l'indice d'un nœud déjà mis à jour, donc strictement inférieur à `i` ; toute
 * autre valeur — la sentinelle `HIERARCHY_ROOT` comprise — fait du nœud une racine, dont la matrice
 * monde est sa matrice locale. La règle est la même des deux côtés : aucune entrée, si hostile
 * soit-elle, ne peut les faire diverger.
 */
export const HIERARCHY_ROOT = 0xffffffff;

export function hierarchyUpdateBatch(
  worldViews: readonly Float64Array[],
  positions: readonly Float64Array[],
  rotations: readonly Float64Array[],
  scales: readonly Float64Array[],
  parents: Uint32Array,
  n: number,
  local: Float64Array,
) {
  for (let i = 0; i < n; i++) {
    composeMatrix4(local, positions[i], rotations[i], scales[i]);
    const parent = parents[i],
      world = worldViews[i];
    // Une boucle : `TypedArray.prototype.set` sur une vue coûte un appel natif.
    if (parent >= i) for (let k = 0; k < MATRIX_VALUES; k++) world[k] = local[k];
    else multiplyMatrix4(world, worldViews[parent], local);
  }
}
