import {
  PAGE_SLICE_STRIDE,
  PAGE_SPEC_STRIDE,
  SLICE_OFFSET_WORDS,
  SLICE_PAGE_INDEX,
  SLICE_WORDS,
  SPEC_PAGE_INDEX,
  SPEC_STREAM_OFFSET,
  SPEC_TRIANGLES,
} from './integrationContracts.ts';

/**
 * Length beyond which insertion ceases to be the best sort: up to there an almost
 * ordered list moves nothing, beyond a disordered list would cost its square.
 */
const SORT_INSERTION_MAX = 64;

/**
 * In-place increasing sort of a prefix of a page-index array.
 *
 * The lists sorted here almost always hold a few dozen already-ordered entries:
 * insertion then moves nothing at all and allocates nothing. A long list — the queue of pages
 * waiting for their sheet during a burst of arrivals — goes through the typed-array sort, in
 * n log n, at the cost of a single view on the start of the array.
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

/** Plan of an arrival: one slice per record, and the page ranks it moves. */
export type PageIntegrationPlan = {
  slices: Int32Array;
  count: number;
  pages: Int32Array;
  pageCount: number;
};

/**
 * Integration plan of an arrived pack, computed from the catalogue integers alone.
 *
 * For each record: the first index word it occupies in the pack and the number of
 * words it holds there — exactly what the view on the pack covered until now, at the same
 * bits, since it is the same integer divide by four and the same product by three. A request
 * that carries only one page takes the whole pack: its offset is `-1` in the sheet.
 *
 * Page ranks are returned distinct and increasing: that is the order the residency
 * journal names them, and sorting an almost always already-ordered list moves nothing. A
 * record out of table (`-1`) is not part of it.
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

/** Buffers of a plan, sized for the catalogue's fullest request. */
export function createPageIntegrationPlan(records: number): PageIntegrationPlan {
  const room = Math.max(1, records);
  return {
    slices: new Int32Array(room * PAGE_SLICE_STRIDE),
    count: 0,
    pages: new Int32Array(room),
    pageCount: 0,
  };
}
