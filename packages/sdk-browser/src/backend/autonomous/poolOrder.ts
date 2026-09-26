import type { PageRec } from '../../page/selection/selection.ts';
import { evictOldest } from '../../streaming/evictOldest.ts';
import { createLastUse } from '../../residency/lastUse.ts';

/**
 * The WebGL2 pages as the shared residency reads them: a small integer per URL, memoised on each
 * record (`PageRec.keyIndex`, checked against the URL it names) so an image hashes no string, and
 * given back once the page is no longer held, so the tables follow what the view holds, never
 * every URL ever asked for (#483 rule 6).
 */
export function createPageKeys() {
  const keys = new Map<string, number>(),
    urls: (string | undefined)[] = [],
    free: number[] = [];
  return {
    keyOf(rec: PageRec) {
      const memo = rec.keyIndex;
      if (memo !== undefined && urls[memo] === rec.url) return memo;
      let key = keys.get(rec.url);
      if (key === undefined) {
        key = free.pop() ?? urls.length;
        keys.set(rec.url, key);
        urls[key] = rec.url;
      }
      return (rec.keyIndex = key);
    },
    find: (url: string) => keys.get(url),
    urlOf: (key: number) => urls[key]!,
    /** The page is no longer held: its key is reused. */
    free(key: number) {
      keys.delete(urls[key]!);
      urls[key] = undefined;
      free.push(key);
    },
    /** Keys in use: the pages held. */
    get size() {
      return keys.size;
    },
  };
}

/** Frames a page stays held once the image stopped keeping it: the WebGL2 image is drawn from the
 *  cut just taken on the CPU, no frame in flight reads a page the next cut no longer holds. */
const IDLE_WINDOW = 1;

/**
 * The pages the WebGL2 geometry pool holds (`pool.ts`), by the engine's one residency
 * (`../../residency/lastUse.ts`), fed as WebGPU feeds it: what the image asks for and what it
 * draws are kept, each holding its parents. Just before a cut, what the last image drew but no
 * longer asks for leaves `keep`: that cut draws its nearest resident ancestor instead. A page that
 * leaves is released once its window ends, or at once when the pool is short (the window gives
 * way to the pages missing), finest first. Only released pages enter the order, by last use, and
 * leave it oldest first once over `limit`; between two cuts, an arrival stays. The root cover and
 * the host's pages never enter it (docs/ENGINE.md, the WebGL2 pool).
 */
