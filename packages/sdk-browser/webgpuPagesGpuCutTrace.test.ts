// The image's first three bounds partition what precedes the transparents: the gate, the tile
// pump, the world step. `worldMs` therefore measures the world step alone — the streamer's pass
// is bounded on its own and deposits into no stage, so the textures stage never counts it twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTimingState } from './webgpuPagesStateTiming.ts';
import { CPU_STEP, CPU_STEP_STAGES } from './webgpuPagesCpuSteps.ts';
import { recordGpuCutTiming } from './webgpuPagesGpuCutTrace.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

function image() {
  const timing = createWebgpuTimingState();
  Object.assign(timing.marks, {
    preStart: 10,
    gateEnd: 10.5,
    tilesEnd: 12.5,
    blendStart: 13,
    cpuStart: 13.25,
    lightsEnd: 13.25,
    adoptEnd: 13.5,
    transparentSelectEnd: 13.5,
    admissionEnd: 13.75,
    queueEnd: 14,
    rowsEnd: 14,
    residencyUploadEnd: 14.25,
    selectionEnd: 14.75,
    encodeStart: 15,
    cpuEnd: 16,
  });
  const rt = { timing, run: { frame: 3, imageRevision: 1 } } as unknown as WebgpuPagesRuntime;
  return { rt, timing };
}

test('the gate, the tile pump and the world step each own their bound', () => {
  const { rt, timing } = image();
  recordGpuCutTiming(rt);
  const row = timing.cpuProfile.row;
  assert.equal(row[CPU_STEP.gateMs], 0.5);
  assert.equal(row[CPU_STEP.tilesPumpMs], 2);
  assert.equal(row[CPU_STEP.worldMs], 0.5, 'the world step no longer carries the tile pump');
  assert.equal(row[CPU_STEP.blendWorldMs], 0.25);
  assert.equal(row[CPU_STEP.totalMs], 6, 'the total still opens at the image entry');
  assert.equal(timing.rowFilled, true);
});

test('the tile pump deposits into no stage, the two others into the transforms stage', () => {
  assert.equal(CPU_STEP_STAGES[CPU_STEP.tilesPumpMs], null);
  assert.equal(CPU_STEP_STAGES[CPU_STEP.gateMs], 'animations');
  assert.equal(CPU_STEP_STAGES[CPU_STEP.worldMs], 'animations');
});
