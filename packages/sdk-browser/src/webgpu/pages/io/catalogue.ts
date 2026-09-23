import type { PageRec } from '../../../page/selection/selection.ts';
import { pageAddress } from '../../row/pageSlots.ts';

// Two walks of the page catalogue, done once at load: the page table by address and the texture
// diagnostic counters.

/**
 * Index bytes of each page, seen as bytes, by cluster address.
 *
 * Twelve placements of the same object share their cluster addresses: a "one page per address" table
 * cannot say which one holds the bytes at the moment the cache asks. The table is therefore held by
 * address, set at load from already-served pages, completed on every arrival and cleared on every
 * drop — one view per cluster, never a copy.
 */
export function indexSourceBytes(allPages: readonly PageRec[]) {
  const sourceBytes = new Map<string, Uint8Array>();
  for (const page of allPages) {
    const bytes = pageSourceBytes(page);
    if (bytes) sourceBytes.set(pageAddress(page), bytes);
  }
  return sourceBytes;
}

/** Index bytes of a page, seen as bytes, or `undefined` until it has some. */
export function pageSourceBytes(rec: PageRec | undefined) {
  const array = rec?.array;
  return array && new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

/**
 * The three numbers the texture diagnostic publishes, taken in one walk: a `map` of all pages and two
 * copies of the geometry table were allocated just to read them.
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
