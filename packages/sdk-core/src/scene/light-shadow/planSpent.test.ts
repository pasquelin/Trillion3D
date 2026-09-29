// The scheduler times its own two inner steps — reading the request report, admitting pages — so the
// engine's CPU profile can name them (#1207): measured by each plan, unmeasured (`NaN`) before one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowPlan } from './plan.ts';
import { planFrame, report, sunScene } from './lightShadow.fixture.ts';

test('a plan times reading the request report and admitting its pages, never before it runs', () => {
  assert.ok(Number.isNaN(createShadowPlan(32).spent.requestsMs), 'no plan, no duration');
  assert.ok(Number.isNaN(createShadowPlan(32).spent.admissionMs), 'no plan, no duration');
  const { store, plan } = sunScene();
  report(plan, store, 0, []);
  planFrame(plan, store, 1);
  assert.ok(plan.spent.requestsMs >= 0, 'the report read is timed');
  assert.ok(plan.spent.admissionMs >= 0, 'the admission is timed');
});
