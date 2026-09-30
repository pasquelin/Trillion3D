import { MAX_SHADOW_SLICES } from '../../../../sdk-core/src/index.ts';
import { writeFace } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import type { ShadowPlan } from '../../../../sdk-core/src/scene/light-shadow/plan.ts';
import { FRESH_SLICE_FLOATS } from './freshLayout.ts';

// What the GPU pages' pass (`freshPass.ts`) reads from the host each frame: the lamps' slices, and
// whether the frame has anything new to draw.

/** Each slice's emitter and far plane, rewritten each frame: a frame allocates nothing. */
const slices = new Float32Array(MAX_SHADOW_SLICES * FRESH_SLICE_FLOATS),
  faceScratch = new Float32Array(16);

/** Each lamp's centre, envelope radius and far plane at its slice, as its pages' faces and cones
 *  carry them (`writePage`, `writeFace`); a sun's are zero. */
export function freshSlices(store: SceneLightStore) {
  slices.fill(0);
  for (let slot = 0; slot < store.count; slot++) {
    const slice = store.sliceOf(slot),
      light = slice >= 0 ? store.light(store.ids[slot]) : undefined;
    if (!light || light.kind === 'directional') continue;
    const at = slice * FRESH_SLICE_FLOATS;
    slices.set(light.position!, at);
    slices[at + 3] = light.emitterRadius ?? 0;
    slices[at + 4] = writeFace(faceScratch, 0, null, 0, light, 0).far;
  }
  return slices;
}

/**
 * Whether this frame may hand the GPU a page to draw: the view or anything in the world moved — a
 * caster's own surface asks new pages as it moves — (`gpu.moved`), a light was added, set or
 * removed (light `epoch`), the host took `lost` pages' depth away (`allocation.lost`), or the
 * latest snapshot's frame listed pages (`gpu.listed`) — a frame at rest runs while it does
 * (`shadowsUnsettled`). Otherwise the frame asks for the pages the last one did, which are drawn,
 * and runs none of the GPU's page work.
 */
export function freshWanted(plan: ShadowPlan, epoch: number, lost: number) {
  const held = epochs.get(plan);
  epochs.set(plan, epoch);
  return plan.gpu.moved || held !== epoch || plan.gpu.listed > 0 || lost > 0;
}
const epochs = new WeakMap<object, number>();
