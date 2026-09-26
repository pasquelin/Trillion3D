import type { PageRec } from '../../page/selection/selection.ts';
import { evictOldest } from '../../streaming/evictOldest.ts';
import { createLastUse } from '../../residency/lastUse.ts';

/** The WebGL2 pages as the shared residency reads them: an integer per URL, and back, and the pages
 *  a page depends on (`../../residency/pageParents.ts`). */
export type PageKeys = {
  keyOf: (url: string) => number;
  /** The key of a URL already ranked, without ranking it. */
  find: (url: string) => number | undefined;
  urlOf: (key: number) => string;
  parentsOf: (rec: PageRec) => readonly PageRec[];
};

/** Ranks URLs as the residency first meets them: its tables follow what the image asked for,
 *  never the catalogue. A page's parents are read once, when it first holds them: a removed
 *  instance's records keep a stale `placementIndex` once the placements are laid out again, and
 *  releasing them must give back the very parents they held. */
export function createPageKeys(readParents: PageKeys['parentsOf']): PageKeys {
  const keys = new Map<string, number>(),
    urls: string[] = [],
    parents = new WeakMap<PageRec, readonly PageRec[]>();
  const parentsOf = (rec: PageRec) => {
    let found = parents.get(rec);
    if (!found) parents.set(rec, (found = readParents(rec)));
    return found;
  };
  return {
    keyOf(url) {
      let key = keys.get(url);
      if (key === undefined) keys.set(url, (key = urls.push(url) - 1));
      return key;
    },
    find: (url) => keys.get(url),
    urlOf: (key) => urls[key],
    parentsOf,
  };
}

/** Frames a page stays held once the image stopped asking for it: the WebGL2 image is drawn from
 *  the cut just taken on the CPU, no frame in flight reads a page the next cut no longer holds. */
const IDLE_WINDOW = 1;

/**
 * The pages the WebGL2 geometry pool holds (`pool.ts`), held by the engine's one residency
 * (`../../residency/lastUse.ts`): a page the image asks for is held with its parents, released at
 * the next cut once no longer asked for, and the released ones leave by last use once over `limit`.
 * Between two cuts, what the image drew and every arrival stay. The root cover and the host's pages
 * never enter the order (docs/ENGINE.md, the WebGL2 pool).
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
  // What the image drew, gathered into `drawn` only when an eviction between two cuts reads it.
  let shownList: readonly PageRec[] = [],
    drawnStale = false;
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
    // Gone idle: its last use, where the order now puts it.
    onIdle: (key) => {
      const url = pages.urlOf(key);
      if (order.delete(url)) order.add(url);
    },
  });
  const released = (key: number) => order.has(pages.urlOf(key));
  const held = (url: string) => {
    const key = pages.find(url);
    return key !== undefined && lastUse.holds(key);
  };
  const wasDrawn = (url: string) => {
    if (drawnStale) {
      drawnStale = false;
      drawn.clear();
      for (const rec of shownList) drawn.add(rec.url);
    }
    return drawn.has(url);
  };
  const keptBetweenCuts = (url: string) => arrivals.has(url) || wasDrawn(url) || held(url);
  const over = () => state.allocationBytes > Math.max(limit(), floorBytes);
  const evictOne = (url: string) => {
    order.delete(url);
    drop(url);
  };
  const shed = (kept: (url: string) => boolean = keptBetweenCuts) => {
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
    shed,
    /** A page has arrived, or arrived again: it is the most recent, kept until the next cut. */
    arrived(url: string) {
      order.delete(url);
      order.add(url);
      arrivals.add(url);
      shed();
    },
    /** A page left by another way — the streamer evicted it —, or the host replaced it, which
     *  holds it for good under the floor. */
    left(url: string) {
      order.delete(url);
      arrivals.delete(url);
    },
    /** What the image asks for and what it drew: the pages that joined the request are held, those
     *  that left it start their window. Walks the request, never what is held. */
    follow(requested: readonly PageRec[], shown: readonly PageRec[]) {
      next.clear();
      for (const rec of requested) {
        const key = pages.keyOf(rec.url);
        next.add(key);
        if (!asked.has(key)) lastUse.use(key, rec);
      }
      for (const key of asked) if (!next.has(key)) lastUse.leave(key, frame);
      [asked, next] = [next, asked];
      shownList = shown;
      drawnStale = true;
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
