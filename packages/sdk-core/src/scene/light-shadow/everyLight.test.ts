// No shadow-casting light is dropped for want of page table: a caster past the slices still lights,
// without a shadow, and the frame counts it (#822).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHADOW_SLICES } from '../light/contracts.ts';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { SUN, planFrame } from './lightShadow.fixture.ts';

test('a shadow caster past the slices is kept, unshadowed, and counted', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(32);
  for (let i = 0; i < MAX_SHADOW_SLICES + 3; i++) store.add({ ...SUN, id: `sun${i}` });
  planFrame(plan, store, 0);
  assert.equal(store.count, MAX_SHADOW_SLICES + 3, 'no light refused');
  assert.equal(plan.counts.unslicedCasters, 3);
  for (let slot = MAX_SHADOW_SLICES; slot < store.count; slot++)
    assert.equal(store.sliceOf(slot), -1, `light ${slot} holds no slice`);
});
