import type { PageRec } from '../../page/selection/selection.ts'
import { createDenseKeySet } from '../cut/denseKeys.ts'
import { pageAddress } from './pageSlots.ts'

/** Addresses a trace sample names, at most, whatever the size of the described set. */
const TRACE_SAMPLE = 16
/** A record list as a sample reads it: the row table holds empty slots. */
type PageList = ArrayLike<PageRec | undefined>

/** Stable numeric page keys keep the hot residency path out of string hash tables. The catalogue
 *  is the list of pool ADDRESSES (`pageAddress`), which is what the cache holds and pins. */
export function createWebgpuPageTracking(allPages: PageRec[]) {
  const pageCatalog = [...new Set(allPages.map(pageAddress))]
  const pageCatalogIds = new Map(pageCatalog.map((url, index) => [url, index]))
  const pageRefs = (urls: string[]) => urls.map((url) => pageCatalogIds.get(url) ?? url)
  const keyCount = Math.max(1, pageCatalog.length)
  // The highest DAG level of the catalogue: admission ranks the minimum capacity above it.
  let topLevel = 0
  for (const page of allPages) {
    page.keyIndex = pageCatalogIds.get(pageAddress(page))
    topLevel = Math.max(topLevel, page.level ?? 0)
  }
  const keyOf = (rec: PageRec) => {
    const key = rec.keyIndex ?? pageCatalogIds.get(pageAddress(rec))
    if (key === undefined) throw new Error(`RESIDENCY_KEY_UNKNOWN: ${pageAddress(rec)}`)
    rec.keyIndex = key
    return key
  }
  /**
   * The three sets the residency path carries from one image to the next. They are dense sets, not
   * per-image rebuilds: an image that changes no page touches none of them.
   * `wanted` is what the upload queue still has to fetch, `wantedPages` the record it fetches each key
   * by; `keep` is what the image forbids the cache to reclaim; `pinned` is what the cache actually
   * holds pinned for it.
   */
  const wantedPages: PageRec[] = []
  const wanted = createDenseKeySet(wantedPages)
  const keep = createDenseKeySet()
  const pinned = createDenseKeySet()
  /**
   * Keys something outside the residency path unpinned — a host page drop. The pin step drains this
   * and puts back the ones the image still keeps, so a dropped page that comes back is pinned again.
   */
  const unpinned: number[] = []
  const markPinned = (key: number) => {
    pinned.add(key)
  }
  const unmarkPinned = (key: number) => {
    if (pinned.remove(key)) unpinned.push(key)
  }
  return {
    pageCatalog,
    pageCatalogIds,
    pageRefs,
    keyCount,
    keyOf,
    topLevel,
    wanted,
    wantedPages,
    keep,
    pinned,
    unpinned,
    markPinned,
    unmarkPinned,
    ...createTraceSamples(pageCatalog, pageRefs),
  }
}

type TraceSample = { revision: number; count: number; sample: string[] }
type Samples = {
  traceSets: Map<string, TraceSample>
  scratch: string[]
  pageRefs: (urls: string[]) => (string | number)[]
}

/** The trace's bounded samples of the residency sets (`publish`): by address list, by record list,
 *  by dense key set. */
function createTraceSamples(pageCatalog: readonly string[], pageRefs: Samples['pageRefs']) {
  const t: Samples = { traceSets: new Map(), scratch: [], pageRefs }
  return {
    traceSets: t.traceSets,
    traceSet: (name: string, urls: readonly string[]) =>
      publish(t, name, urls.length, (index) => urls[index]),
    /** The same sample, taken from the records themselves: no address list is built for it. `count`
     *  bounds the list when only its start is valid, like the row table. */
    traceRecs: (name: string, pages: PageList, count = pages.length) =>
      publish(t, name, count, (index) => {
        const rec = pages[index]
        return rec ? pageAddress(rec) : ''
      }),
    /** The same sample, taken from a dense key set, without copying a single address from it. */
    traceKeys: (name: string, set: { list: Int32Array; count: number }) =>
      publish(t, name, set.count, (index) => pageCatalog[set.list[index]]),
  }
}

/**
 * A trace sample never walks a list proportional to the cut or the catalogue: it publishes the
 * NUMBER of entries, already held, and a probe of at most `TRACE_SAMPLE` addresses spaced evenly
 * over the list. Comparing and copying that probe bounds the cost of trace mode, where the full
 * list made it proportional to the image — and allocated as many arrays per image.
 *
 * Age therefore rises only on a change the probe sees; that is what a bounded diagnostic promises,
 * and never the exact inventory of a set.
 */
function publish(t: Samples, name: string, count: number, urlAt: (index: number) => string) {
  const { scratch, traceSets } = t
  const size = Math.min(count, TRACE_SAMPLE)
  scratch.length = 0
  for (let k = 0; k < size; k++) scratch.push(urlAt(Math.floor((k * count) / size)))
  const previous = traceSets.get(name)
  const sampled = count > size
  if (
    previous &&
    previous.count === count &&
    previous.sample.length === size &&
    previous.sample.every((url, index) => url === scratch[index])
  )
    return { revision: previous.revision, changed: false, count, sampled }
  const next = { revision: (previous?.revision ?? 0) + 1, count, sample: [...scratch] }
  traceSets.set(name, next)
  return {
    revision: next.revision,
    changed: true,
    count,
    sampled,
    pageIds: t.pageRefs(next.sample),
  }
}
