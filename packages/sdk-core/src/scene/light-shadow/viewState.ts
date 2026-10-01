import { createViewReport } from './viewReport.ts';
import { MAX_SHADOW_SLICES } from '../light/contracts.ts';
import { createShadowChanges, SHADOW_CHANGE_BOXES } from './changes.ts';
import { createPageInvalidation } from './invalidate.ts';
import type { createShadowCounts } from './counts.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import type { ShadowRecords } from './records.ts';
import type { SunLevels } from './sunLevels.ts';
import { createShadowRequests, type ShadowRequestReport } from './requests.ts';

/** Only camera-dependent scheduling is private; every view shares the table and physical pool. */
export function createShadowViews(
  pool: ShadowPool,
  table: ShadowTable,
  records: ShadowRecords,
  sun: SunLevels,
  counts: ReturnType<typeof createShadowCounts>,
) {
  const make = () => {
    const changes = createShadowChanges(Math.max(pool.pages, SHADOW_CHANGE_BOXES));
    return {
      changes,
      invalidate: createPageInvalidation(pool, table, sun, changes, counts),
      requests: createShadowRequests(table, pool, records, sun),
      lastFrame: -1,
      received: -1,
      keep: createViewReport(),
      resting: false,
      restFrame: -1,
      views: 0,
      settledStamp: -1,
      report: null as ShadowRequestReport | null,
      alive: true,
    };
  };
  const states = new Map<unknown, ReturnType<typeof make>>();
  return {
    states,
    keptFrom(frame: number) {
      if (states.size === 1) return frame;
      let first = frame;
      for (const state of states.values())
        if (state.lastFrame >= 0)
          first = Math.min(first, state.restFrame >= 0 ? state.restFrame : state.lastFrame);
      return first;
    },
    worldChanged(...args: Parameters<ReturnType<typeof make>['changes']['worldChanged']>) {
      for (const view of states.values()) view.changes.worldChanged(...args);
    },
    representationChanged(
      ...args: Parameters<ReturnType<typeof make>['changes']['representationChanged']>
    ) {
      for (const view of states.values()) view.changes.representationChanged(...args);
    },
    room() {
      let room = Infinity;
      for (const view of states.values()) room = Math.min(room, view.changes.room());
      return room;
    },
    get(key: unknown) {
      let state = states.get(key);
      if (!state) {
        if (states.size === MAX_SHADOW_SLICES) throw new RangeError('Too many shadow views');
        state = make();
        states.set(key, state);
      }
      return state;
    },
    remove(key: unknown) {
      const state = states.get(key);
      if (state) state.alive = false;
      states.delete(key);
    },
    reset() {
      for (const state of states.values()) {
        state.changes.reset();
        state.requests.reset();
        state.report = null;
        state.resting = false;
        state.lastFrame = state.restFrame = state.settledStamp = -1;
        state.views = 0;
      }
    },
    resize() {
      for (const state of states.values())
        state.requests = createShadowRequests(table, pool, records, sun, state.requests.counts);
    },
  };
}
