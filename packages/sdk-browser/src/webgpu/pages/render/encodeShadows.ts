import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { EngineCamera } from '../../../camera/world.ts';
import { recordShadowPlan } from '../../shadow/cpuSteps.ts';
import { planShadowRegions } from './shadowRegions.ts';

/**
 * Plans the image's shadow pages once. The CPU cut plans them before it writes its rows — the
 * light cuts' casters need rows too —, and the direct-lighting pass then reads the same plan.
 * Returns the pages to draw. An unlit view, or a scene without light, plans nothing and leaves no
 * run behind.
 */
export function planImageShadows(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { lights, run } = rt,
    { store } = lights;
  if (!store.count || store.unlit) {
    lights.runs.reset();
    return 0;
  }
  const view = rt.views?.active;
  if (lights.plannedFrame === run.frame && lights.plannedView === view)
    return lights.plan.admission.count;
  lights.packedBatch.frame = -1;
  lights.plannedFrame = run.frame;
  lights.plannedView = view;
  const started = performance.now(),
    count = planShadowRegions(rt, cam, run.frame, started);
  recordShadowPlan(rt, performance.now() - started);
  return count;
}

/**
 * Copies the shadow pages the resolve just asked for, stamped with the plan's state, for the
 * scheduler to read once the image is submitted (`../../shadow/pageRequests.ts`). An image that
 * lit nothing — unlit view, no light, no pool (no light casts a shadow) — asked for nothing and
 * copies nothing.
 */
export function encodeShadowReadback(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { lights, run, timing } = rt,
    { plan, store, pageRequests } = lights;
  if (!pageRequests || !lights.shadows?.texture || !store.count || store.unlit) return;
  const settle = pageRequests.copy(
    encoder,
    run.frame,
    plan.table.layoutEpoch,
    plan.stamp(store),
    plan.receiver(),
    plan.gpu.on,
  );
  if (settle) timing.shadowPageRequests = settle;
}
