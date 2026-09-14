export { selectVisiblePages } from './pageSelectionCut.ts';
export { collectClusterPages } from './pageSelectionCollect.ts';
export { projectedPageError } from './pageSelectionDiagnostic.ts';
export {
  resolvePixelError,
  pageRequestUrl,
  RequestStamps,
  indexPagesByUrl,
  collectPendingUrls,
  acceptPageArray,
} from './pageSelectionRequests.ts';
export type { PageRec, ClusterRoot } from './pageSelectionTypes.ts';
export { createSelectionResult } from './pageSelectionCutState.ts';
export type { SelectionResult } from './pageSelectionCutState.ts';

/** Camera-independent minimal complete cover. Shared page URLs may serve multiple instances.
 *  The cover is the set of clusters no other cluster replaces. */
export function rootCoverage<T extends { url: string; parentError?: number | null }>(
  roots: ReadonlyArray<{ pages: T[] }>,
): T[] {
  const unique = new Map<string, T>();
  for (const root of roots) {
    let found = 0;
    for (const page of root.pages)
      if (page.parentError == null) {
        unique.set(page.url, page);
        found++;
      }
    if (!found) throw new Error('INVALID_ROOT_COVERAGE');
  }
  return [...unique.values()];
}
