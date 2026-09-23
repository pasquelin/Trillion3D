// Bounds the host samples after the render belong to the image that just drew: the profile row is
// therefore filed only at the end of the image, and only if it was filled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCpuStepProfile } from '../../../stage/cpuProfile.ts';
import { CPU_STEP, CPU_STEP_NAMES, endCpuFrame, hostCpuStep } from './cpuSteps.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** What image close reads, and nothing else: a profile, a flag, an image number. */
function banc() {
  const cpuProfile = createCpuStepProfile(CPU_STEP_NAMES);
  const timing = {
    cpuProfile,
    cpuWindow: createCpuStepProfile(CPU_STEP_NAMES, { row: cpuProfile.row }),
    rowFilled: false,
    stages: undefined,
    cpuSample: undefined,
    lastCpuLogFrame: -1,
    lastCpuLogMs: 0,
  };
  const rt = {
    timing,
    run: { frame: 7 },
    diag: { traceEnabled: false },
  } as unknown as WebgpuPagesRuntime;
  return { rt, timing };
}

test('the four host bounds each have their place in the profile row', () => {
  const { rt, timing } = banc();
  hostCpuStep(rt, 'arrivalsMs', 0.5);
  hostCpuStep(rt, 'pendingMs', 1.25);
  hostCpuStep(rt, 'retainMs', 0.75);
  hostCpuStep(rt, 'submitMs', 2);
  const row = timing.cpuProfile.row;
  assert.equal(row[CPU_STEP.arrivalsMs], 0.5);
  assert.equal(row[CPU_STEP.pendingMs], 1.25);
  assert.equal(row[CPU_STEP.retainMs], 0.75);
  assert.equal(row[CPU_STEP.submitMs], 2);
  assert.equal(
    new Set([
      CPU_STEP.arrivalsMs,
      CPU_STEP.pendingMs,
      CPU_STEP.retainMs,
      CPU_STEP.submitMs,
      CPU_STEP.worldMs,
      CPU_STEP.blendWorldMs,
      CPU_STEP.totalMs,
    ]).size,
    7,
    "no bound writes over another's slot",
  );
});

test('an image that has not filled its row deposits nothing, a filled image deposits it once', () => {
  const { rt, timing } = banc();
  hostCpuStep(rt, 'pendingMs', 1.25);
  endCpuFrame(rt);
  assert.equal(timing.cpuProfile.summary(), null, 'a CPU cut files no row');

  timing.cpuProfile.row[CPU_STEP.worldMs] = 0.5;
  timing.cpuProfile.row[CPU_STEP.totalMs] = 4;
  timing.rowFilled = true;
  endCpuFrame(rt);
  endCpuFrame(rt);
  const resume = timing.cpuProfile.summary();
  assert.equal(resume?.frames, 1, 'the row is filed once, not twice');
  assert.equal(resume?.steps.pendingMs.p50, 1.25, 'the host bound is in the image');
  assert.equal(resume?.steps.worldMs.p50, 0.5);
  assert.equal(resume?.worst[0].frame, 7);
});

test('the host window keeps every filed row until it is read, whatever the publish cadence forgot', () => {
  const { rt, timing } = banc();
  for (const total of [4, 2]) {
    timing.cpuProfile.row[CPU_STEP.totalMs] = total;
    timing.rowFilled = true;
    endCpuFrame(rt);
  }
  assert.equal(timing.cpuProfile.summary()?.frames, 2, 'the publish window reads and forgets');
  assert.equal(timing.cpuWindow.summary()?.frames, 2, 'the host window still holds both images');
  assert.equal(timing.cpuWindow.summary(), null, 'read once, then forgotten');
});
