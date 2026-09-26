import type { PageRec } from '../../page/selection/selection.ts';
import { evictOldest } from '../../streaming/evictOldest.ts';
import { createLastUse } from '../../residency/lastUse.ts';
import { createPageKeys } from './pageKeys.ts';
import { grown } from '../../page/cut/sparseInts.ts';

/** Frames a page stays held once the image stopped keeping it: the WebGL2 image is drawn from the
 *  cut just taken on the CPU, no frame in flight reads a page the next cut no longer holds. */
const IDLE_WINDOW = 1;

/**
 * The pages the WebGL2 geometry pool holds (`pool.ts`), by the engine's one residency
 * (`../../residency/lastUse.ts`), fed as WebGPU feeds it; only released pages enter the order, and
 * leave it by last use once over `limit` (docs/ENGINE.md, the WebGL2 pool).
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
  // Resident pages above the root cover; the released ones by last use; arrivals since the cut.
  const resident = new Set<string>(),
    order = new Set<string>(),
    arrivals = new Set<string>();
  // The stamp of the `keep` that last named each key; its list, the previous one's, and who left.
  let marks = new Int32Array(64),
    stamp = 1,
    kept: PageRec[] = [],
    entering: PageRec[] = [],
    leaving: PageRec[] = [],
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
      if (key >= marks.length) marks = grown(marks, key + 1, marks.length);
      if (marks[key] === stamp) continue;
      if (marks[key] !== previous) {
        // Kept again: it is held, out of the order.
        order.delete(rec.url);
        lastUse.use(key, rec);
      }
      marks[key] = stamp;
      entering.push(rec);
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
    leaving.length = 0;
    for (const rec of kept)
      if (marks[keys.keyOf(rec)] !== stamp) {
        leaving.push(rec);
        finest = Math.min(finest, rec.level ?? 0);
      }
    for (let i = leaving.length - 1; i >= 0; i--) {
      const rec = leaving[i],
        key = keys.keyOf(rec);
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
  const isArrival = (url: string) => arrivals.has(url);
  /** Evicts released pages oldest first while over the budget, but those `spared`; when they do
   *  not suffice, the pages missing are released early, as WebGPU gives way under pressure. */
  const shed = (spared: (url: string) => boolean = isArrival) => {
    // What nothing may evict only raises the bar: under the pool it is not even read.
    if (exhausted || state.allocationBytes <= limit()) return 0;
    floorBytes = env.floorBytes();
    if (!over()) return 0;
    let evicted = evictOldest(order, over, spared, evictOne);
    const bar = Math.max(limit(), floorBytes),
      slot = env.pageBytes();
    while (over()) {
      const before = order.size;
      lastUse.release(frame, released, Math.ceil((state.allocationBytes - bar) / slot));
      if (order.size === before) break;
      evicted += evictOldest(order, over, spared, evictOne);
    }
    exhausted = over();
    return evicted;
  };
  return {
    /** Between two cuts — a budget set mid-session —: what the image drew and what arrived stay. */
    shedBetweenCuts: () => shed(),
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
      shed();
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
      return shed(() => false);
    },
    get keyCount() {
      return keys.size;
    },
  };
}
