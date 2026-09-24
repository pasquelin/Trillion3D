import { createShadowPlan } from '../../../../sdk-core/src/index.ts';
import { shadowPoolSide } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { MAX_SHADOW_PAGES, shadowAtlasBytes } from '../../gpu/shadow/atlas.ts';
import { createShadowRegionList } from './regions.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/**
 * Sizes the shadow pool once, from the screen the first frame draws (`shadowPoolSide`): a world
 * may prepare on a canvas that is not laid out yet — the HTML default of 300 × 150, or the
 * session's default size — and only takes its real drawing buffer at its first frame. Until then
 * no shadow page exists, so the plan and the region list built at creation are replaced whole
 * when the side differs, keeping the host's settings; the atlas texture is created here, and
 * nowhere earlier. A capture's temporary size never sizes the pool: the next frame on the canvas
 * does. The budget is fixed from then on — a later resize does not move it.
 */
export function sizeShadowPool(rt: WebgpuPagesRuntime) {
  const { lights, capture, diag } = rt,
    atlas = lights.shadows;
  if (!atlas || atlas.texture || capture.capturing) return;
  const side = shadowPoolSide(...rt.setup.viewport);
  if (side !== lights.plan.pool.side) {
    const before = lights.plan;
    lights.plan = createShadowPlan(MAX_SHADOW_PAGES, side);
    lights.plan.setBudgetMs(before.budget.budgetMs);
    lights.plan.setPageInvalidation(before.pageInvalidation);
    lights.regions = createShadowRegionList(side);
  }
  atlas.sizePool(side);
  diag.engineDiagnostic('shadow-pool', 'Shadow pool sized from the first frame', {
    version: 1,
    viewport: [...rt.setup.viewport],
    side,
    pages: side * side,
    bytes: shadowAtlasBytes(side),
  });
}
