import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { BackendDiagnostic } from '../types.ts';
import { drawGeometryPool } from './poolDraw.ts';
import type { GeometryPool, PoolClamp } from '../../residency/pools.ts';
import {
  coverageBudgetEvent,
  sendCoverageBudget,
  sendEngineDiagnostic,
} from '../../diagnostic/engineDiagnostic.ts';
import { createResidentOrder } from './poolOrder.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { WebglViewState } from './views.ts';
import { createUnionFit, type Ranked } from './poolUnion.ts';
import { halvedPool, outOfMemoryContext } from '../../residency/outOfMemory.ts';

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
  /** The pages each page depends on (`../../residency/pageParents.ts`). */
  parentsOf: (rec: PageRec) => readonly PageRec[];
  /** Gives a page's geometry back; a held page is never named. */
  drop: (url: string) => void;
  /** The views not drawn now (`views.ts`): what they ask for and draw joins the drawn view's, the
   *  union under the one budget. None when the backend has one view. */
  others?: readonly Pick<WebglViewState, 'requested' | 'shown'>[];
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
 * (`../../page/cut/rule.ts`).
 *
 * The bytes bound what stays resident, as the slots do, by the engine's one residency — last use,
 * parents after their children (`poolOrder.ts`). Under the budget nothing is evicted: an arrival
 * costs a few set operations, an image a walk of what it asks for and draws, by integer keys.
 */
export function createGeometryBudget(env: PoolEnvironment) {
  const { rootUrls, copies, state, parentsOf, drop, floorBytes, onDiagnostic } = env,
    others = env.others ?? [];
  const drawn = drawGeometryPool(env),
    current = drawn.current,
    shares = drawn.shares;
  let limited = false,
    event: Record<string, unknown> | undefined;
  // What the pool may hold above its slots: only what nothing may evict.
  const resident = createResidentOrder({
    state,
    parentsOf,
    drop,
    limit: () => current().allocatedBytes,
    pageBytes: () => current().pageBytes,
    floorBytes,
    others,
  });
  let used = 0,
    room = 0;
  const union = createUnionFit(shares, others);
  /** Charges `requested` in its order, the root cover held beforehand, against the slots it leaves;
   *  returns how many fit. Sets `used` and `room`, never the verdict. With other views, what they
   *  ask for joins it in one ranking under the same slots (`poolUnion.ts`). */
  const fit = (requested: readonly Ranked[]) => {
    const { slots, clamp } = current();
    room = clamp === 'scene' ? Infinity : slots;
    used = copies.root();
    if (others.length) {
      const admitted = union.fit(requested, room, used);
      used = union.used;
      return admitted;
    }
    // One view: the admission as it was before views, kept apart from the union's walk.
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
    admit(requested: readonly Ranked[], pixelError: number) {
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
    follow: resident.follow,
    trim: resident.trim,
    /** Keys the residency holds: its tables follow the view (`poolOrder.ts`). */
    get keyCount() {
      return resident.keyCount;
    },
    /** Another budget, mid-session, under the session ceiling; returns the pages evicted at once.
     *  An invalid budget is refused before anything changes. */
    resize(budgetBytes: number) {
      drawn.resize(budgetBytes);
      return resident.shed();
    },
    /**
     * The context refused a geometry allocation (`../../webgl/core/allocation.ts`): the pool is
     * drawn again at half the bytes it holds, by the rule WebGPU's refusal follows
     * (`halvedPool`), and the residency lets the finest pages go one DAG level per image, never a
     * hole. Published as `gpu-out-of-memory`; false at the floor, where half draws no smaller pool.
     */
    outOfMemory() {
      const before = current(),
        smaller = halvedPool(before, drawn.drawFor);
      if (smaller) drawn.adopt(smaller);
      const refused = outOfMemoryContext('geometry', before.allocatedBytes, smaller);
      sendEngineDiagnostic(onDiagnostic, 'gpu-out-of-memory', 'WebGL2 refused geometry', refused);
      if (smaller) resident.shed();
      return !!smaller;
    },
  };
}