export function createResidentOrder(env: {
  state: { readonly allocationBytes: number };
  drop: (url: string) => void;
  limit: () => number;
  floorBytes: () => number;
  /** Bytes of one slot: what converts the pool's shortfall into pages to release. */
  pageBytes: () => number;
  parentsOf: (rec: PageRec) => readonly PageRec[];
}) {
  const { state, drop, limit } = env;
  const keys = createPageKeys();
  // Resident pages above the root cover; the released ones in last-use order; arrivals since the
  // last cut.
  const resident = new Set<string>(),
    order = new Set<string>(),
    arrivals = new Set<string>();
  // What the image keeps, by key: the stamp of the `keep` that named it, and the list of that
  // `keep` beside the previous one's, swapped.
  let marks = new Int32Array(64),
    stamp = 1,
    kept: PageRec[] = [],
    entering: PageRec[] = [],
    asked: readonly PageRec[] = [],
    frame = 0,
    // A walk found nothing left to evict: nothing is until the next cut.
    exhausted = false,
    floorBytes = 0;
  const lastUse = createLastUse({
    idleWindow: IDLE_WINDOW,
    levelPerFrame: true,
    keyOf: keys.keyOf,
    parentsOf: env.parentsOf,
    kept: (key) => marks[key] === stamp,
  });
  /** Released: its key goes back, and a resident page enters the order, the most recent. */
  const released = (key: number) => {
    const url = keys.urlOf(key);
    keys.free(key);
    if (!resident.has(url)) return false;
    order.add(url);
    return true;
  };
  const enter = (list: readonly PageRec[], previous: number) => {
    for (const rec of list) {
      const key = keys.keyOf(rec);
      if (key >= marks.length) {
        const grown = new Int32Array(2 * key + 2);
        grown.set(marks);
        marks = grown;
      }
      if (marks[key] === stamp) continue;
      const was = marks[key] === previous;
      marks[key] = stamp;
      entering.push(rec);
      if (was) continue;
      // Kept again: it is held, out of the order.
      order.delete(rec.url);
      lastUse.use(key, rec);
    }
  };
  /** The image keeps `requested` and `shown`: what joined is held, and of what left, the finest
   *  DAG level starts its window, the coarser ones held one more `keep`, so the image lets go of one
   *  level at a time. Walks both lists, never what is held. */
  const keep = (requested: readonly PageRec[], shown: readonly PageRec[]) => {
    const previous = stamp++;
    entering.length = 0;
    enter(requested, previous);
    enter(shown, previous);
    let finest = Infinity;
    for (const rec of kept)
      if (marks[keys.keyOf(rec)] !== stamp) finest = Math.min(finest, rec.level ?? 0);
    for (let i = kept.length - 1; i >= 0; i--) {
      const rec = kept[i],
        key = keys.keyOf(rec);
      if (marks[key] === stamp) continue;
      if ((rec.level ?? 0) > finest) {
        marks[key] = stamp;
        entering.push(rec);
      } else lastUse.leave(key, frame);
    }
    const swap = kept;
    kept = entering;
    entering = swap;
    asked = requested;
  };
  const over = () => state.allocationBytes > Math.max(limit(), floorBytes);
  const evictOne = (url: string) => {
    order.delete(url);
    resident.delete(url);
    drop(url);
  };
  const none = () => false;
  /** Evicts released pages oldest first while over the budget, but those `spared`; when they do
   *  not suffice, the pages missing are released early, as WebGPU gives way under pressure. */
  const shed = (spared: (url: string) => boolean) => {
    // What nothing may evict only raises the bar: under the pool it is not even read.
    if (exhausted || state.allocationBytes <= limit()) return 0;
    floorBytes = env.floorBytes();
    if (!over()) return 0;
    let evicted = evictOldest(order, over, spared, evictOne);
    while (over()) {
      const before = order.size,
        short = state.allocationBytes - Math.max(limit(), floorBytes);
      lastUse.release(frame, released, Math.ceil(short / env.pageBytes()));
      if (order.size === before) break;
      evicted += evictOldest(order, over, spared, evictOne);
    }
    exhausted = over();
    return evicted;
  };
  const isArrival = (url: string) => arrivals.has(url);
  return {
    /** Between two cuts — a budget set mid-session —: what the image drew and what arrived stay. */
    shedBetweenCuts: () => shed(isArrival),
    /** A page has arrived, or arrived again: it stays until the next cut, and enters the order at
     *  once when nothing holds it. */
    arrived(url: string) {
      resident.add(url);
      arrivals.add(url);
      const key = keys.find(url);
      if (key === undefined || !lastUse.holds(key)) {
        order.delete(url);
        order.add(url);
      }
      shed(isArrival);
    },
    /** A page left by another way — the streamer evicted it —, or the host replaced it, which
     *  holds it for good under the floor. */
    left(url: string) {
      resident.delete(url);
      order.delete(url);
      arrivals.delete(url);
    },
    /** The image drew `shown` and asks for `requested`. */
    follow: keep,
    /** A cut is about to be drawn: what the last image drew but no longer asks for leaves `keep`,
     *  the pages whose window ended are released, and, over the budget, the released ones leave;
     *  returns the pages evicted. */
    trim() {
      frame++;
      exhausted = false;
      arrivals.clear();
      keep(asked, []);
      lastUse.release(frame, released);
      return shed(none);
    },
    /** Keys in use, what the residency's tables are sized by. */
    get keyCount() {
      return keys.size;
    },
  };
}
