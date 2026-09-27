import { MAX_SHADOW_REGIONS as R } from '../../gpu/shadow/atlas.ts';
import { REGION_RESTORE, REGION_STATIC, type ShadowRegionList } from './regions.ts';

/**
 * A batch's render passes: its regions in pass order — what the page quads read —, the passes that
 * fill the static layer, all before the pool's, and per pass its layer, its first region in that
 * order and how many of them start cleared, then restored. Allocated once.
 */
export const pagePlan = {
  order: new Uint32Array(R),
  passes: 0,
  layerPasses: 0,
  layer: new Int32Array(R),
  first: new Int32Array(R),
  clears: new Int32Array(R),
  restores: new Int32Array(R),
};

/** Where a region falls: the static layer's passes first, then the pool's, each by layer — the
 *  key without its lowest bit is the pass —, and in a pass the clears before the restores. */
const passKey = (regions: ShadowRegionList, region: number) => {
  const start = regions.startOf(region);
  return (
    (start === REGION_STATIC ? 0 : 1 << 24) +
    regions.layer(region) * 2 +
    (start === REGION_RESTORE ? 1 : 0)
  );
};
const keys = new Int32Array(R);

/** Plans the `count` regions of a batch into its render passes (`pagePlan`). */
export function planPagePasses(regions: ShadowRegionList, count: number) {
  const { order, layer, first, clears, restores } = pagePlan;
  // Insertion sort, stable: a batch holds a few dozen regions, and nothing is allocated.
  for (let region = 0; region < count; region++) {
    const key = (keys[region] = passKey(regions, region));
    let at = region;
    for (; at > 0 && keys[order[at - 1]] > key; at--) order[at] = order[at - 1];
    order[at] = region;
  }
  let k = -1,
    pass = -1;
  pagePlan.layerPasses = 0;
  for (let at = 0; at < count; at++) {
    const key = keys[order[at]];
    if (key >> 1 !== pass) {
      pass = key >> 1;
      layer[++k] = (key & 0xffffff) >> 1;
      if (key < 1 << 24) pagePlan.layerPasses++;
      first[k] = at;
      clears[k] = restores[k] = 0;
    }
    if (key & 1) restores[k]++;
    else clears[k]++;
  }
  pagePlan.passes = k + 1;
}
