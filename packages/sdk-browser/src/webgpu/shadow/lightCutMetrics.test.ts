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
  /** One frame of one batch of `pages` in `views`, read, then its short pages redrawn. */
  const frame = async (pages: number[], reported = true, views = [0, 1]) => {
    const settle = redraws.encode(encoder, pages, views, pages.length, WHOLE);
    redraws.reported(reported);
    settle?.(true);
    await redraws.settled();
    redrawShortPages(rt, 1, 0, false);
  };
  return { rt, frame, withdrawn, redraws };
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

// #1142: once the view limit settles, frames that drop nothing withdraw nothing, frame after frame;
// a residency change lets the limit probe, and a probe that drops still withdraws its pages.
test('a settled limit withdraws no page until a drop, after a residency change too', async () => {
  const flag = { value: WORK_DROPPED };
  const { rt, frame, withdrawn, redraws } = runtime(flag);
  await frame([3, 4]);
  flag.value = 0;
  for (let i = 0; i < 50; i++) await frame([3, 4], true, [0, 0]);
  assert.deepEqual(withdrawn, [3, 4], 'settled at one view: flat');
  assert.equal(lightCutMetrics(rt).shadowCutViewLimit, 1);
  redraws.residencyChanged();
  await frame([3, 4], true, [0, 0]);
  assert.equal(lightCutMetrics(rt).shadowCutViewLimit, 2, 'residency moved: it probes');
  flag.value = WORK_DROPPED;
  await frame([5, 6]);
  assert.deepEqual(withdrawn, [3, 4, 5, 6], 'the probe dropped: its pages are withdrawn');
  assert.equal(lightCutMetrics(rt).shadowCutDrops, 2);
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

// #831: a page drawn from a coarse ancestor is drawn again once residency brings what it lacked,
// while the camera moves: a drive no longer shows the coarse triangles in its shadows.
test('a coarser page is drawn again when residency moves, the camera moving', async () => {
  const flag = { value: (1 << COARSER_VIEWS) >>> 0 };
  const { rt, frame } = runtime(flag);
  await frame([6, 7]);
  assert.equal(lightCutMetrics(rt).shadowCutCoarsePages, 0, 'it waits for residency');
  redrawShortPages(rt, 2, 0, false);
  assert.equal(lightCutMetrics(rt).shadowCutCoarsePages, 0, 'a camera that only moves: none');
  redrawShortPages(rt, 3, 0, true);
  assert.equal(lightCutMetrics(rt).shadowCutCoarsePages, 1, 'residency moved: drawn again');
});

// #831: a count per frame, as the reference engine's frame counters and this frame's draw calls are, never a
// running total read beside them.
test('the coarser pages are counted per frame: the next frame counts its own', async () => {
  const flag = { value: (1 << COARSER_VIEWS) >>> 0 };
  const { rt, frame } = runtime(flag);
  await frame([6, 7]);
  redrawShortPages(rt, 2, 0, true);
  assert.equal(lightCutMetrics(rt).shadowCutCoarsePages, 1);
  redrawShortPages(rt, 3, 0, true);
  assert.equal(lightCutMetrics(rt).shadowCutCoarsePages, 0, 'nothing sent back this frame');
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
