import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { BackendDiagnostic } from '../types.ts';
import { drawGeometryPool } from './poolDraw.ts';
import type { GeometryPool, PoolClamp } from '../../residency/pools.ts';
import { coverageBudgetEvent, sendCoverageBudget } from '../../diagnostic/engineDiagnostic.ts';
import { createResidentOrder } from './poolOrder.ts';

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
  copies: PageCopies;
  /** Moves when an instance, grown rows or a replaced page change what the root cover holds. */
  coverRevision: () => number;
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
 * The slots bound what the image asks for, never the cut: the cut is drawn at the host's threshold,
 * and the pages it asks for are admitted in their order (`./requests.ts`, coarsest first), each
 * charging its copies, the root cover held beforehand, while they fit (`admit`). What does not fit
 * is not asked for: the cut rule draws its nearest resident ancestor instead
 * (`../../page/cut/rule.ts`). A refinement holds more for a while: the resident ancestors drawn in
 * place of missing pages stay beside the pages replacing them, and leave with the cut that follows
 * the last arrival.
 *
 * The bytes bound what stays resident, as the slots do (`poolOrder.ts`). Under the budget nothing
 * is walked: an arrival costs two set insertions, an image one comparison of bytes.
 */
export function createGeometryBudget(env: PoolEnvironment) {
  const { rootUrls, copies, state, kept, drop, floorBytes, onDiagnostic } = env;
  const drawn = drawGeometryPool(env),
    current = drawn.current,
    shares = drawn.shares;
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
  let used = 0,
    room = 0;
  /** Charges `requested` in its order, the root cover held beforehand, against the slots it leaves;
   *  returns how many fit. Sets `used` and `room`, never the verdict. */
  const fit = (requested: readonly { url: string }[]) => {
    const { slots, clamp } = current();
    room = clamp === 'scene' ? Infinity : slots;
    used = copies.root();
    let admitted = requested.length;
    for (let i = 0; i < requested.length; i++) {
      used += shares.get(requested[i].url) ?? 0;
      if (used > room && admitted === requested.length) admitted = i;
    }
    return admitted;
  };
  return {
    /**
     * Admits `requested` in its order while the copies it charges fit the slots the root cover
     * leaves; returns how many are admitted. The verdict — whether all of it fits — moves here and
     * waits for `flush`. `pixelError` is the host's threshold the cut was drawn at.
     */
    admit(requested: readonly { url: string }[], pixelError: number) {
      const admitted = fit(requested);
      if (used > room !== limited) {
        limited = !limited;
        event = coverageBudgetEvent(limited, used, current().slots, true, pixelError);
      }
      return admitted;
    },
    /** How many of `requested` fit the pool as drawn now, the verdict left to the next `admit`. */
    fit,
    /** The pool as drawn from the budget; its `allocatedBytes` is the most it may hold. */
    get held(): GeometryPool {
      return current();
    },
    /** Why the pool does not make the budget: the drawn pool's reason. */
    get clamp(): PoolClamp {
      return current().clamp;
    },
    /** The cut the image asked for did not fit the slots, as of the last admission. */
    get coverageBudgetLimited() {
      return limited;
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
