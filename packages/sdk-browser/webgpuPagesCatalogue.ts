import type { PageRec } from './pageSelection.ts';

// Deux parcours du catalogue des pages, faits une fois au chargement : la table des octets source et
// les compteurs du diagnostic des textures.

/**
 * Les octets d'index de chaque page, vus comme des octets, par adresse. Une boucle au lieu d'un
 * `flatMap` : chaque page allouait un tableau d'un seul couple, et le tableau intermédiaire portait
 * une entrée par page du catalogue avant d'être dédoublonné. La dernière page d'une adresse
 * l'emporte, comme `new Map(entrées)`.
 */
export function indexSourceBytes(allPages: readonly PageRec[]) {
  const sourceBytes = new Map<string, Uint8Array>();
  for (const page of allPages) {
    const array = page.array;
    if (array)
      sourceBytes.set(page.url, new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  return sourceBytes;
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
