import type * as THREE from 'three';

/**
 * L'étendue uv d'un cluster : combien de fois sa texture se déroule sur lui.
 *
 * Le niveau de mip qu'un écran demande vaut `log2(texels / pixels)`, et le nombre de texels que
 * couvre un cluster est la largeur de sa texture multipliée par son étendue uv — un mur qui répète
 * sa texture vingt fois en réclame vingt fois plus qu'un mur qui la déroule une fois, à empreinte
 * écran égale. L'étendue est donc lue sur les données du modèle, jamais devinée par type d'objet.
 *
 * Elle est mesurée une fois par attribut uv, par échantillonnage à pas fixe : une géométrie porte
 * des centaines de milliers de sommets et la borne de l'étendue n'a pas besoin d'être exacte au
 * dernier texel pour choisir un niveau entier. La mesure est aussi bornée par image : une scène qui
 * découvre mille clusters d'un coup ne paie pas mille parcours sur la même image, elle les étale.
 * Une géométrie pas encore mesurée compte pour un déroulement, ce que l'immense majorité vaut.
 */
const SAMPLES = 512;
const MEASURES_PER_FRAME = 4;

type UvAttribute = { array?: ArrayLike<number>; itemSize?: number; count?: number };

const spans = new WeakMap<object, number>();
let measured = 0;

/** Rouvre le quota de mesures d'une image ; appelé une fois par passe de priorité. */
export function openUvSpanBudget() {
  measured = 0;
}

function measure(uv: UvAttribute) {
  const array = uv.array!;
  const item = uv.itemSize && uv.itemSize > 0 ? uv.itemSize : 2;
  const count = uv.count && uv.count > 0 ? uv.count : Math.floor(array.length / item);
  if (count <= 0) return 1;
  const step = Math.max(1, Math.floor(count / SAMPLES));
  let uMin = Infinity,
    uMax = -Infinity,
    vMin = Infinity,
    vMax = -Infinity;
  for (let index = 0; index < count; index += step) {
    const at = index * item;
    const u = array[at],
      v = array[at + 1];
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const span = Math.max(uMax - uMin, vMax - vMin);
  return Number.isFinite(span) && span > 0 ? span : 1;
}

/** L'étendue uv d'une géométrie, mesurée une seule fois et retenue tant qu'elle vit. */
export function uvSpanOf(attributes: THREE.BufferGeometry['attributes'] | undefined): number {
  const uv = attributes?.uv as UvAttribute | undefined;
  if (!uv?.array) return 1;
  const held = spans.get(uv as object);
  if (held !== undefined) return held;
  if (measured >= MEASURES_PER_FRAME) return 1;
  measured++;
  const span = measure(uv);
  spans.set(uv as object, span);
  return span;
}
