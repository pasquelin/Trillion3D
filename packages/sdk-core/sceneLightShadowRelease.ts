import { MAX_SHADOW_SLICES } from './sceneLightContracts.ts';
import { castsShadow } from './sceneLightShadowCasters.ts';
import type { createShadowSliceTable } from './sceneLightShadowSlices.ts';
import type { SceneLightStore } from './sceneLightStore.ts';

type Slices = ReturnType<typeof createShadowSliceTable>;

/**
 * The only path for releasing a shadow slice.
 *
 * A slice belongs only to a **live** store light that still carries a shadow. Everything
 * else releases it: the light that goes to `castsShadow = 0`, and the light that leaves the store —
 * by an isolated removal, by a removal in the middle of the list (the store then moves the last
 * light and its slice with it, which this scan reads as-is), or by emptying the list. One
 * path, hence one behaviour: the slice becomes free again, its waiting pages are
 * forgotten and its atlas cells are released, including when a shadow update was queued
 * for it. Without that, a removed light would take its slice to the grave and the
 * sixty-four slices would end up taken with no light holding one.
 *
 * The scan reads the store, never an event: nothing to unsubscribe, nothing to replay, and a store
 * shared by several engines gives the same verdict to each. Two passes bounded by the same
 * sixty-four entries, with no allocation.
 */
export function createShadowRelease() {
  const claimed = new Uint8Array(MAX_SHADOW_SLICES);
  return (slices: Slices, store: SceneLightStore) => {
    claimed.fill(0);
    for (let slot = 0; slot < store.count; slot++) {
      const slice = store.sliceOf(slot);
      if (slice < 0) continue;
      // The light is there but no longer casts a shadow: it drops its slice here, like a game.
      if (!castsShadow(store, slot)) store.assignSlice(slot, -1);
      else claimed[slice] = 1;
    }
    for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++)
      if (slices.taken[slice] && !claimed[slice]) slices.free(slice);
  };
}
