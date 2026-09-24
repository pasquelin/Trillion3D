import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { BackendDiagnostic } from '../types.ts';
import type { BudgetShare } from '../../page/cut/tally.ts';
import type { SelectionResult } from '../../page/cut/state.ts';
import { drawGeometryPool } from './poolDraw.ts';
import type { GeometryPool, PoolClamp } from '../../residency/pools.ts';
import {
  coverageBudgetEvent,
  sendCoverageBudget,
  sendEngineDiagnostic,
  type EngineDiagnosticEmitter,
} from '../../diagnostic/engineDiagnostic.ts';
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

export type PoolEnvironment = {
  /** The host's budget, and the most `resize` may ask for; the defaults when it names none. */
  budgetBytes?: number;
  ceilingBytes?: number;
  /** The page ceiling of the display graph, which bounds the slots as it does on WebGPU. */
  maxResidentPages?: number;
  descriptors: ReadonlyMap<string, GeometryPageDescriptor>;
  /** Pages of the root cover, held outside the order and never evicted. */
  rootUrls: ReadonlySet<string>;
  /** The largest error the DAG roots carry as parents (`pageBudgetRootError`). */
  rootError: number;
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
 * asks for (`BudgetShare`), the root cover held beforehand, and draws coarser until they fit
 * (`selectVisiblePages`'s `pageBudget`), so a smaller budget takes effect in the image that follows
 * it. A refinement holds more for a while: the resident ancestors drawn in place of missing pages
 * stay beside the pages replacing them, and leave with the cut that follows the last arrival.
 *
 * The threshold is searched from one image to the next (`pageBudgetFrom`, `searchBudget`): one
 * step of √2 finer an image, climbing by √2 in the image that no longer fits, never past the
 * ceiling the DAG roots' error sets (`rootError`). When even the coarsest cut overflows, the
 * threshold stays there and the pool publishes `root-cover` (`clamp`). Until nothing finer is left
 * to try, `settling` asks for another image.
 *
 * The bytes bound what stays resident, as the slots do (`poolOrder.ts`). Under the budget nothing
 * is walked: an arrival costs two set insertions, an image one comparison of bytes.
 */
export function createGeometryBudget(env: PoolEnvironment) {
  const { rootUrls, copies, state, kept, drop } = env;
  const drawn = drawGeometryPool(env),
    current = drawn.current;
  const emit: EngineDiagnosticEmitter = (phase, message, details) =>
    sendEngineDiagnostic(env.onDiagnostic, phase, message, details);
  // The threshold the budget held the last cut at, where the next one starts its search; 0 when
  // the budget did not limit it: the host's own threshold is then tried at once.
  let budgetPixelError = 0,
    limited = false,
    // Even the ceiling's cut overflowed the slots: the pool is limited by the root cover.
    rootCover = false,
    // The host's threshold the last cut was drawn for: a finer one starts the search over.
    hostError = 0,
    settling = false,
    event: Record<string, unknown> | undefined;
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
    /** Why the pool does not make the budget: `root-cover` while even the cut at the search's
     *  ceiling overflows its slots, as on WebGPU; the drawn pool's reason otherwise. */
    get clamp(): PoolClamp {
      return rootCover ? 'root-cover' : current().clamp;
    },
    /** The cut at the requested threshold did not fit the slots, as of the last pass that tried it. */
    get coverageBudgetLimited() {
      return limited;
    },
    /** A finer threshold is left to try: the search owes another image. */
    get settling() {
      return settling;
    },
    /** The budget the cut about to be drawn for the host's `pixelError` must fit: the slots,
     *  those the root cover holds, and none at all when the pool holds the whole scene. The search
     *  starts where the last one ended, or at the host's threshold when the budget did not limit
     *  it or the host asks for finer. */
    bound(cut: {
      pixelError: number;
      pageBudget: number;
      pageBudgetHeld: number;
      pageBudgetFrom: number;
      pageBudgetRootError: number;
    }) {
      const { slots, clamp } = current();
      cut.pageBudget = clamp === 'scene' ? 0 : slots;
      cut.pageBudgetHeld = copies.root();
      cut.pageBudgetFrom = cut.pixelError < hostError ? 0 : budgetPixelError;
      cut.pageBudgetRootError = env.rootError;
    },
    /** Reads the cut drawn for the host's `pixelError`. The verdict moves as soon as a pass has
     *  tried the host's threshold (`hostCutFits`), settled search or not; a change waits for
     *  `flush`. */
    settle(
      pixelError: number,
      cut: Pick<
        SelectionResult<unknown>,
        'pixelError' | 'requiredSlots' | 'budgetSettled' | 'hostCutFits' | 'budgetExceeded'
      >,
    ) {
      hostError = pixelError;
      rootCover = cut.budgetExceeded;
      settling = !cut.budgetSettled;
      budgetPixelError = cut.pixelError > pixelError ? cut.pixelError : 0;
      const fits = cut.hostCutFits;
      if (fits === null || fits !== limited) return;
      limited = !fits;
      event = coverageBudgetEvent(limited, cut.requiredSlots, current().slots, true, pixelError);
    },
    /** Publishes the verdict the last images changed, as `coverage-budget`. */
    flush() {
      if (!event) return;
      sendCoverageBudget(emit, event);
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
      // A larger pool may hold a finer threshold: the search owes an image.
      settling = true;
      return resident.shed();
    },
  };
}
