import {
  PAGE_SLICE_STRIDE,
  PAGE_SPEC_STRIDE,
  SLICE_OFFSET_WORDS,
  SLICE_PAGE_INDEX,
  SLICE_WORDS,
  SPEC_PAGE_INDEX,
  SPEC_STREAM_OFFSET,
  SPEC_TRIANGLES,
} from './pageIntegrationContracts.ts';

/**
 * Longueur au-delà de laquelle l'insertion cesse d'être le meilleur tri : jusque-là une liste
 * presque ordonnée ne déplace rien, au-delà une liste en désordre coûterait son carré.
 */
const SORT_INSERTION_MAX = 64;

/**
 * Tri croissant en place d'un début de tableau d'index de page.
 *
 * Les listes triées ici tiennent presque toujours quelques dizaines d'entrées déjà ordonnées :
 * l'insertion ne déplace alors rien du tout et n'alloue rien. Une liste longue — la file des pages
 * qui attendent leur fiche pendant une rafale d'arrivées — passe par le tri du tableau typé, en
 * n log n, au prix d'une seule vue sur le début du tableau.
 */
export function sortPages(pages: Int32Array, count: number) {
  if (count > SORT_INSERTION_MAX) {
    pages.subarray(0, count).sort();
    return;
  }
  for (let i = 1; i < count; i++) {
    const page = pages[i];
    let j = i - 1;
    while (j >= 0 && pages[j] > page) {
      pages[j + 1] = pages[j];
      j--;
    }
    pages[j + 1] = page;
  }
}

/** Le plan d'une arrivée : une tranche par enregistrement, et les rangs de page qu'elle remue. */
export type PageIntegrationPlan = {
  slices: Int32Array;
  count: number;
  pages: Int32Array;
  pageCount: number;
};

/**
 * Le plan d'intégration d'un paquet arrivé, calculé des seuls entiers du catalogue.
 *
 * Pour chaque enregistrement : le premier mot d'index qu'il occupe dans le paquet et le nombre de
 * mots qu'il y tient — exactement ce que la vue posée sur le paquet couvrait jusqu'ici, aux mêmes
 * bits, puisque c'est la même division entière par quatre et le même produit par trois. Une requête
 * qui ne porte qu'une page prend le paquet entier : son offset vaut `-1` dans la fiche.
 *
 * Les rangs de page sont rendus distincts et croissants : c'est dans cet ordre que le journal de
 * résidence les nomme, et le tri d'une liste presque toujours déjà ordonnée ne déplace rien. Un
 * enregistrement hors table (`-1`) n'en fait pas partie.
 */
export function planPageIntegration(
  specs: Int32Array,
  words: number,
  into: PageIntegrationPlan,
): PageIntegrationPlan {
  const count = (specs.length / PAGE_SPEC_STRIDE) | 0,
    { slices, pages } = into;
  let pageCount = 0,
    sorted = true,
    last = -1;
  for (let i = 0; i < count; i++) {
    const spec = i * PAGE_SPEC_STRIDE,
      offset = specs[spec + SPEC_STREAM_OFFSET],
      page = specs[spec + SPEC_PAGE_INDEX];
    const slice = i * PAGE_SLICE_STRIDE;
    slices[slice + SLICE_OFFSET_WORDS] = offset < 0 ? 0 : offset / 4;
    slices[slice + SLICE_WORDS] = offset < 0 ? words : specs[spec + SPEC_TRIANGLES] * 3;
    slices[slice + SLICE_PAGE_INDEX] = page;
    if (page < 0) continue;
    if (page <= last) sorted = false;
    last = page;
    pages[pageCount++] = page;
  }
  if (!sorted) sortPages(pages, pageCount);
  into.count = count;
  into.pageCount = pageCount;
  return into;
}

/** Les tampons d'un plan, dimensionnés pour la requête la plus fournie du catalogue. */
export function createPageIntegrationPlan(records: number): PageIntegrationPlan {
  const room = Math.max(1, records);
  return {
    slices: new Int32Array(room * PAGE_SLICE_STRIDE),
    count: 0,
    pages: new Int32Array(room),
    pageCount: 0,
  };
}
