// `cascadeChanged` : une caméra immobile, ou un pas plus petit qu'un texel, garde les cascades du
// soleil ; dès que la fenêtre monde bouge, la cascade repart entière.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from './sceneLightStore.ts';
import { createShadowPlan } from './sceneLightShadowPlan.ts';
import { sunCascadeOf } from './sceneLightSunCascades.ts';
import type { SceneLight, ShadowViewpoint } from './sceneLightContracts.ts';

const VIEW: ShadowViewpoint = {
  position: [0, 5, 0],
  forward: [0, 0, -1],
  halfFovY: 0.6,
  aspect: 16 / 9,
  near: 0.1,
  far: 200,
};

const SUN: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [0.1, -0.9, 0.4],
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
};

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
  throw new Error(`cascades encore en attente après ${frame} images`);
}

test('caméra immobile : après la première capture, plus aucune page du soleil ne repart', () => {
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

test('un pas plus petit qu’un texel de la cascade proche ne périme rien', () => {
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
  assert.equal(plan.counts.invalidatedPages, 0, 'la fenêtre monde est la même');
  assert.equal(plan.counts.reused, 1);
});

test('un déplacement qui change la fenêtre monde périme la cascade entière, pas une bande', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24);
  store.add(SUN);
  const next = settle(plan, store, VIEW);
  const moved: ShadowViewpoint = {
    ...VIEW,
    position: [VIEW.position[0] + 40, VIEW.position[1], VIEW.position[2] + 40],
  };
  plan.plan(store, moved, next, next * 16);
  assert.ok(plan.counts.invalidatedPages > 0, 'la fenêtre a glissé : des pages repartent');
  assert.equal(plan.counts.reused, 0);
});
