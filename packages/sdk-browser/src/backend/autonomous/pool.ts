import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { sessionGeometryPool } from '../../webgpu/residency/sessionPool.ts';
import type { GeometryPool } from '../../webgpu/residency/memoryBudgets.ts';
import {
  createPageBudgetLadder,
  releasePassedFloor,
  stepPageBudgetLadder,
} from '../../webgpu/residency/budgetState.ts';
import { evictOldest } from '../../streaming/evictOldest.ts';

type PoolEnvironment = {
  /** The host's budget, and the most `resize` may ask for; the defaults when it names none. */
  budgetBytes?: number;
  ceilingBytes?: number;
  /** The page ceiling of the display graph, which bounds the slots as it does on WebGPU. */
  maxResidentPages?: number;
  descriptors: ReadonlyMap<string, GeometryPageDescriptor>;
  /** Pages of the root cover, which the pool never goes below. */
  rootUrls: ReadonlySet<string>;
  /** Decoded bytes the pages hold, which the geometry store keeps. */
  state: { readonly allocationBytes: number };
  /** Decoded bytes the root cover holds now, read again after `rootsChanged`. */
  rootBytes: () => number;
  /** Pages the frame keeps: the root cover, the host's own, the cut drawn and the cut wanted. */
  kept: () => readonly string[];
  /** Gives a page's geometry back; a kept page is never named. */
  drop: (url: string) => void;
};

/**
 * The WebGL2 geometry pool: the same fixed budget in bytes as the WebGPU pool, drawn by the same
 * rule (`sessionGeometryPool`) — slots of the catalogue's largest decoded page, the root cover
 * always held, the page cap and the session ceiling applied.
 *
 * The slots bound the cut by the ladder both engines climb (`stepPageBudgetLadder`): the cut is
 * drawn at the floor the previous images' verdict left (`threshold`), and its distinct pages are
 * weighed against the slots after it (`admit`), so the cut the image asks for fits the pool, not
 * only the one it draws.
 *
 * The bytes bound what stays resident: once the pages hold more than the budget, those no frame
 * keeps leave oldest first (`evictOldest`, the page streamer's order). What the last cut keeps,
 * and every page that arrived since, never leaves: the image shows no hole and a page is not
 * evicted on arrival. When what is kept fills the budget alone, arrivals stay until the next cut
 * decides, and nothing is walked again before it.
 *
 * Under the budget nothing is walked: an arrival costs two set insertions, an image one comparison
 * of bytes and one of counts.
 */
export function createGeometryBudget(env: PoolEnvironment) {
  const { descriptors, rootUrls, state, kept, drop } = env;
  // A page's decoded size is the bytes it holds resident: its indices and its float attributes.
  let pageBytes = 1;
  for (const descriptor of descriptors.values())
    pageBytes = Math.max(pageBytes, descriptor.uncompressedBytes);
  const session = sessionGeometryPool(
    {
      pageBytes,
      uniquePages: descriptors.size,
      rootPages: rootUrls.size,
      maxResidentPages: env.maxResidentPages,
    },
    env.budgetBytes,
    env.ceilingBytes,
  );
  let pool = session.pool;
  const ladder = createPageBudgetLadder();
  // Distinct pages of a cut, counted only when the ladder has something to weigh.
  const counted = new Set<string>();
  // Resident pages, oldest first. Once over the budget, `keep` holds what the last cut keeps and
  // what arrived since; those are moved to the end, so the `candidates` a pass may evict are
  // exactly the front of the order.
  const order = new Set<string>(),
    keep = new Set<string>(),
    arrivals = new Set<string>();
  let keepStale = true,
    candidates = 0,
    rootBytes = 0,
    rootsStale = true;
  const over = () => state.allocationBytes > Math.max(pool.budgetBytes, rootBytes);
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
    // The root cover only raises the bar: under the budget it is not even read.
    if (state.allocationBytes <= pool.budgetBytes) return 0;
    if (rootsStale) {
      rootBytes = env.rootBytes();
      rootsStale = false;
    }
    if (!over()) return 0;
    if (keepStale) refreshKeep();
    return evictOldest(order, evictable, isKept, evictOne);
  };
  return {
    /** The pool as drawn from the budget; its `allocatedBytes` is the most it may hold. */
    get held(): GeometryPool {
      return pool;
    },
    /** The floor the pool puts under the cut's screen error, 0 when the requested detail fits. */
    get budgetPixelError() {
      return ladder.budgetPixelError;
    },
    /** The last cut weighed did not fit the slots. */
    get coverageBudgetLimited() {
      return ladder.coverageBudgetLimited;
    },
    /** The threshold this image's cut is drawn at: the host's, or the floor the pool imposes. */
    threshold(pixelError: number) {
      releasePassedFloor(ladder, pixelError);
      return Math.max(pixelError, ladder.budgetPixelError);
    },
    /**
     * Weighs the cut just drawn at `sampled`: the distinct pages it asks for, with the root cover,
     * and those it holds, with what it still draws. True when the floor moved, so that the next
     * image cuts again. Nothing is counted while no floor rules and the records, even all distinct,
     * fit the slots.
     */
    admit(
      pixelError: number,
      sampled: number,
      view: number,
      wanted: readonly PageRec[],
      shown: readonly PageRec[],
    ) {
      const floor = ladder.budgetPixelError,
        { slots } = pool;
      if (
        floor === 0 &&
        !ladder.coverageBudgetLimited &&
        (pool.clamp === 'scene' || rootUrls.size + wanted.length + shown.length <= slots)
      )
        return false;
      counted.clear();
      for (const url of rootUrls) counted.add(url);
      for (let i = 0; i < wanted.length; i++) counted.add(wanted[i].url);
      const requested = counted.size;
      for (let i = 0; i < shown.length; i++) counted.add(shown[i].url);
      stepPageBudgetLadder(ladder, pixelError, sampled, view, slots, requested, counted.size);
      return ladder.budgetPixelError !== floor;
    },
    /** The root cover changed — instances, rows, a replaced page: its bytes are read again. */
    rootsChanged() {
      rootsStale = true;
    },
    /** A page has arrived, or arrived again: it is the most recent, kept until the next cut. */
    arrived(url: string) {
      forget(url);
      order.add(url);
      arrivals.add(url);
      if (!keepStale) keep.add(url);
      shed();
    },
    /** A page left by another way — the streamer evicted it. */
    left(url: string) {
      forget(url);
      arrivals.delete(url);
    },
    /** A cut was drawn: what it no longer keeps can go, once over the budget; returns the pages
     *  evicted. */
    trim() {
      keepStale = true;
      arrivals.clear();
      return shed();
    },
    /** Another budget, mid-session, under the session ceiling; returns the pages evicted at once.
     *  An invalid budget is refused before anything changes. */
    resize(budgetBytes: number) {
      pool = session.poolFor(budgetBytes);
      return shed();
    },
  };
}
