import type { PageRec } from './pageSelection.ts';

// Deux parcours du catalogue des pages, faits une fois au chargement : la table des pages par
// adresse et les compteurs du diagnostic des textures.

/**
 * Les pages du catalogue par adresse de cluster. Le cache GPU lit les octets d'une page au moment
 * où il la téléverse, et il les lit ICI : la table est posée une fois au chargement et ne bouge
 * plus, là où une table d'octets tenue à jour coûtait à chaque arrivée une allocation et une
 * insertion PAR CLUSTER du paquet. La dernière page d'une adresse l'emporte, comme `new Map`.
 */
export function indexPageRecords(allPages: readonly PageRec[]) {
  const recByUrl = new Map<string, PageRec>();
  for (const page of allPages) recByUrl.set(page.url, page);
  return recByUrl;
}

/** Les octets d'index d'une page, vus comme des octets, ou `undefined` tant qu'elle n'en a pas. */
export function pageSourceBytes(rec: PageRec | undefined) {
  const array = rec?.array;
  return array && new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

/**
 * Les trois nombres que le diagnostic des textures publie, pris en un parcours : un `map` de toutes
 * les pages et deux copies de la table des géométries étaient alloués rien que pour les lire.
 */
export function compteMateriauxEtTangentes(
  allPages: readonly PageRec[],
  geometryBlocks: ReadonlyMap<unknown, { hasTangent: boolean }>,
) {
  const materials = new Set<PageRec['material']>();
  for (const page of allPages) materials.add(page.material);
  let geometryWithTangents = 0,
    geometryWithoutTangents = 0;
  for (const block of geometryBlocks.values())
    if (block.hasTangent) geometryWithTangents++;
    else geometryWithoutTangents++;
  return { materials: materials.size, geometryWithTangents, geometryWithoutTangents };
}
