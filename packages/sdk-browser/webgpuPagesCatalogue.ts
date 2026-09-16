import type { PageRec } from './pageSelection.ts';

// Deux parcours du catalogue des pages, faits une fois au chargement : la table des pages par
// adresse et les compteurs du diagnostic des textures.

/**
 * Les octets d'index de chaque page, vus comme des octets, par adresse de cluster.
 *
 * Douze placements d'un même objet partagent l'adresse de leurs clusters : une table « une page par
 * adresse » ne peut pas dire lequel porte les octets à l'instant où le cache les demande. La table
 * est donc tenue par adresse, posée au chargement depuis les pages déjà servies, complétée à chaque
 * arrivée et vidée à chaque abandon — une vue par cluster, jamais une copie.
 */
export function indexSourceBytes(allPages: readonly PageRec[]) {
  const sourceBytes = new Map<string, Uint8Array>();
  for (const page of allPages) {
    const bytes = pageSourceBytes(page);
    if (bytes) sourceBytes.set(page.url, bytes);
  }
  return sourceBytes;
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
