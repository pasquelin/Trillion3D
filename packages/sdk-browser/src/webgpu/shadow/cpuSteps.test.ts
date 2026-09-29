// The shadow planning and encoding bounds are named steps of the engine's CPU profile, filed per
// frame into the same row as every other bound, and read `null` — never 0 — when not run (#1207).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCpuStepProfile } from '../../stage/cpuProfile.ts';
import {
  CPU_STEP,
  CPU_STEP_NAMES,
  CPU_STEP_STAGES,
  SHADOW_CPU_STEPS,
} from '../pages/render/cpuStepTable.ts';
import {
  forgetShadowCpuSteps,
  recordShadowEncoding,
  recordShadowPlan,
  shadowCpuMetrics,
} from './cpuSteps.ts';

function frame() {
  const cpuProfile = createCpuStepProfile(CPU_STEP_NAMES);
  const spent = { requestsMs: NaN, admissionMs: NaN };
  const rt = { timing: { cpuProfile }, lights: { plan: { spent } } };
  return { rt, row: cpuProfile.row, spent, cpuProfile };
}

test('the six shadow steps are named bounds of the profile row, deposited on no stage', () => {
  for (const step of SHADOW_CPU_STEPS) {
    assert.equal(CPU_STEP_NAMES[CPU_STEP[step]], step);
    assert.equal(CPU_STEP_STAGES[CPU_STEP[step]], null, `${step} is part of an encode bound`);
  }
});

test('each shadow step is reported per frame, and reads null in a frame that did not run it', () => {
  const { rt, row, spent, cpuProfile } = frame();
  forgetShadowCpuSteps(row);
  assert.deepEqual(Object.values(shadowCpuMetrics(row)), [null, null, null, null, null, null]);
  spent.requestsMs = 0.5;
  spent.admissionMs = 0.25;
  recordShadowPlan(rt, 2);
  recordShadowEncoding(row, 4, 1, 2.5);
  assert.deepEqual(shadowCpuMetrics(row), {
    cpuShadowPlanMs: 1.25,
    cpuShadowRequestsMs: 0.5,
    cpuShadowAdmissionMs: 0.25,
    cpuShadowBatchesMs: 0.5,
    cpuShadowRegionsMs: 1,
    cpuShadowPassesMs: 2.5,
  });
  cpuProfile.record(1, 4);
  assert.equal(cpuProfile.summary()?.steps.shadowPassesMs.p50, 2.5, 'in the published profile');
  forgetShadowCpuSteps(row);
  assert.equal(shadowCpuMetrics(row).cpuShadowPassesMs, null, 'the next frame starts unmeasured');
});

test('a plan that stopped before the scheduler times the plan alone, the rest null', () => {
  const { rt, row, spent } = frame();
  forgetShadowCpuSteps(row);
  spent.requestsMs = 0.5;
  spent.admissionMs = 0.25;
  recordShadowPlan(rt, 1);
  recordShadowPlan(rt, 0.5);
  const metrics = shadowCpuMetrics(row);
  assert.equal(metrics.cpuShadowPlanMs, 0.5);
  assert.equal(metrics.cpuShadowRequestsMs, null, 'a report read once is filed once');
  assert.equal(metrics.cpuShadowAdmissionMs, null);
  assert.equal(metrics.cpuShadowBatchesMs, null, 'no batch encoded');
});
