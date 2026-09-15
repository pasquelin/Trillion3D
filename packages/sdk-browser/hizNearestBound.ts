import { biasedDepthBits } from '../sdk-core/index.ts';

const scratch = new Float32Array(1),
  scratchWords = new Uint32Array(scratch.buffer);

/**
 * De combien la borne est descendue avant d'être arrondie en simple précision.
 *
 * `Math.fround` arrondit au plus proche : il peut faire **monter** la valeur d'un demi-ulp, et une
 * borne qui monte d'un bit suffit à faire rejeter un cluster qui peint encore son pixel. Descendre
 * d'un ulp entier avant l'arrondi retourne définitivement le sens : pour `x > 0`, le produit vaut au
 * plus `x(1 − 2⁻²⁴)(1 + 2⁻⁵³)` et son arrondi au plus `x(1 − 2⁻⁴⁸)(1 + 2⁻⁵³)`, donc strictement
 * moins que `x`. Un multiplicateur et un arrondi, pas de manipulation de bits par boîte.
 */
const SHRINK = 1 - 2 ** -24;

/**
 * La borne de profondeur qu'une boîte porte jusqu'au noyau d'occultation : un minorant de ce que le
 * cluster écrira s'il est dessiné, en simple précision comme le noyau la lit.
 *
 * Deux écarts séparent le coin le plus proche de la boîte, calculé en double, de la profondeur que
 * la carte écrira. Le premier est l'arrondi du transport, redressé par `SHRINK`. Le second est le
 * **biais de couche coplanaire** : un cluster de couche non nulle est dessiné de seize unités
 * matérielles par couche plus près de l'œil, donc plus proche que son propre coin ;
 * `biasedDepthBits` — la fonction que le raster logiciel applique déjà à sa clé — retranche
 * exactement ces unités des bits de la borne. Avec ces deux redressements, `nearest > far` implique
 * que le cluster est derrière tout ce que la pyramide a vu, quelle que soit sa couche.
 *
 * Une borne nulle ou négative est rendue telle quelle : la pyramide ne porte que des profondeurs
 * positives ou nulles, donc une telle borne ne rejette rien, et rien n'a besoin d'être redressé.
 */
export function hizNearestBound(nearest: number, depthLayer: number) {
  if (!(nearest > 0)) return nearest;
  const below = Math.fround(nearest * SHRINK);
  if (!depthLayer) return below;
  scratch[0] = below;
  scratchWords[0] = biasedDepthBits(scratchWords[0], depthLayer);
  return scratch[0];
}
