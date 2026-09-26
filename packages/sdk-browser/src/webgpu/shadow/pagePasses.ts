import { MAX_SHADOW_REGIONS as R } from '../../gpu/shadow/atlas.ts';
import { REGION_RESTORE, REGION_STATIC, type ShadowRegionList } from './regions.ts';

/**
 * A batch's render passes: its regions in pass order — what the page quads read —, and per pass
 * its layer, whether it fills the static layer, its first region in that order and how many of
 * them start cleared, then restored. Allocated once.
 */
export const pagePlan = {
  order: new Uint32Array(R),
  passes: 0,
  layer: new Int32Array(R),
  layered: new Uint8Array(R),
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
  const { order, layer, layered, first, clears, restores } = pagePlan;
  // Insertion sort, stable: a batch holds a few dozen regions, and nothing is allocated.
  for (let region = 0; region < count; region++) {
    const key = (keys[region] = passKey(regions, region));
    let at = region;
    for (; at > 0 && keys[order[at - 1]] > key; at--) order[at] = order[at - 1];
    order[at] = region;
  }
  let k = -1;
  for (let at = 0; at < count; at++) {
    const key = keys[order[at]];
    if (k < 0 || key >> 1 !== keys[order[first[k]]] >> 1) {
      k++;
      layer[k] = (key & 0xffffff) >> 1;
      layered[k] = key < 1 << 24 ? 1 : 0;
      first[k] = at;
      clears[k] = restores[k] = 0;
    }
    if (key & 1) restores[k]++;
    else clears[k]++;
  }
  pagePlan.passes = k + 1;
}
