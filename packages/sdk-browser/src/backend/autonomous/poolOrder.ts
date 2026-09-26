import type { PageRec } from '../../page/selection/selection.ts';
import { evictOldest } from '../../streaming/evictOldest.ts';
import { createLastUse } from '../../residency/lastUse.ts';

/** The WebGL2 pages as the shared residency reads them: an integer per URL, and back, and the pages
 *  a page depends on (`../../residency/pageParents.ts`). */
export type PageKeys = {
  keyOf: (url: string) => number;
  urlOf: (key: number) => string;
  parentsOf: (rec: PageRec) => readonly PageRec[];
};

/** Ranks URLs as the residency first meets them: its tables follow what the image asked for,
 *  never the catalogue. */
export function createPageKeys(parentsOf: PageKeys['parentsOf']): PageKeys {
  const keys = new Map<string, number>(),
    urls: string[] = [];
  return {
    keyOf(url) {
      let key = keys.get(url);
      if (key === undefined) keys.set(url, (key = urls.push(url) - 1));
      return key;
    },
    urlOf: (key) => urls[key],
    parentsOf,
  };
}

/** Frames a page stays held once the image stopped asking for it: the WebGL2 image is drawn from
 *  the cut just taken on the CPU, no frame in flight reads a page the next cut no longer holds. */
const IDLE_WINDOW = 1;

/**
 * The pages the WebGL2 geometry pool holds (`pool.ts`), held by the engine's one residency: last
 * use, parents after their children (`../../residency/lastUse.ts`). A page the image asks
 * for is held, and holds its parents: the nearest resident ancestor a refinement draws never leaves
 * under it. A page the image stops asking for is released at the next cut (`IDLE_WINDOW`). The
 * resident pages are ordered by last use — an arrival, or the image that last asked for it —, and
 * once they hold more than `limit` (the pool's slots, the page cap and the session ceiling applied),
 * the released ones leave oldest first (`evictOldest`); over the budget the window gives way first.
 *
 * Between two cuts, what the image drew and every page that arrived since never leaves: the image
 * shows no hole and a page is not evicted on arrival. Just before a cut (`trim`), a page the image
 * drew but no longer holds may leave too: that cut draws its nearest resident ancestor instead. The
 * root cover and the host's pages never enter the order; only `floorBytes`, what nothing may evict,
 * stays above the limit. Each image walks what it asked for and drew, never the root cover.
 */
export function createResidentOrder(env: {
  state: { readonly allocationBytes: number };
  drop: (url: string) => void;
  limit: () => number;
  floorBytes: () => number;
  pages: PageKeys;
}) {
  const { state, drop, limit, pages } = env;
  const order = new Set<string>(),
    arrivals = new Set<string>(),
    drawn = new Set<string>();
  // The keys the last cut asked for, and the next one's, swapped: a frame allocates no set.
  let asked = new Set<number>(),
    next = new Set<number>(),
    frame = 0,
    // A walk found nothing left to evict: nothing is until the next cut.
    exhausted = false,
    floorBytes = 0;
  const lastUse = createLastUse({
    idleWindow: IDLE_WINDOW,
    keyOf: (rec) => pages.keyOf(rec.url),
    parentsOf: pages.parentsOf,
    kept: (key) => asked.has(key),
    onHeld: () => {},
    // Gone idle: its last use, where the order now puts it.
    onIdle: (key) => {
      const url = pages.urlOf(key);
      if (order.delete(url)) order.add(url);
    },
  });
  const released = (key: number) => order.has(pages.urlOf(key));
  const held = (url: string) => lastUse.holds(pages.keyOf(url));
  const keptBetweenCuts = (url: string) => held(url) || arrivals.has(url) || drawn.has(url);
  const over = () => state.allocationBytes > Math.max(limit(), floorBytes);
  const evictOne = (url: string) => {
    order.delete(url);
    drop(url);
  };
  const shed = (kept: (url: string) => boolean) => {
    // What nothing may evict only raises the bar: under the pool it is not even read.
    if (exhausted || state.allocationBytes <= limit()) return 0;
    floorBytes = env.floorBytes();
    if (!over()) return 0;
    lastUse.release(frame, released, Infinity);
    const evicted = evictOldest(order, over, kept, evictOne);
    exhausted = over();
    return evicted;
  };
  return {
    shed: () => shed(keptBetweenCuts),
    /** A page has arrived, or arrived again: it is the most recent, kept until the next cut. */
    arrived(url: string) {
      order.delete(url);
      order.add(url);
      arrivals.add(url);
      shed(keptBetweenCuts);
    },
    /** A page left by another way — the streamer evicted it —, or the host replaced it, which
     *  holds it for good under the floor. */
    left(url: string) {
      order.delete(url);
      arrivals.delete(url);
    },
    /** What the image asks for and what it drew: the pages that joined the request are held, those
     *  that left it start their window. Walks both lists, never what is held. */
    follow(requested: readonly PageRec[], shown: readonly PageRec[]) {
      next.clear();
      for (const rec of requested) next.add(pages.keyOf(rec.url));
      for (const key of asked) if (!next.has(key)) lastUse.leave(key, frame);
      for (const rec of requested) {
        const key = pages.keyOf(rec.url);
        if (!asked.has(key)) lastUse.use(key, rec);
      }
      [asked, next] = [next, asked];
      drawn.clear();
      for (const rec of shown) drawn.add(rec.url);
    },
    /** A cut is about to be drawn: the pages whose window ended are released, and what is not held
     *  can go, once over the budget; returns the pages evicted. */
    trim() {
      frame++;
      exhausted = false;
      arrivals.clear();
      lastUse.release(frame, released);
      return shed(held);
    },
  };
}
