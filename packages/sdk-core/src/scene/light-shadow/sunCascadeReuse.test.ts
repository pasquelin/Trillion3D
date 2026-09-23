// `cascadeSlide`: a still camera, or a step smaller than a page, keeps the sun cascades; a
// step of whole pages slides the extent and only the entering strip restarts; a step of a
// extent side or more restarts the cascade in full.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { sunCascadeOf } from './sunCascades.ts';
import { pageRowsOf } from './pages.ts';
import type { ShadowViewpoint } from '../light/contracts.ts';
import { VIEW, SUN } from './lightShadow.fixture.ts';

function settle(
  plan: ReturnType<typeof createShadowPlan>,
  store: ReturnType<typeof createSceneLightStore>,
  view: ShadowViewpoint,
) {
  let frame = 0;
  for (; frame < 8; frame++) {
    plan.plan(store, view, frame, frame * 16);
    if (plan.counts.pendingPages === 0) return frame + 1;
  }
  throw new Error(`cascades still pending after ${frame} frames`);
}

test('still camera: after the first capture, no sun page restarts', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24);
  store.add(SUN);
  const next = settle(plan, store, VIEW);
  plan.plan(store, VIEW, next, next * 16);
  assert.equal(plan.counts.pendingPages, 0);
  assert.equal(plan.counts.invalidatedPages, 0);
  assert.equal(plan.counts.reused, 1);
  assert.equal(plan.regions.count, 0);
});

test('a step smaller than a texel of the near cascade stales nothing', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24);
  store.add(SUN);
  const next = settle(plan, store, VIEW);
  const side = plan.slices.side[store.sliceOf(store.slotOf('sun'))];
  const { radius } = sunCascadeOf(VIEW, SUN.direction!, 0, side);
  const texel = (2 * radius) / side;
  const nudged: ShadowViewpoint = {
    ...VIEW,
    position: [VIEW.position[0] + texel * 0.25, VIEW.position[1], VIEW.position[2]],
  };
  plan.plan(store, nudged, next, next * 16);
  assert.equal(plan.counts.invalidatedPages, 0, 'the world extent is the same');
  assert.equal(plan.counts.reused, 1);
});

test('a step of one page along the light plane slides the near cascade: one strip restarts, not the face', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24);
  store.add(SUN);
  const next = settle(plan, store, VIEW);
  const slice = store.sliceOf(store.slotOf('sun'));
  const rows = pageRowsOf(plan.slices.side[slice]);
  const { pageMetres } = sunCascadeOf(VIEW, SUN.direction!, 0, plan.slices.side[slice]);
  // The sun points straight down: the light plane is the ground, `x` one of its axes.
  const moved: ShadowViewpoint = {
    ...VIEW,
    position: [VIEW.position[0] + pageMetres, VIEW.position[1], VIEW.position[2]],
  };
  plan.plan(store, moved, next, next * 16);
  assert.equal(plan.counts.invalidatedPages, rows, 'one column of the near cascade entered');
  assert.equal(plan.regions.pages, rows, 'and it is drawn this frame');
  assert.equal(plan.counts.pendingPages, 0);
  for (let region = 0; region < plan.regions.count; region++)
    assert.equal(plan.regions.faceOf(region), 0, 'the coarser cascades did not move by a page');
});

test('a step of a whole extent side restarts the cascade in full', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24);
  store.add(SUN);
  const next = settle(plan, store, VIEW);
  const slice = store.sliceOf(store.slotOf('sun'));
  const rows = pageRowsOf(plan.slices.side[slice]);
  const { radius } = sunCascadeOf(VIEW, SUN.direction!, 0, plan.slices.side[slice]);
  const moved: ShadowViewpoint = {
    ...VIEW,
    position: [VIEW.position[0] + 2 * radius, VIEW.position[1], VIEW.position[2]],
  };
  plan.plan(store, moved, next, next * 16);
  assert.ok(plan.counts.invalidatedPages >= rows * rows, 'the whole near cascade restarts');
  assert.equal(plan.counts.reused, 0);
});
