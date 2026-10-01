// #991: a frame counts why each page it staled turned stale — its light, a still caster, moving
// casters alone, a change of detail, moving casters' too —, and the reasons add up to the pages it
// staled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { STALE_BY } from './counts.ts';
import type { ShadowPlan } from './plan.ts';
import { planFrame, settledSun } from './lightShadow.fixture.ts';

const BOX_MIN = [-1e3, 0, -1e3],
  BOX_MAX = [1e3, 2, 1e3];

type Store = ReturnType<typeof createSceneLightStore>;

test('each page a frame stales counts under its reason, and the reasons add up', () => {
  const cases: [keyof typeof STALE_BY, (plan: ShadowPlan, store: Store) => void][] = [
    ['caster', (plan) => plan.worldChanged(BOX_MIN, BOX_MAX)],
    ['moving', (plan) => plan.worldChanged(BOX_MIN, BOX_MAX, true)],
    ['detail', (plan) => plan.representationChanged(BOX_MIN, BOX_MAX)],
    // #831: moving casters' change of detail is detail, never taken for a move of theirs.
    ['detail', (plan) => plan.residencyChanged(BOX_MIN, BOX_MAX, true)],
    ['light', (_, store) => store.set('sun', { direction: [Math.sin(0.1), -Math.cos(0.1), 0] })],
  ];
  for (const [reason, act] of cases) {
    const { store, plan, frame } = settledSun();
    act(plan, store);
    planFrame(plan, store, frame);
    const by = Array.from(plan.counts.staledBy);
    assert.ok(by[STALE_BY[reason]] > 0, `${reason}: pages staled`);
    assert.equal(by[STALE_BY[reason]], plan.counts.invalidatedPages, `${reason} alone: ${by}`);
  }
});
