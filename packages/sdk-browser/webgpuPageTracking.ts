import type { PageRec } from './pageSelection.ts';

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
  const keepStamp = new Int32Array(keyCount),
    keepList = new Int32Array(keyCount);
  const wantedStamp = new Int32Array(keyCount),
    wantedList = new Int32Array(keyCount);
  const queuedStamp = new Int32Array(keyCount);
  const requestedStamp = new Int32Array(keyCount),
    requestedList = new Int32Array(keyCount);
  const transitionStamp = new Int32Array(keyCount);
  const pinnedAt = new Int32Array(keyCount).fill(-1),
    pinnedList = new Int32Array(keyCount);
  let keepEpoch = 0,
    keepCount = 0,
    wantedEpoch = 0,
    wantedCount = 0,
    queuedEpoch = 0;
  let requestedEpoch = 0,
    requestedCount = 0,
    transitionEpoch = 0,
    transitionCount = 0,
    pinnedCount = 0;
  const markPinned = (key: number) => {
    if (pinnedAt[key] < 0) {
      pinnedAt[key] = pinnedCount;
      pinnedList[pinnedCount++] = key;
    }
  };
  const unmarkPinned = (key: number) => {
    const at = pinnedAt[key];
    if (at < 0) return;
    const last = pinnedList[--pinnedCount];
    pinnedList[at] = last;
    pinnedAt[last] = at;
    pinnedAt[key] = -1;
  };
  const pinnedUrls = () => {
    const urls: string[] = [];
    for (let i = 0; i < pinnedCount; i++) urls.push(pageCatalog[pinnedList[i]]);
    return urls;
  };
  const wantedUrls = () => {
    const urls: string[] = [];
    for (let i = 0; i < wantedCount; i++) urls.push(pageCatalog[wantedList[i]]);
    return urls;
  };
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
    keepStamp,
    keepList,
    wantedStamp,
    wantedList,
    queuedStamp,
    requestedStamp,
    requestedList,
    transitionStamp,
    pinnedAt,
    pinnedList,
    markPinned,
    unmarkPinned,
    pinnedUrls,
    wantedUrls,
    traceSets,
    traceSet,
    get keepEpoch() {
      return keepEpoch;
    },
    set keepEpoch(value: number) {
      keepEpoch = value;
    },
    get keepCount() {
      return keepCount;
    },
    set keepCount(value: number) {
      keepCount = value;
    },
    get wantedEpoch() {
      return wantedEpoch;
    },
    set wantedEpoch(value: number) {
      wantedEpoch = value;
    },
    get wantedCount() {
      return wantedCount;
    },
    set wantedCount(value: number) {
      wantedCount = value;
    },
    get queuedEpoch() {
      return queuedEpoch;
    },
    set queuedEpoch(value: number) {
      queuedEpoch = value;
    },
    get requestedEpoch() {
      return requestedEpoch;
    },
    set requestedEpoch(value: number) {
      requestedEpoch = value;
    },
    get requestedCount() {
      return requestedCount;
    },
    set requestedCount(value: number) {
      requestedCount = value;
    },
    get transitionEpoch() {
      return transitionEpoch;
    },
    set transitionEpoch(value: number) {
      transitionEpoch = value;
    },
    get transitionCount() {
      return transitionCount;
    },
    set transitionCount(value: number) {
      transitionCount = value;
    },
    get pinnedCount() {
      return pinnedCount;
    },
    set pinnedCount(value: number) {
      pinnedCount = value;
    },
  };
}
