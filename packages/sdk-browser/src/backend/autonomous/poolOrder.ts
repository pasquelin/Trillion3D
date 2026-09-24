import { evictOldest } from '../../streaming/evictOldest.ts';

/**
 * The pages the WebGL2 geometry pool holds, oldest first (`pool.ts`). Once they hold more than
 * `limit` — the pool's slots, the page cap and the session ceiling applied —, those no image keeps
 * leave oldest first (`evictOldest`, the page streamer's order, which skips the kept ones). What
 * the image keeps, and every page that arrived since, never leaves: the image shows no hole and a
 * page is not evicted on arrival. When what is kept fills the budget alone, arrivals stay until the
 * next cut decides, and nothing is walked again before it. Only `floorBytes`, what nothing may
 * evict, stays above.
 */
export function createResidentOrder(env: {
  state: { readonly allocationBytes: number };
  /** The set the image gathered once (`residency.ts`): read, never rebuilt here. */
  kept: () => ReadonlySet<string>;
  drop: (url: string) => void;
  limit: () => number;
  floorBytes: () => number;
}) {
  const { state, drop, limit } = env;
  // Resident pages, oldest first, and those arrived since the last cut.
  const order = new Set<string>(),
    arrivals = new Set<string>();
  let kept: ReadonlySet<string> = arrivals,
    // A walk found nothing left to evict: nothing is until the next cut.
    exhausted = false,
    floorBytes = 0;
  const isKept = (url: string) => kept.has(url) || arrivals.has(url);
  const over = () => state.allocationBytes > Math.max(limit(), floorBytes);
  const evictOne = (url: string) => {
    order.delete(url);
    drop(url);
  };
  const shed = () => {
    // What nothing may evict only raises the bar: under the pool it is not even read.
    if (exhausted || state.allocationBytes <= limit()) return 0;
    floorBytes = env.floorBytes();
    if (!over()) return 0;
    kept = env.kept();
    const evicted = evictOldest(order, over, isKept, evictOne);
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
    /** A cut was drawn and the image gathered what it keeps: what it no longer keeps can go, once
     *  over the budget; returns the pages evicted. */
    trim() {
      exhausted = false;
      arrivals.clear();
      return shed();
    },
  };
}
