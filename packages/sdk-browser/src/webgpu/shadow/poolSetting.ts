import {
  PAGE_INDEX_MASK,
  SUN_WINDOW,
  screenPoolPages,
  shadowPoolShape,
  shadowTableEntries,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shadowAtlasBytes, shadowBufferBytes } from '../../gpu/shadow/sizes.ts';
import { KEPT_ROW_BYTES } from '../../gpu/shadow/keptList.ts';
import { shadowRequestBytes } from './allocLayout.ts';
import { pairRows } from './pairRows.ts';

/** The kept lists the pairs' rows are held in: the cull's, the occlusion test's made with the
 *  static layer, and the raster bins' rows (`pairGrowth.ts`). */
const PAIR_LISTS = 3;

/**
 * GPU bytes the shadows hold for a pool of `layers` of `side²` pages under a sun window of
 * `sunWindow` pages: the buffers beside it and its page table (`shadowBufferBytes`), its depth
 * pages and the static layer that mirrors them, its request and allocation buffers, and the
 * pairs' share of the kept lists (`pairRows`) — every byte `shadowPoolHeld` counts, the
 * transmittance layer of blended casters apart (`transmittanceGrant.ts`).
 */
export function shadowHeldBytes(side: number, layers = 1, sunWindow = SUN_WINDOW) {
  const pages = side * side * layers;
  return (
    shadowBufferBytes(shadowTableEntries(sunWindow)) +
    2 * shadowAtlasBytes(side, layers) +
    shadowRequestBytes(pages, sunWindow) +
    pairRows(pages) * KEPT_ROW_BYTES * PAIR_LISTS
  );
}

/** The screen the setting is read at: the maintainer's, 1 728 × 1 117 CSS pixels at DPR 2. */
const SETTING_SCREEN = [3456, 2234] as const;

/**
 * THE SHADOW POOL'S SETTING, in bytes: the hard cap of everything the shadows hold
 * (`shadowHeldBytes`), as Unreal fixes its physical page pool (`r.Shadow.Virtual.MaxPhysicalPages`)
 * whatever the screen: the bytes of the pool one sun reads over the maintainer's screen
 * (`screenPoolPages`), 2 601 pages, 359 MB. The pages follow from it (`shadowPoolWithin`), never
 * from the display: a wider screen reads the pages past them at the coarser level, as Unreal's
 * pages over budget do, and never grows the pool past its setting (#831).
 */
export const SHADOW_POOL_SETTING_BYTES = (() => {
  const { side, layers } = shadowPoolShape(screenPoolPages(...SETTING_SCREEN));
  return shadowHeldBytes(side, layers);
})();

/** The largest pool whose held bytes (`shadowHeldBytes`) fit `bytes`, in layers of `layerSide`
 *  pages a side; one page at least. */
export function shadowPoolWithin(bytes: number, layerSide?: number, sunWindow = SUN_WINDOW) {
  const shapeOf = (pages: number) => shadowPoolShape(pages, layerSide),
    fits = (pages: number) => {
      const { side, layers } = shapeOf(pages);
      return shadowHeldBytes(side, layers, sunWindow) <= bytes;
    };
  let low = 1,
    high = PAGE_INDEX_MASK + 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid - 1;
  }
  return shapeOf(low);
}
