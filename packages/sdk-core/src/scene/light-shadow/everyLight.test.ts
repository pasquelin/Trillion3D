// No shadow is dropped for want of page table: every shadow-casting light the contract accepts
// holds a slice and its own range, even when every one of them is a sun, the largest range.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../light/contracts.ts';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { SUN_ENTRIES } from './virtual.ts';
import { SUN, planFrame } from './lightShadow.fixture.ts';

test('every shadow-casting light up to maxLights holds a slice and a table range, suns included', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  for (let i = 0; i < LIGHT_SETTINGS.maxLights; i++) store.add({ ...SUN, id: `sun${i}` });
  planFrame(plan, store, 0);
  const bases = new Set<number>();
  for (let slot = 0; slot < store.count; slot++) {
    const slice = store.sliceOf(slot);
    assert.ok(slice >= 0, `light ${slot} has a slice`);
    const base = plan.table.baseOf(slice);
    assert.ok(base >= 0 && base + SUN_ENTRIES <= plan.table.entries, `light ${slot} has a range`);
    bases.add(base);
  }
  assert.equal(bases.size, LIGHT_SETTINGS.maxLights, 'no two lights share a range');
});
