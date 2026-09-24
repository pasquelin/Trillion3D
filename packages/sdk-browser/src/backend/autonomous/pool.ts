import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { BackendDiagnostic } from '../types.ts';
import { sessionGeometryPool } from '../../residency/sessionPool.ts';
import type { GeometryPool } from '../../residency/pools.ts';
import {
  coverageBudgetEvent,
  createPageBudgetLadder,
  releasePassedFloor,
  stepPageBudgetLadder,
} from '../../residency/pageBudgetLadder.ts';
import { sendCoverageBudget } from '../../diagnostic/engineDiagnostic.ts';
import { createResidentOrder } from './poolOrder.ts';

/**
 * The geometry copies a page holds once resident: one per record that owns its geometry — every
 * classic instance clones it — and one for the records rows place, which share it. `generation`
 * moves when an instance adds or removes copies; the other counts follow it.
 */
export type PageCopies = {
  readonly generation: number;
  of(url: string): number;
  /** Copies the root cover holds, those the whole scene would, and the most one page holds. */
  root(): number;
  scene(): number;
  most(): number;
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
  /** Decoded bytes the pages hold, which the geometry store keeps. */
  state: { readonly allocationBytes: number };
  /** Decoded bytes nothing may evict — the root cover and the pages the host replaced —, read
   *  only once the pages hold more than the pool. */
  floorBytes: () => number;
  /** Pages the frame keeps: the root cover, the host's own, the cut drawn and the cut wanted. */
  kept: () => readonly string[];
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
 * The slots bound the cut by the ladder both engines climb (`stepPageBudgetLadder`): the cut is
 * drawn at the floor the previous images' verdict left (`threshold`), and the copies its pages
 * hold are weighed against the slots after it (`admit`), so the cut the image asks for fits the
 * pool, not only the one it draws. While the floor moves, `settling` asks for another image.
 *
 * The bytes bound what stays resident, as the slots do (`poolOrder.ts`). Under the budget nothing
 * is walked: an arrival costs two set insertions, an image one comparison of bytes and one of
 * counts.
 */
export function createGeometryBudget(env: PoolEnvironment) {
  const { rootUrls, copies, state, kept, drop } = env;
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
  let session = drawSession(),
    pool = session.pool,
    drawnFor = copies.generation;
  const current = () => {
    if (copies.generation !== drawnFor) {
      drawnFor = copies.generation;
      session = drawSession();
      pool = session.poolFor(pool.budgetBytes);
    }
    return pool;
  };
  const ladder = createPageBudgetLadder();
  let settling = false;
  // Pages of a cut outside the root cover, counted only when the ladder has something to weigh.
  const counted = new Set<string>();
  const weigh = (url: string) => {
    if (rootUrls.has(url) || counted.has(url)) return 0;
    counted.add(url);
    return copies.of(url);
  };
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
      return ladder.budgetPixelError;
    },
    /** The last cut weighed did not fit the slots. */
    get coverageBudgetLimited() {
      return ladder.coverageBudgetLimited;
    },
    /** The last weighing moved the floor: the view has not settled, another image is owed. */
    get settling() {
      return settling;
    },
    /** The threshold this image's cut is drawn at: the host's, or the floor the pool imposes. */
    threshold(pixelError: number) {
      releasePassedFloor(ladder, pixelError);
      return Math.max(pixelError, ladder.budgetPixelError);
    },
    /**
     * Weighs the cut just drawn at `sampled`: the copies its pages ask for, with the root cover,
     * and those it holds, with what it still draws. True when the floor moved, so that the next
     * image cuts again; a verdict that changes is published as `coverage-budget`. Nothing is
     * counted while no floor rules and the records, each at the most copies a page holds, fit the
     * slots.
     */
    admit(
      pixelError: number,
      sampled: number,
      view: number,
      wanted: readonly PageRec[],
      shown: readonly PageRec[],
    ) {
      const floor = ladder.budgetPixelError,
        limited = ladder.coverageBudgetLimited,
        { slots, clamp } = current(),
        roots = copies.root();
      settling = false;
      if (
        floor === 0 &&
        !limited &&
        (clamp === 'scene' || roots + (wanted.length + shown.length) * copies.most() <= slots)
      )
        return false;
      counted.clear();
      let requested = roots;
      for (let i = 0; i < wanted.length; i++) requested += weigh(wanted[i].url);
      let held = requested;
      for (let i = 0; i < shown.length; i++) held += weigh(shown[i].url);
      stepPageBudgetLadder(ladder, pixelError, sampled, view, slots, requested, held);
      if (ladder.coverageBudgetLimited !== limited)
        sendCoverageBudget(
          env.onDiagnostic,
          coverageBudgetEvent(ladder, requested, slots, true, sampled),
        );
      settling = ladder.budgetPixelError !== floor;
      return settling;
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
