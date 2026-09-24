import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { BackendDiagnostic } from '../types.ts';
import type { BudgetShare } from '../../page/cut/tally.ts';
import { sessionGeometryPool } from '../../residency/sessionPool.ts';
import type { GeometryPool } from '../../residency/pools.ts';
import { coverageBudgetEvent, sendCoverageBudget } from '../../diagnostic/engineDiagnostic.ts';
import { createResidentOrder } from './poolOrder.ts';

/**
 * The geometry copies a page holds once resident: one per record that owns its geometry — every
 * classic instance clones it — and one for the records rows place, which share it. `generation`
 * moves when an instance adds or removes copies; the other counts follow it.
 */
export type PageCopies = {
  readonly generation: number;
  of(url: string): number;
  /** Copies the root cover holds, and those the whole scene would. */
  root(): number;
  scene(): number;
};

type PoolEnvironment = {
  /** The host's budget, and the most `resize` may ask for; the defaults when it names none. */
  budgetBytes?: number;
  ceilingBytes?: number;
  /** The page ceiling of the display graph, which bounds the slots as it does on WebGPU. */
  maxResidentPages?: number;
  descriptors: ReadonlyMap<string, GeometryPageDescriptor>;
  /** Pages of the root cover, held outside the order and never evicted. */
  rootUrls: ReadonlySet<string>;
  copies: PageCopies;
  /** The share every record of a page names (`BudgetShare`): the cut charges its slots. */
  shares: ReadonlyMap<string, BudgetShare>;
  /** Decoded bytes the pages hold, which the geometry store keeps. */
  state: { readonly allocationBytes: number };
  /** Decoded bytes nothing may evict — the root cover and the pages the host replaced —, read
   *  only once the pages hold more than the pool. */
  floorBytes: () => number;
  /** Pages the image keeps: the root cover, the host's own, the cut drawn and the cut wanted. */
  kept: () => ReadonlySet<string>;
  /** Gives a page's geometry back; a kept page is never named. */
  drop: (url: string) => void;
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
};

/**
 * The WebGL2 geometry pool: the same fixed budget in bytes as the WebGPU pool, drawn by the same
 * rule (`sessionGeometryPool`) — slots of the catalogue's largest decoded page, the root cover
 * always held, the page cap and the session ceiling applied. A slot holds one geometry COPY: a
 * page drawn by three classic instances fills three, since each holds its own (`PageCopies`).
 *
 * The slots bound the cut in the image that draws it: the cut charges the copies of each page it
 * asks for or draws (`BudgetShare`), the root cover held beforehand, and draws coarser until they
 * fit (`selectVisiblePages`'s `pageBudget`). A cut never holds more than the pool, so a smaller
 * budget takes effect in the next image, and a larger one brings the detail back in it.
 *
 * The bytes bound what stays resident, as the slots do (`poolOrder.ts`). Under the budget nothing
 * is walked: an arrival costs two set insertions, an image one comparison of bytes.
 */
export function createGeometryBudget(env: PoolEnvironment) {
  const { rootUrls, copies, shares, state, kept, drop } = env;
  // A page's decoded size is the bytes it holds resident: its indices and its float attributes.
  let pageBytes = 1;
  for (const descriptor of env.descriptors.values())
    pageBytes = Math.max(pageBytes, descriptor.uncompressedBytes);
  // Drawn again when instances change the copies the scene and its root cover hold.
  const drawSession = () =>
    sessionGeometryPool(
      {
        pageBytes,
        uniquePages: copies.scene(),
        rootPages: copies.root(),
        maxResidentPages: env.maxResidentPages,
      },
      env.budgetBytes,
      env.ceilingBytes,
    );
  // The root cover is held before the cut charges anything: its pages charge nothing.
  const weighShares = () => {
    for (const [url, share] of shares) share.slots = rootUrls.has(url) ? 0 : copies.of(url);
  };
  let session = drawSession(),
    pool = session.pool,
    drawnFor = copies.generation;
  weighShares();
  const current = () => {
    if (copies.generation !== drawnFor) {
      drawnFor = copies.generation;
      session = drawSession();
      pool = session.poolFor(pool.budgetBytes);
      weighShares();
    }
    return pool;
  };
  let budgetPixelError = 0,
    limited = false;
  // What the pool may hold above its slots: only what nothing may evict.
  const resident = createResidentOrder({
    state,
    kept,
    drop,
    limit: () => current().allocatedBytes,
    floorBytes: env.floorBytes,
  });
  return {
    /** The pool as drawn from the budget; its `allocatedBytes` is the most it may hold. */
    get held(): GeometryPool {
      return current();
    },
    /** The floor the pool puts under the cut's screen error, 0 when the requested detail fits. */
    get budgetPixelError() {
      return budgetPixelError;
    },
    /** The cut at the requested threshold did not fit the slots. */
    get coverageBudgetLimited() {
      return limited;
    },
    /** The budget the cut about to be drawn must fit: the slots, those the root cover holds, and
     *  none at all when the pool holds the whole scene. */
    bound(cut: { pageBudget: number; pageBudgetHeld: number }) {
      const { slots, clamp } = current();
      cut.pageBudget = clamp === 'scene' ? 0 : slots;
      cut.pageBudgetHeld = copies.root();
    },
    /** Reads the cut drawn for the host's `pixelError`: the threshold it was coarsened to is the
     *  floor, and a verdict that changes is published as `coverage-budget`. */
    settle(pixelError: number, cut: { pixelError: number; requestedSlots: number }) {
      const was = limited;
      limited = cut.pixelError > pixelError;
      budgetPixelError = limited ? cut.pixelError : 0;
      if (limited !== was)
        sendCoverageBudget(
          env.onDiagnostic,
          coverageBudgetEvent(limited, cut.requestedSlots, pool.slots, true, pixelError),
        );
    },
    /** A page has arrived, or arrived again; the root cover is held outside the order. */
    arrived(url: string) {
      if (!rootUrls.has(url)) resident.arrived(url);
    },
    left: resident.left,
    trim: resident.trim,
    /** Another budget, mid-session, under the session ceiling; returns the pages evicted at once.
     *  An invalid budget is refused before anything changes. */
    resize(budgetBytes: number) {
      current();
      pool = session.poolFor(budgetBytes);
      return resident.shed();
    },
  };
}
