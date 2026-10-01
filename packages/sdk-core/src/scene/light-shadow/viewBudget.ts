import { LIGHT_KIND, MAX_SHADOW_SLICES, type ShadowViewpoint } from '../light/contracts.ts';
import type { SceneLightStore } from '../light/store.ts';
import { castsShadow } from './casters.ts';
import { lampFacesOf } from './virtual.ts';
import type { ShadowPool } from './pool.ts';
import type { SunLevels } from './sunLevels.ts';

/** Refuse a view before it can present an image without the shadows its lights declare. */
export function checkViewBudget(store: SceneLightStore, views: number, pages: number) {
  let suns = 0,
    lamps = 0,
    floors = 0;
  for (let slot = 0; slot < store.count; slot++)
    if (castsShadow(store, slot)) {
      const kind = store.kindOf(slot);
      if (kind === LIGHT_KIND.directional) suns++;
      else {
        lamps++;
        floors += lampFacesOf(kind);
      }
    }
  if (suns * views + lamps > MAX_SHADOW_SLICES)
    throw new RangeError('SHADOW_VIEW_CAPACITY_EXCEEDED');
  if (suns * views + floors > pages) throw new RangeError('SHADOW_VIEW_POOL_EXCEEDED');
}

/** Keep every other live view's mapped pages; admit this view only when its floor can fit. */
export function protectViewPages(
  pool: ShadowPool,
  sun: SunLevels,
  active: Uint8Array,
  store: SceneLightStore,
  view: ShadowViewpoint,
  frame: number,
  box: Int32Array,
) {
  let retained = 0,
    floors = 0;
  for (let page = 0; page < pool.pages; page++)
    if (pool.owner[page] >= 0 && !active[pool.slice[page]]) retained++;
  for (let slot = 0; slot < store.count; slot++) {
    const slice = store.sliceOf(slot);
    if (slice < 0) continue;
    if (store.kindOf(slot) === LIGHT_KIND.directional) {
      sun.floorReach(slice, view, box);
      floors += Math.max(0, box[2] - box[0] + 1) * Math.max(0, box[3] - box[1] + 1);
    } else floors += lampFacesOf(store.kindOf(slot));
  }
  if (retained + floors > pool.pages) throw new RangeError('SHADOW_VIEW_POOL_EXCEEDED');
  for (let page = 0; page < pool.pages; page++)
    if (pool.owner[page] >= 0 && !active[pool.slice[page]]) pool.named[page] = frame;
}
