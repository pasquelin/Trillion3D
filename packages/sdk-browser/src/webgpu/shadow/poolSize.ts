import { createShadowPlan } from '../../../../sdk-core/src/index.ts';
import {
  SHADOW_PAGE,
  shadowPoolSide,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { anyCastsShadow } from '../../../../sdk-core/src/scene/light-shadow/casters.ts';
import { MAX_SHADOW_PAGES, shadowAtlasBytes } from '../../gpu/shadow/atlas.ts';
import { grantedShadowPool } from '../residency/poolGrants.ts';
import type { PoolClamp } from '../../residency/pools.ts';
import { createShadowRegionList } from './regions.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** The smallest shadow pool: the side a one-pixel screen asks (`shadowPoolSide`). */
const FLOOR_SIDE = shadowPoolSide(1, 1);

/** The shadow pool `budgetBytes` holds for a screen that asks `wanted` pages a side: the largest
 *  side that fits, never above `wanted`, never below the floor. */
export const shadowPoolFor = (wanted: number) => (budgetBytes: number) => {
  const fits = Math.floor(Math.sqrt(budgetBytes / 4) / SHADOW_PAGE);
  const side = Math.max(Math.min(FLOOR_SIDE, wanted), Math.min(wanted, fits));
  const clamp: PoolClamp = side <= FLOOR_SIDE ? 'minimum' : side < wanted ? 'device-limit' : null;
  return { budgetBytes, side, allocatedBytes: shadowAtlasBytes(side), clamp };
};

/**
 * Sizes the shadow pool once, from the screen the first frame draws (`shadowPoolSide`): a world
 * may prepare on a canvas that is not laid out yet — the HTML default of 300 × 150, or the
 * session's default size — and only takes its real drawing buffer at its first frame. Until then
 * no shadow page exists, so the plan and the region list built at creation are replaced whole
 * when the side differs, keeping the host's settings. A capture's temporary size never sizes the
 * pool: the next frame on the canvas does. The budget is fixed from then on — a later resize does
 * not move it.
 *
 * The atlas texture is allocated under an out-of-memory check, like the geometry and texture pools
 * (`grantedShadowPool`): a pool the device refuses is drawn at half its bytes, down to the smallest
 * screen's side, and said under `gpu-out-of-memory`. Until the device answers, and for good when it
 * refuses even the floor, the frame is drawn whole, without shadows — never lost. A world without a
 * light that casts a shadow sizes nothing: its pool would hold no page. The first frame that has
 * one sizes it, before its plan maps any page.
 */
export function sizeShadowPool(rt: WebgpuPagesRuntime) {
  const { lights, capture, diag, run } = rt,
    atlas = lights.shadows,
    device = rt.gpu.device;
  if (!atlas || !device || atlas.texture || lights.shadowGrant) return;
  if (capture.capturing || !anyCastsShadow(lights.store)) return;
  const viewport = [...rt.setup.viewport],
    wanted = shadowPoolSide(viewport[0], viewport[1]);
  const granting = grantedShadowPool(
    device,
    shadowAtlasBytes(wanted),
    shadowPoolFor(wanted),
    diag.engineDiagnostic,
    (pool) => atlas.makePool(pool.side),
  );
  const grant = { settled: false, done: Promise.resolve() };
  lights.shadowGrant = grant;
  grant.done = granting.then(
    (granted) => {
      if (!granted) return;
      // A session closed, or a device lost, while the device answered keeps nothing.
      if (run.lost || rt.signal.aborted || lights.shadows !== atlas) return granted.made.destroy();
      const { side, clamp } = granted.pool;
      if (side !== lights.plan.pool.side) {
        const before = lights.plan;
        lights.plan = createShadowPlan(MAX_SHADOW_PAGES, side);
        lights.plan.setBudgetMs(before.budget.budgetMs);
        lights.plan.setPageInvalidation(before.pageInvalidation);
        lights.regions = createShadowRegionList(side);
      }
      atlas.sizePool(side, granted.made);
      diag.engineDiagnostic('shadow-pool', 'Shadow pool sized from the first frame', {
        version: 1,
        viewport,
        side,
        pages: side * side,
        bytes: shadowAtlasBytes(side),
        clamp,
      });
      run.gate.resourcesChanged();
    },
    (error: unknown) => {
      if (!run.lost && !rt.signal.aborted) diag.diagnosticFailure('shadow-pool-unavailable', error);
    },
  );
  void grant.done.finally(() => (grant.settled = true));
}
