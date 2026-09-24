import { evictOldest } from '../../streaming/evictOldest.ts';

/**
 * The pages the WebGL2 geometry pool holds, oldest first (`pool.ts`). Once they hold more than
 * `limit` — the pool's slots, the page cap and the session ceiling applied —, those no frame keeps
 * leave oldest first (`evictOldest`, the page streamer's order). What the last cut keeps, and every
 * page that arrived since, never leaves: the image shows no hole and a page is not evicted on
 * arrival. When what is kept fills the budget alone, arrivals stay until the next cut decides, and
 * nothing is walked again before it. Only `floorBytes`, what nothing may evict, stays above.
 */
export function createResidentOrder(env: {
  state: { readonly allocationBytes: number };
  kept: () => readonly string[];
  drop: (url: string) => void;
  limit: () => number;
  floorBytes: () => number;
}) {
  const { state, kept, drop } = env;
  // Resident pages, oldest first. Once over the budget, `keep` holds what the last cut keeps and
  // what arrived since; those are moved to the end, so the `candidates` a pass may evict are
  // exactly the front of the order.
  const order = new Set<string>(),
    keep = new Set<string>(),
    arrivals = new Set<string>();
  let keepStale = true,
    candidates = 0,
    floorBytes = 0;
  const over = () => state.allocationBytes > Math.max(env.limit(), floorBytes);
  const refreshKeep = () => {
    keep.clear();
    for (const url of kept()) keep.add(url);
    for (const url of arrivals) keep.add(url);
    let moved = 0;
    for (const url of keep)
      if (order.delete(url)) {
        order.add(url);
        moved++;
      }
    candidates = order.size - moved;
    keepStale = false;
  };
  const forget = (url: string) => {
    if (order.delete(url) && !keepStale && !keep.has(url)) candidates--;
  };
  const evictOne = (url: string) => {
    forget(url);
    drop(url);
  };
  const evictable = () => candidates > 0 && over(),
    isKept = (url: string) => keep.has(url);
  const shed = () => {
    // What nothing may evict only raises the bar: under the pool it is not even read.
    if (state.allocationBytes <= env.limit()) return 0;
    floorBytes = env.floorBytes();
    if (!over()) return 0;
    if (keepStale) refreshKeep();
    return evictOldest(order, evictable, isKept, evictOne);
  };
  return {
    shed,
    /** A page has arrived, or arrived again: it is the most recent, kept until the next cut. */
    arrived(url: string) {
      forget(url);
      order.add(url);
      arrivals.add(url);
      if (!keepStale) keep.add(url);
      shed();
    },
    /** A page left by another way — the streamer evicted it —, or the host replaced it, which
     *  holds it for good under the floor. */
    left(url: string) {
      forget(url);
      keep.delete(url);
      arrivals.delete(url);
    },
    /** A cut was drawn: what it no longer keeps can go, once over the budget; returns the pages
     *  evicted. */
    trim() {
      keepStale = true;
      arrivals.clear();
      return shed();
    },
  };
}
