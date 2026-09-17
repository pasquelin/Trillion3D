import type * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { boxSphere } from './streamingPriority.ts';
import { uvSpanOf, uvSpanSettled } from './textureUvSpan.ts';

/** Couches d'atlas qu'un matériau lit : ce qui relie une surface dessinée aux textures à transférer. */
export type MaterialAtlasLayers = { color: readonly number[]; data: readonly number[] };
export type MaterialLayerIndex = Map<THREE.Material | THREE.Material[], MaterialAtlasLayers>;

/** `of` ne rend pas de rang : la page n'a pas de clé de grappe, elle ne dépose rien. */
export const ROW_NO_KEY = -1;
/** `of` ne rend pas de rang : le matériau n'entre dans aucun atlas, la page ne dépose rien. */
export const ROW_NO_LAYERS = -2;

/**
 * Ce qu'une grappe apporte à l'ordre des textures et qui ne dépend pas de la caméra.
 *
 * L'empreinte écran est le seul terme que la caméra fasse bouger : le reste — la sphère de la boîte,
 * les couches que le matériau lit, l'étendue uv de la géométrie — ne change jamais. Ces trois-là
 * étaient pourtant reconstruits par page et par image, hachage du matériau compris. Ils sont
 * désormais bâtis à la PREMIÈRE VUE d'une grappe et tenus tant que l'index des matériaux est le même,
 * si bien qu'une image ne paie plus que la projection.
 *
 * Les lignes sont rangées par CLÉ DE GRAPPE (`PageRec.keyIndex`, posé une fois par l'hôte) et non par
 * placement : douze placements d'une même grappe partagent une ligne, leur boîte étant donnée dans le
 * repère de la primitive. Sans clé, `of` rend `ROW_NO_KEY` et la page ne dépose rien : rien n'est
 * deviné. Le catalogue en pose une sur toute page (`webgpuPageTracking.ts`), si bien qu'en
 * production ce refus n'arrive pas.
 *
 * Les couches, elles, sont rangées par MATÉRIAU : une scène en porte quelques dizaines pour des
 * centaines de milliers de grappes, et la table entière est écrite à l'ouverture, à sa taille exacte.
 * Aucun tampon ne grandit donc pendant une image, et la boucle hisse ses vues une fois pour toutes.
 */
const BUILT = 1,
  /** L'étendue uv de la géométrie est mesurée et retenue : la ligne peut la figer. */
  UV_SETTLED = 2;

export function createTexturePriorityRows() {
  let keys = 0;
  let index: MaterialLayerIndex | undefined;
  let flags = new Uint8Array(0),
    sphere = new Float64Array(0),
    uvSpan = new Float64Array(0),
    /** Rang du matériau de la grappe dans les tables ci-dessous ; `-1` quand il n'a aucune couche. */
    rowMaterial = new Int32Array(0);
  let materials = new Map<THREE.Material | THREE.Material[], number>();
  let colorAt = new Int32Array(0),
    colorCount = new Int32Array(0),
    dataAt = new Int32Array(0),
    dataCount = new Int32Array(0),
    layers = new Int32Array(0);

  /** La table des matériaux, écrite en entier à l'ouverture : rangs, plages et couches à plat. */
  const openMaterials = (from: MaterialLayerIndex) => {
    let total = 0;
    for (const found of from.values()) total += found.color.length + found.data.length;
    materials = new Map();
    colorAt = new Int32Array(from.size);
    colorCount = new Int32Array(from.size);
    dataAt = new Int32Array(from.size);
    dataCount = new Int32Array(from.size);
    layers = new Int32Array(total);
    let at = 0,
      rank = 0;
    for (const [material, found] of from) {
      materials.set(material, rank);
      colorAt[rank] = at;
      colorCount[rank] = found.color.length;
      for (let i = 0; i < found.color.length; i++) layers[at++] = found.color[i];
      dataAt[rank] = at;
      dataCount[rank] = found.data.length;
      for (let i = 0; i < found.data.length; i++) layers[at++] = found.data[i];
      rank++;
    }
  };

  const build = (page: PageRec, key: number) => {
    const { min, max } = page;
    boxSphere(sphere, min[0], min[1], min[2], max[0], max[1], max[2], key * 4);
    rowMaterial[key] = materials.get(page.material) ?? -1;
    flags[key] = BUILT;
  };

  return {
    /**
     * Ouvre une scène. Un index de matériaux neuf — la préparation en rebâtit un entier, elle ne mute
     * jamais le sien — jette toutes les lignes : elles en tiennent le rang de matériau.
     */
    open(nextIndex: MaterialLayerIndex | undefined, keyCount: number) {
      const count = Math.max(0, keyCount | 0);
      if (!nextIndex || count <= 0) {
        index = undefined;
        return false;
      }
      if (nextIndex === index && count === keys) return true;
      index = nextIndex;
      keys = count;
      flags = new Uint8Array(count);
      sphere = new Float64Array(count * 4);
      uvSpan = new Float64Array(count).fill(1);
      rowMaterial = new Int32Array(count);
      openMaterials(nextIndex);
      return true;
    },
    /**
     * Le rang de la ligne de cette page, bâtie si l'image la découvre.
     *
     * L'étendue uv est redemandée tant qu'elle n'est pas mesurée — la mesure est bornée à quelques
     * géométries par image et rend `1` en attendant —, dans l'ordre de la coupe et pour toute page,
     * couches ou pas : le même budget dépensé dans le même ordre qu'avant le lot.
     */
    of(page: PageRec) {
      const key = page.keyIndex;
      if (key === undefined || key < 0 || key >= keys) return ROW_NO_KEY;
      if (!(flags[key] & BUILT)) build(page, key);
      if (!(flags[key] & UV_SETTLED)) {
        uvSpan[key] = uvSpanOf(page.attributes);
        if (uvSpanSettled(page.attributes)) flags[key] |= UV_SETTLED;
      }
      return rowMaterial[key] < 0 ? ROW_NO_LAYERS : key;
    },
    /** Les vues à plat, stables tant que la scène l'est : la boucle d'image les hisse une fois. */
    get views() {
      return {
        sphere,
        uvSpan,
        material: rowMaterial,
        colorAt,
        colorCount,
        dataAt,
        dataCount,
        layers,
      };
    },
  };
}
