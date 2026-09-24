// A representation change — level of detail, residency, colour tile — waits for the camera to
// rest before it stales shadow pages; a world change stales them at once. Under a moving camera
// the cut churns every frame, and each churn would restale every page it covers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import type { ShadowViewpoint } from '../light/contracts.ts';
import { VIEW, SUN, cycle, planFrame, sunPages } from './lightShadow.fixture.ts';
import { PAGE_INDEX_MASK, sunPageMetres } from './virtual.ts';

const BOX_MIN = [-1e3, 0, -1e3],
  BOX_MAX = [1e3, 2, 1e3];

/** A sun whose pages around the eye are all mapped and drawn. */
function settled() {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add(SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  const read = () => sunPages(plan, slice, plan.sun.finest[slice] + 6, [[0, 0]]);
  let frame = 1;
  for (; frame < 4; frame++) cycle(plan, store, frame, read);
  assert.equal(plan.counts.pendingPages, 0);
  return { store, plan, frame };
}

/** A view moved by a hair: no extent moves by a page, the cut alone churns. */
const nudged = (step: number): ShadowViewpoint => ({
  ...VIEW,
  position: [VIEW.position[0] + step * 1e-6, VIEW.position[1], VIEW.position[2]],
});

test('a representation change under a moving camera stales nothing until the camera rests', () => {
  const { store, plan, frame } = settled();
  for (let i = 0; i < 4; i++) {
    plan.representationChanged(BOX_MIN, BOX_MAX);
    planFrame(plan, store, frame + i, nudged(i + 1));
    assert.equal(plan.counts.invalidatedPages, 0, `frame ${i}: the change waits`);
    assert.equal(plan.deferredChanges, true);
  }
  // The same view twice: the camera rests, and what changed enters the list.
  planFrame(plan, store, frame + 4, nudged(4));
  assert.ok(plan.counts.invalidatedPages > 0, 'the deferred box stales its pages');
  assert.equal(plan.deferredChanges, false);
});

test('a world change stales its pages at once, camera moving or not', () => {
  const { store, plan, frame } = settled();
  plan.worldChanged(BOX_MIN, BOX_MAX);
  planFrame(plan, store, frame, nudged(1));
  assert.ok(plan.counts.invalidatedPages > 0);
});

test('a representation change under a still camera stales its pages on the next frame', () => {
  const { store, plan, frame } = settled();
  plan.representationChanged(BOX_MIN, BOX_MAX);
  planFrame(plan, store, frame);
  assert.ok(plan.counts.invalidatedPages > 0);
  assert.equal(plan.deferredChanges, false);
});

test('two representation changes apart stale their own pages, never the page between them', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add(SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0),
    level = plan.sun.finest[slice] + 4;
  const read = () =>
    sunPages(plan, slice, level, [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  let frame = 1;
  for (; frame < 4; frame++) cycle(plan, store, frame, read);
  assert.equal(plan.counts.pendingPages, 0);
  // A cluster inside the first page and one inside the third: no caster of the middle one changed.
  const metres = sunPageMetres(level),
    f = slice * 9;
  const right = plan.sun.frame.subarray(f, f + 3),
    up = plan.sun.frame.subarray(f + 3, f + 6);
  const at = (u: number, v: number, h: number) =>
    [0, 1, 2].map((a) => right[a] * u + up[a] * v + h * (a === 1 ? 1 : 0));
  plan.representationChanged(
    at(0.25 * metres, -0.75 * metres, 0),
    at(0.75 * metres, -0.25 * metres, 1),
  );
  plan.representationChanged(
    at(2.25 * metres, -0.75 * metres, 0),
    at(2.75 * metres, -0.25 * metres, 1),
  );
  planFrame(plan, store, frame);
  const stale = read().map(
    (entry) => plan.pool.dirty[plan.table.words[entry] & PAGE_INDEX_MASK] > 0,
  );
  assert.deepEqual(stale, [true, false, true], 'the page between the two changes stays current');
  // The two pages and the floor under both, which covers each change.
  assert.equal(plan.counts.invalidatedPages, 3);
});
