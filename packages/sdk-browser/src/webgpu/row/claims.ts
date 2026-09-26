import { sortPages } from '../../../../sdk-core/src/index.ts';
import type { FrameClock } from '../../page/integration/frameBudget.ts';

/**
 * Pages that claim the write of a row record and have not yet received it.
 *
 * Writing a row costs a material, a hash, wrap modes, a shadow sphere, eight corners and five row
 * words: a burst of arrivals pays that many times, on the main thread, in the same image. This list
 * is what remains to do, and the rank allocator spends only what the frame's one integration budget
 * has left — the rest waits for the next image, in the same order.
 *
 * A page enrols only once: per-page marking is what guarantees it, so a page claimed twice before it
 * is served does not double the work. The list is sorted before it is served, because the residency
 * journal writes ranges only while the indices it is given increase.
 */
export function createWebgpuRowClaims(pageCount: number) {
  const marks = new Uint8Array(Math.max(1, pageCount));
  const pages = new Int32Array(Math.max(1, pageCount));
  let count = 0;
  return {
    pages,
    get count() {
      return count;
    },
    /** Enrols a page, unless it is already waiting its turn. */
    add(page: number) {
      if (marks[page]) return;
      marks[page] = 1;
      pages[count++] = page;
    },
    /** Sorts the list by increasing page index, the order the residency journal requires. */
    sort() {
      sortPages(pages, count);
    },
    /** Drops the first `served` pages, already served, and keeps the rest in its order. */
    consume(served: number) {
      for (let i = 0; i < served; i++) marks[pages[i]] = 0;
      if (served < count) pages.copyWithin(0, served, count);
      count -= served;
    },
    /** Nothing waits any more: the table has just been rebuilt as a block. */
    clear() {
      for (let i = 0; i < count; i++) marks[pages[i]] = 0;
      count = 0;
    },
  };
}

export type WebgpuRowClaims = ReturnType<typeof createWebgpuRowClaims>;

/**
 * Serves the queue in increasing page order within `budget`: the frame's one integration budget
 * (`BackendContext.frameBudget`), which its frame opened and its cells and arrivals spent from
 * first, its clock running only while rows are written — the clock is reread after each row and the rest waits for the next image, in the same
 * order. At least one row always goes through, or a page would never be written. `release` says
 * again whether the page still claims a row — it may have left since it enrolled, and then leaves
 * the queue costing nothing —, `place` writes it and returns `false` when the table is full.
 *
 * Returns the number of pages a table overflow leaves without a rank: never those the time budget
 * alone deferred, which overflow nothing. No `budget` — a barrier image, outside the measured
 * loop, or an engine driven with no frame — writes every owed row.
 */
export function serveClaims(
  claims: WebgpuRowClaims,
  release: (page: number) => boolean,
  place: (page: number) => boolean,
  budget?: FrameClock,
) {
  if (!claims.count) return 0;
  claims.sort();
  budget?.resume();
  let served = 0,
    denied = 0;
  try {
    while (served < claims.count) {
      const page = claims.pages[served];
      if (!release(page)) {
        served++;
        continue;
      }
      if (!place(page)) {
        denied = claims.count - served;
        break;
      }
      served++;
      budget?.spend();
      if (budget && !budget.admits()) break;
    }
  } finally {
    // Balanced on every path: what runs after the rows is not integration.
    budget?.pause();
  }
  claims.consume(served);
  return denied;
}
