// #525: the light cut's drops, the pages they send back and its view limit reach the frame metrics
// through `redrawShortPages`, the path that draws those pages again — no second tally beside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { redrawsWith, WHOLE } from '../../gpu/dag/lightCutRedraws.fixture.ts';
import { COARSER_VIEWS, WORK_DROPPED } from '../../gpu/dag/shader/viewsWgsl.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { lightCutMetrics, redrawShortPages } from './casters.ts';

/** A runtime whose light cut reads `flag.value` for every batch, over a pool whose page 9 has no
 *  owner; returns it with the pages withdrawn. */
function runtime(flag: { value: number }) {
  const { redraws, encoder } = redrawsWith(flag);
  const lights = createWebgpuLightState(32),
    withdrawn: number[] = [];
  const pool = {
    owner: Array.from({ length: 16 }, (_, page) => (page === 9 ? -1 : 0)),
    stale() {},
    withdraw: (_: unknown, page: number) => withdrawn.push(page),
  };
  Object.assign(lights, { lightCut: { redraws }, plan: { resting: false, table: {}, pool } });
  const rt = { lights, diag: { engineDiagnostic() {} } } as unknown as WebgpuPagesRuntime;
  /** One frame of one batch of `pages` in views 0 and 1, read, then its short pages redrawn. */
  const frame = async (pages: number[], reported = true) => {
    const settle = redraws.encode(encoder, pages, [0, 1], pages.length, WHOLE);
    redraws.reported(reported);
    settle?.(true);
    await redraws.settled();
    redrawShortPages(rt, 1, 0, false);
  };
  return { rt, frame, withdrawn };
}

test('the frame metrics count the drops and the pages they send back, withdrawn', async () => {
  const flag = { value: WORK_DROPPED };
  const { rt, frame, withdrawn } = runtime(flag);
  await frame([3, 4]);
  await frame([5, 9]);
  assert.deepEqual(withdrawn, [3, 4, 5], 'a page without an owner is not drawn again');
  assert.deepEqual(lightCutMetrics(rt), {
    shadowCutDrops: 2,
    shadowCutWithdrawnPages: 3,
    shadowCutCoarsePages: 0,
    shadowCutViewLimit: 1,
  });
});

test('the frame metrics count the coarser pages apart, never as drops', async () => {
  const flag = { value: (1 << COARSER_VIEWS) >>> 0 };
  const { rt, frame, withdrawn } = runtime(flag);
  await frame([6, 7], false);
  assert.deepEqual(withdrawn, [], 'coarser pages stay read');
  const metrics = lightCutMetrics(rt);
  assert.equal(metrics.shadowCutDrops, 0);
  assert.equal(metrics.shadowCutWithdrawnPages, 0);
  assert.equal(metrics.shadowCutCoarsePages, 1, 'only view 0 drew coarser');
  assert.equal(metrics.shadowCutViewLimit, 24);
});

test('the light-cut metrics are null without a light cut', () => {
  const rt = { lights: createWebgpuLightState(32) } as unknown as WebgpuPagesRuntime;
  assert.deepEqual(lightCutMetrics(rt), {
    shadowCutDrops: null,
    shadowCutWithdrawnPages: null,
    shadowCutCoarsePages: null,
    shadowCutViewLimit: null,
  });
});
