import type { SceneLightStore } from '../light/store.ts';
import { createShadowCounts } from './counts.ts';
import { createShadowAdmission } from './admit.ts';
import { createShadowTable } from './table.ts';
import { createShadowPool } from './pool.ts';
import { createSunLevels } from './sunLevels.ts';
import { createShadowRecords } from './records.ts';
import { createShadowViews } from './viewState.ts';
import { createViewSlices } from './viewSlices.ts';
import { createShadowMirror } from './mirror.ts';
import { createShadowThresholds } from './thresholds.ts';
import { shadowTableEntries } from './virtual.ts';
/** Shared resources and the currently selected view; created once for the shadow scheduler. */
export function createShadowPlanning(poolSide: number, layers: number, sunWindow: number) {
  const pool = createShadowPool(poolSide, layers, shadowTableEntries(sunWindow)),
    table = createShadowTable(pool.pages, sunWindow),
    sun = createSunLevels(sunWindow),
    records = createShadowRecords(table, pool, sun),
    counts = createShadowCounts(),
    thresholds = createShadowThresholds(pool),
    posed = new Int32Array(records.taken.length),
    spent = { requestsMs: NaN, admissionMs: NaN },
    views = createShadowViews(pool, table, records, sun, counts),
    slices = createViewSlices(records);
  const state = views.get(undefined);
  const shared = {
    pool,
    table,
    sun,
    records,
    counts,
    thresholds,
    posed,
    spent,
    views,
    slices,
    state,
    viewKey: undefined as unknown,
    budgetBox: new Int32Array(4),
    lightsState: { records, counts, sun, posed, invalidate: state.invalidate },
    gpu: createShadowMirror(table, pool, records, sun),
    admission: createShadowAdmission(pool.pages),
    byPage: true,
    stamp(store: SceneLightStore) {
      return table.version + shared.state.views + store.contentEpoch;
    },
  };
  return shared;
}
