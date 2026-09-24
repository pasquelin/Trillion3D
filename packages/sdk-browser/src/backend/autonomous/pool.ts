import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { BackendDiagnostic } from '../types.ts';
import type { BudgetSearch } from '../../page/cut/cut.ts';
import { drawGeometryPool } from './poolDraw.ts';
import type { GeometryPool, PoolClamp } from '../../residency/pools.ts';
import { coverageBudgetEvent, sendCoverageBudget } from '../../diagnostic/engineDiagnostic.ts';
import { createResidentOrder } from './poolOrder.ts';
import { createPoolSearch } from './poolSearch.ts';

/**
 * The geometry copies a page holds once resident: one per record that owns its geometry — every
 * classic instance clones it — and one for the records rows place, which share it. They change
 * with the root cover's revision (`coverRevision`).
 */
export type PageCopies = {
  of(url: string): number;
  /** Copies the root cover holds, and those the whole scene would. */
  root(): number;
  scene(): number;
};

export type PoolEnvironment = {
  /** The host's budget, and the most `resize` may ask for; the defaults when it names none. */
  budgetBytes?: number;
  ceilingBytes?: number;
  /** The page ceiling of the display graph, which bounds the slots as it does on WebGPU. */
  maxResidentPages?: number;
  descriptors: ReadonlyMap<string, GeometryPageDescriptor>;
  /** Pages of the root cover, held outside the order and never evicted. */
  rootUrls: ReadonlySet<string>;
  /** The largest error the DAG roots carry as parents: the search's ceiling (`poolSearch.ts`). */
  rootError: number;
  copies: PageCopies;
  /** Moves when an instance, grown rows or a replaced page change what the root cover holds. */
  coverRevision: () => number;
  /** Moves when the view does: a pool limited by the root cover is probed again. */
  viewRevision: () => number;
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
 * asks for (`slotsOf`), the root cover held beforehand, and draws coarser until they fit
 * (`search`, `poolSearch.ts`), so a smaller budget takes effect in the image that follows it. A
 * refinement holds more for a while: the resident ancestors drawn in place of missing pages stay
 * beside the pages replacing them, and leave with the cut that follows the last arrival.
 *
 * The bytes bound what stays resident, as the slots do (`poolOrder.ts`). Under the budget nothing
 * is walked: an arrival costs two set insertions, an image one comparison of bytes.
 */
export function createGeometryBudget(env: PoolEnvironment) {
  const { rootUrls, copies, state, kept, drop, floorBytes, rootError, onDiagnostic } = env;
  const drawn = drawGeometryPool(env),
    current = drawn.current;
  const thresholds = createPoolSearch({
    budget: () => {
      const { slots, clamp } = current();
      return clamp === 'scene' ? 0 : slots;
    },
    held: copies.root,
    shares: drawn.shares,
    rootError,
    coverRevision: env.coverRevision,
    viewRevision: env.viewRevision,
  });
  let limited = false,
    event: Record<string, unknown> | undefined;
  // What the pool may hold above its slots: only what nothing may evict.
  const resident = createResidentOrder({
    state,
    kept,
    drop,
    limit: () => current().allocatedBytes,
    floorBytes,
  });
  /** The cut's search under the slots. The verdict moves as soon as a pass tried the host's
   *  threshold, fixed search or not; a change waits for `flush`. */
  const search: BudgetSearch = (pass, floor, cam) => {
    thresholds.search(pass, floor, cam);
    const verdict = thresholds.verdict;
    if (verdict === 'untried' || (verdict === 'over') === limited) return;
    limited = !limited;
    event = coverageBudgetEvent(limited, thresholds.requiredSlots, current().slots, true, floor);
  };
  return {
    search,
    slotsOf: thresholds.slotsOf,
    /** The pool as drawn from the budget; its `allocatedBytes` is the most it may hold. */
    get held(): GeometryPool {
      return current();
    },
    /** The floor the pool puts under the cut's screen error, 0 when the requested detail fits. */
    get budgetPixelError() {
      return thresholds.pixelError;
    },
    /** Why the pool does not make the budget: `root-cover` while even the cut at the search's
     *  ceiling overflows its slots, as on WebGPU; the drawn pool's reason otherwise. */
    get clamp(): PoolClamp {
      return thresholds.rootCover ? 'root-cover' : current().clamp;
    },
    /** The cut at the requested threshold did not fit the slots, as of the last pass that tried it. */
    get coverageBudgetLimited() {
      return limited;
    },
    /** The search owes another image: a finer step is left to try, or the budget changed. */
    get settling() {
      return thresholds.settling;
    },
    /** Publishes the verdict the last images changed, as `coverage-budget`. */
    flush() {
      if (!event) return;
      sendCoverageBudget(onDiagnostic, event);
      event = undefined;
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
      drawn.resize(budgetBytes);
      return resident.shed();
    },
  };
}
