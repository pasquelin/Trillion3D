import type { ShadowStaleReason } from '../../../../sdk-core/src/contracts/shadowMetrics.ts';
import { STALE_REASONS } from '../../../../sdk-core/src/scene/light-shadow/counts.ts';
import { DRAW_DYNAMIC } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';
import type { ShadowCullCounts } from '../../gpu/shadow/cullCounts.ts';

/**
 * WHAT THE FRAME'S SHADOW PASS DID, APART (#991): host counts of what it encoded, never read on
 * the device nor in a shader. Its batches, and the pool layers their passes drew in; its regions
 * (`regions.ts`); its pages restored from the static layer — their static depth copied, their
 * moving casters alone rasterised — apart from those whose static casters were rasterised again;
 * the copies from the static layer; and its casters' draw calls, static — into the static layer,
 * or every caster of a page drawn whole without one — apart from moving.
 */
export function createShadowWork() {
  /** The pool layers a pass of the frame drew in. */
  const drawn = new Set<number>();
  const work = {
    batches: 0,
    layers: 0,
    regions: 0,
    restoredPages: 0,
    rasterizedPages: 0,
    restoreCopies: 0,
    staticDrawCalls: 0,
    movingDrawCalls: 0,
    /** A new frame: nothing drawn yet. */
    reset() {
      work.batches = work.layers = work.regions = 0;
      work.restoredPages = work.rasterizedPages = work.restoreCopies = 0;
      work.staticDrawCalls = work.movingDrawCalls = 0;
      drawn.clear();
    },
    /** A pass drew in pool layer `layer`: a layer counts once a frame. */
    drewLayer(layer: number) {
      drawn.add(layer);
      work.layers = drawn.size;
    },
    /** A pass drew `draws` caster draw calls over `copies` pages restored from the static layer:
     *  of moving casters alone when it restored any (`pool.drawMode`). */
    drewPass(draws: number, copies: number) {
      if (copies > 0) work.movingDrawCalls += draws;
      else work.staticDrawCalls += draws;
      work.restoreCopies += copies;
    },
    /** A batch landed: its `count` pages, drawn in `modes` (`DRAW_*`). */
    drewBatch(modes: ArrayLike<number>, count: number) {
      work.batches++;
      for (let i = 0; i < count; i++)
        if (modes[i] === DRAW_DYNAMIC) work.restoredPages++;
        else work.rasterizedPages++;
    },
  };
  return work;
}

export type ShadowWork = ReturnType<typeof createShadowWork>;

/** What `shadowWorkMetrics` reads of the light state. */
type WorkSource = {
  shadowWork: ShadowWork;
  plan: { counts: { staledBy: Int32Array } };
  cull?: { counts: { counts(): ShadowCullCounts | undefined } };
};

/** The frame metrics of the frame's shadow work, of the reasons its pages turned stale
 *  (`STALE_BY`) and of the region culls' last sample (`ShadowFrameMetrics`). */
export function shadowWorkMetrics({ shadowWork: work, plan, cull }: WorkSource) {
  const reasons = {} as Record<ShadowStaleReason, number>,
    culled = cull?.counts.counts();
  for (let i = 0; i < STALE_REASONS.length; i++)
    reasons[STALE_REASONS[i]] = plan.counts.staledBy[i];
  return {
    shadowBatches: work.batches,
    shadowLayersDrawn: work.layers,
    shadowPagesRestored: work.restoredPages,
    shadowPagesRasterized: work.rasterizedPages,
    shadowRestoreCopies: work.restoreCopies,
    shadowStaticDrawCalls: work.staticDrawCalls,
    shadowMovingDrawCalls: work.movingDrawCalls,
    shadowMovingCastersKept: culled?.moving ?? null,
    shadowPagesStaledBy: reasons,
  };
}
