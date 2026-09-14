import type { PageRec } from './pageSelection.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';

/** Stable numeric page keys keep the hot residency path out of string hash tables. */
export function createWebgpuPageTracking(allPages: PageRec[]) {
  const pageCatalog = [...new Set(allPages.map((page) => page.url))];
  const pageCatalogIds = new Map(pageCatalog.map((url, index) => [url, index]));
  const pageRefs = (urls: string[]) => urls.map((url) => pageCatalogIds.get(url) ?? url);
  const keyCount = Math.max(1, pageCatalog.length);
  for (const page of allPages) page.keyIndex = pageCatalogIds.get(page.url);
  const keyOf = (rec: PageRec) => {
    const key = rec.keyIndex ?? pageCatalogIds.get(rec.url);
    if (key === undefined) throw new Error(`RESIDENCY_KEY_UNKNOWN: ${rec.url}`);
    rec.keyIndex = key;
    return key;
  };
  /**
   * The three sets the residency path carries from one image to the next. They are dense sets, not
   * per-image rebuilds: an image that changes no page touches none of them.
   * `wanted` is what the upload queue still has to fetch, `wantedPages` the record it fetches each key
   * by; `keep` is what the image forbids the cache to reclaim; `pinned` is what the cache actually
   * holds pinned for it.
   */
  const wantedPages: PageRec[] = [];
  const wanted = createDenseKeySet(keyCount, wantedPages);
  const keep = createDenseKeySet(keyCount);
  const pinned = createDenseKeySet(keyCount);
  /**
   * Keys something outside the residency path unpinned — a host page drop. The pin step drains this
   * and puts back the ones the image still keeps, so a dropped page that comes back is pinned again.
   */
  const unpinned: number[] = [];
  const markPinned = (key: number) => {
    pinned.add(key);
  };
  const unmarkPinned = (key: number) => {
    if (pinned.remove(key)) unpinned.push(key);
  };
  const urlsOf = (set: { list: Int32Array; count: number }) => {
    const urls: string[] = [];
    for (let i = 0; i < set.count; i++) urls.push(pageCatalog[set.list[i]]);
    return urls;
  };
  const pinnedUrls = () => urlsOf(pinned);
  const wantedUrls = () => urlsOf(wanted);
  const traceSets = new Map<string, { revision: number; urls: string[] }>();
  const traceSet = (name: string, urls: string[]) => {
    const previous = traceSets.get(name);
    if (
      previous &&
      previous.urls.length === urls.length &&
      previous.urls.every((url, index) => url === urls[index])
    )
      return { revision: previous.revision, changed: false };
    const next = { revision: (previous?.revision ?? 0) + 1, urls: [...urls] };
    traceSets.set(name, next);
    return { revision: next.revision, changed: true, pageIds: pageRefs(urls) };
  };
  return {
    pageCatalog,
    pageCatalogIds,
    pageRefs,
    keyCount,
    keyOf,
    wanted,
    wantedPages,
    keep,
    pinned,
    unpinned,
    markPinned,
    unmarkPinned,
    pinnedUrls,
    wantedUrls,
    traceSets,
    traceSet,
  };
}
