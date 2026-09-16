import { biasedDepthBits } from '../sdk-core/index.ts';

const scratch = new Float32Array(1),
  scratchWords = new Uint32Array(scratch.buffer);

/**
 * De combien la borne est montée avant d'être arrondie en simple précision.
 *
 * La profondeur du moteur est INVERSÉE (`depthConvention.ts`) : une boîte n'est cachée que si sa
 * borne la plus proche est PLUS PETITE que l'occulteur le plus lointain. Une borne sûre MAJORE donc
 * ce que le cluster écrira. `Math.fround` arrondit au plus proche : il peut faire **descendre** la
 * valeur d'un demi-ulp, et une borne qui descend d'un bit suffit à faire rejeter un cluster qui
 * peint encore son pixel. Monter d'un ulp entier avant l'arrondi retourne définitivement le sens :
 * pour `x > 0`, le produit vaut au moins `x(1 + 2⁻²⁴)(1 − 2⁻⁵³)` et son arrondi au moins
 * `x(1 + 2⁻⁴⁸)(1 − 2⁻⁵³)`, donc strictement plus que `x`. Un multiplicateur et un arrondi, pas de
 * manipulation de bits par boîte.
 */
const GROW = 1 + 2 ** -24;

/**
 * La borne de profondeur qu'une boîte porte jusqu'au noyau d'occultation : un MAJORANT de ce que le
 * cluster écrira s'il est dessiné, en simple précision comme le noyau la lit.
 *
 * Deux écarts séparent le coin le plus proche de la boîte, calculé en double, de la profondeur que
 * la carte écrira. Le premier est l'arrondi du transport, redressé par `GROW`. Le second est le
 * **biais de couche coplanaire** : un cluster de couche non nulle est dessiné de seize unités
 * matérielles par couche plus près de l'œil, donc plus proche que son propre coin ;
 * `biasedDepthBits` — la fonction que le raster logiciel applique déjà à sa clé — ajoute exactement
 * ces unités aux bits de la borne. Avec ces deux redressements, `nearest < far` implique que le
 * cluster est derrière tout ce que la pyramide a vu, quelle que soit sa couche.
 *
 * Une borne nulle ou négative est rendue telle quelle : elle décrit le lointain, où rien n'est
 * dessiné, et rien n'a besoin d'être redressé.
 */
export function hizNearestBound(nearest: number, depthLayer: number) {
  if (!(nearest > 0)) return nearest;
  const above = Math.fround(nearest * GROW);
  if (!depthLayer) return above;
  scratch[0] = above;
  scratchWords[0] = biasedDepthBits(scratchWords[0], depthLayer);
  return scratch[0];
}
