export { selectVisiblePages } from '../cut/cut.ts';
export { collectClusterPages } from './collect.ts';
export { projectedPageError } from './diagnostic.ts';
export {
  resolvePixelError,
  pageRequestUrl,
  catalogueIndexOf,
  RequestStamps,
  indexPagesByUrl,
  collectPendingUrls,
  acceptPageArray,
} from './requests.ts';
export type { PageRec, ClusterRoot } from './types.ts';
export { createSelectionResult } from '../cut/state.ts';
export type { SelectionResult } from '../cut/state.ts';

/**
 * Camera-independent minimal complete cover: the clusters no other cluster replaces.
 *
 * One cluster serves every instance that places it, so the cover holds it once. `keyOf` says what
 * "once" means for the caller — the page url by default, the pool address for an engine whose
 * slots are addressed by it (`../../webgpu/row/pageSlots.ts`), because two different clusters may well share
 * one content-addressed index page and deduplicating them would drop one out of the cover.
 */
export function rootCoverage<T extends { url: string; parentError?: number | null }>(
  roots: ReadonlyArray<{ pages: T[] }>,
  keyOf: (page: T) => string = (page) => page.url,
): T[] {
  const unique = new Map<string, T>();
  for (const root of roots) {
    let found = 0;
    for (const page of root.pages)
      if (page.parentError == null) {
        unique.set(keyOf(page), page);
        found++;
      }
    if (!found) throw new Error('INVALID_ROOT_COVERAGE');
  }
  return [...unique.values()];
}
