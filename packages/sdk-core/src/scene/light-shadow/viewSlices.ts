import { LIGHT_KIND, MAX_SHADOW_SLICES } from '../light/contracts.ts';
import type { SceneLightStore } from '../light/store.ts';
import { castsShadow } from './casters.ts';
import type { ShadowRecords } from './records.ts';

/** Sun slices belong to a view and light; lamps share one projection across all views. */
export function createViewSlices(records: ShadowRecords) {
  const lamps = new Map<string, number>(),
    views = new Map<unknown, Map<string, number>>(),
    retained = new Uint8Array(MAX_SHADOW_SLICES),
    active = new Uint8Array(MAX_SHADOW_SLICES);
  let current: Map<string, number>;
  const prune = (map: Map<string, number>, store: SceneLightStore, directional: boolean) => {
    for (const [id, slice] of map) {
      const slot = store.slotOf(id);
      if (
        slot < 0 ||
        !castsShadow(store, slot) ||
        (store.kindOf(slot) === LIGHT_KIND.directional) !== directional
      ) {
        records.free(slice);
        map.delete(id);
      } else retained[slice] = 1;
    }
  };
  return {
    active,
    each(visit: (slice: number, light: string) => void) {
      for (const [id, slice] of lamps) visit(slice, id);
      for (const map of views.values()) for (const [id, slice] of map) visit(slice, id);
    },
    select(key: unknown, store: SceneLightStore) {
      retained.fill(0);
      prune(lamps, store, false);
      for (const map of views.values()) prune(map, store, true);
      current = views.get(key) ?? new Map();
      views.set(key, current);
      for (let slot = 0; slot < store.count; slot++) {
        const map = store.kindOf(slot) === LIGHT_KIND.directional ? current : lamps;
        store.assignSlice(slot, map.get(store.ids[slot]) ?? -1, true);
      }
      records.release(store, retained);
    },
    remember(store: SceneLightStore) {
      active.fill(0);
      for (let slot = 0; slot < store.count; slot++) {
        const slice = store.sliceOf(slot);
        if (slice < 0) continue;
        const map = store.kindOf(slot) === LIGHT_KIND.directional ? current : lamps;
        map.set(store.ids[slot], slice);
        active[slice] = 1;
      }
    },
    remove(key: unknown) {
      const map = views.get(key);
      if (map) for (const slice of map.values()) records.free(slice);
      views.delete(key);
    },
    reset() {
      lamps.clear();
      views.clear();
      active.fill(0);
    },
  };
}
