import { MAX_SHADOW_SLICES, type SceneLight } from '../light/contracts.ts';
import { sameShadowShape } from '../light/equal.ts';
import type { SceneLightStore } from '../light/store.ts';
import { castsShadow } from './casters.ts';
import { tableEntriesOf } from './virtual.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';

/**
 * THE SHADOW SLICES: one per light that casts a shadow — the record the shading reads, the range
 * it holds in the page table, and the pages the pool holds for it.
 *
 * A slice belongs only to a live store light that still casts a shadow. Everything else frees
 * it — a light that stops casting, a light removed from the store, a store emptied — through one
 * scan of the store at the start of each plan: its pages return to the pool and its range to
 * the table. A light whose kind changes gets a range of its new size, and every page it held
 * describes another projection, so they go too. Everything is allocated once.
 */
export function createShadowRecords(table: ShadowTable, pool: ShadowPool, sun: SunLevels) {
  const taken = new Uint8Array(MAX_SHADOW_SLICES),
    kind = new Int32Array(MAX_SHADOW_SLICES).fill(-1),
    /** The light each slice was last planned for, null until its first plan: the store replaces a
     *  light's record on every change, never edits it, so the one kept is the shape drawn. */
    last: (SceneLight | null)[] = new Array(MAX_SHADOW_SLICES).fill(null),
    claimed = new Uint8Array(MAX_SHADOW_SLICES);
  /** Every page of `slice` back to the pool. */
  const dropPages = (slice: number) => {
    for (let page = 0; page < pool.pages; page++)
      if (pool.owner[page] >= 0 && pool.slice[page] === slice) pool.release(table, page);
  };
  const free = (slice: number) => {
    dropPages(slice);
    table.release(slice);
    sun.release(slice);
    taken[slice] = 0;
    kind[slice] = -1;
    last[slice] = null;
  };
  return {
    taken,
    kind,
    /** Slices held by a light: zero when no light casts a shadow. */
    get count() {
      let held = 0;
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++) held += taken[slice];
      return held;
    },
    dropPages,
    free,
    /** The first free slice: there is one per light the store accepts (`MAX_SHADOW_SLICES`). */
    claim() {
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++)
        if (!taken[slice]) {
          taken[slice] = 1;
          kind[slice] = -1;
          last[slice] = null;
          return slice;
        }
      return -1;
    },
    /** Gives `slice` the table range a light of kind `rank` needs, inside its own window. */
    fit(slice: number, rank: number) {
      if (kind[slice] === rank && table.baseOf(slice) >= 0) return;
      dropPages(slice);
      kind[slice] = rank;
      last[slice] = null;
      table.claim(slice, tableEntriesOf(rank));
    },
    /** True when the light is new, or moved or changed shape since its last plan (`sameShadowShape`):
     *  an intensity or a colour is no move. Notes it. */
    moved(slice: number, light: SceneLight) {
      const before = last[slice];
      last[slice] = light;
      return !before || !sameShadowShape(before, light);
    },
    /** Frees every slice no live shadow-casting light holds any more. */
    release(store: SceneLightStore) {
      claimed.fill(0);
      for (let slot = 0; slot < store.count; slot++) {
        const slice = store.sliceOf(slot);
        if (slice < 0) continue;
        if (!castsShadow(store, slot)) store.assignSlice(slot, -1);
        else claimed[slice] = 1;
      }
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++)
        if (taken[slice] && !claimed[slice]) free(slice);
    },
    reset() {
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++) if (taken[slice]) free(slice);
    },
  };
}

export type ShadowRecords = ReturnType<typeof createShadowRecords>;
