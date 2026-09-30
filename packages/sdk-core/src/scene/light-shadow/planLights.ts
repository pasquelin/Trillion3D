import { LIGHT_KIND, lightDirection, type ShadowViewpoint } from '../light/contracts.ts';
import { LIGHT_FIELD, type SceneLightStore } from '../light/store.ts';
import { baseOf } from '../light/fields.ts';
import type { createPageInvalidation } from './invalidate.ts';
import type { createShadowCounts } from './counts.ts';
import { castsShadow } from './casters.ts';
import type { SunLevels } from './sunLevels.ts';
import type { ShadowRecords } from './records.ts';

/** What the plan hands its per-light pass: its records, counts, suns and posed frames. */
export interface PlanLightsState {
  records: ShadowRecords;
  counts: ReturnType<typeof createShadowCounts>;
  sun: SunLevels;
  posed: Int32Array;
  invalidate: ReturnType<typeof createPageInvalidation>;
}

/**
 * The plan's pass over the shadow casters (`plan.ts`): each one holds a slice, fits it, follows its
 * sun, and stales what moved. A caster left without a slice lights unshadowed, and is counted.
 */
export function planLights(
  state: PlanLightsState,
  store: SceneLightStore,
  view: ShadowViewpoint,
  sceneMin: ArrayLike<number>,
  sceneMax: ArrayLike<number>,
  frame: number,
  nowMs: number,
  byPage: boolean,
) {
  const { records, counts, sun, posed, invalidate } = state;
  for (let slot = 0; slot < store.count; slot++) {
    if (!castsShadow(store, slot)) continue;
    const rank = store.packed[baseOf(slot) + LIGHT_FIELD.kind];
    let slice = store.sliceOf(slot);
    if (slice < 0) {
      slice = records.claim();
      // Every slice is held: this light lights unshadowed, and the frame counts it.
      if (slice < 0) {
        counts.unslicedCasters++;
        continue;
      }
      posed[slice] = frame;
    }
    records.fit(slice, rank);
    store.assignSlice(slot, slice);
    const light = store.light(store.ids[slot]);
    if (!light) continue;
    let whole = records.moved(slice, light);
    if (rank === LIGHT_KIND.directional) {
      if (sun.update(slice, lightDirection(light), view, sceneMin, sceneMax, frame)) whole = true;
      records.followSun(slice);
    }
    invalidate(light, slice, whole, byPage, nowMs, frame);
    if (whole) posed[slice] = frame;
  }
}
