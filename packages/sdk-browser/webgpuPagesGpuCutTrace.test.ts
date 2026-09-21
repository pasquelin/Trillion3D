// The image's first three bounds partition what precedes the transparents: the gate, the tile
// pump, the world step. `worldMs` therefore measures the world step alone, and the pump's bound is
// the only one the textures stage reads — an image with no tile to serve files none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTimingState } from './webgpuPagesStateTiming.ts';
import { CPU_STEP, CPU_STEP_STAGES } from './webgpuPagesCpuSteps.ts';
import { recordGpuCutTiming } from './webgpuPagesGpuCutTrace.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

function image(worked: boolean) {
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
  const rt = {
    timing,
    run: { frame: 3, imageRevision: 1, textureConverging: false },
    vis: { textures: { counters: { worked, lastMs: 1.25 } } },
  } as unknown as WebgpuPagesRuntime;
  return { rt, timing };
}

test('the gate, the tile pump and the world step each own their bound', () => {
  const { rt, timing } = image(true);
  recordGpuCutTiming(rt);
  const row = timing.cpuProfile.row;
  assert.equal(row[CPU_STEP.gateMs], 0.5);
  assert.equal(row[CPU_STEP.tilesPumpMs], 1.25, 'the pass measured itself: the step files it');
  assert.equal(row[CPU_STEP.worldMs], 0.5, 'the world step no longer carries the tile pump');
  assert.equal(row[CPU_STEP.blendWorldMs], 0.25);
  assert.equal(row[CPU_STEP.totalMs], 6, 'the total still opens at the image entry');
  assert.equal(timing.rowFilled, true);
});

test('a pump with nothing to serve files no bound, so the textures stage stays unmeasured', () => {
  const { rt, timing } = image(false);
  recordGpuCutTiming(rt);
  assert.ok(Number.isNaN(timing.cpuProfile.row[CPU_STEP.tilesPumpMs]));
  const barrier = image(true);
  barrier.rt.run.textureConverging = true;
  recordGpuCutTiming(barrier.rt);
  assert.ok(
    Number.isNaN(barrier.timing.cpuProfile.row[CPU_STEP.tilesPumpMs]),
    'a barrier image pumps nothing: its unbounded pass is not filed as a frame',
  );
  assert.equal(CPU_STEP_STAGES[CPU_STEP.tilesPumpMs], 'textures');
  assert.equal(CPU_STEP_STAGES[CPU_STEP.gateMs], 'animations');
  assert.equal(CPU_STEP_STAGES[CPU_STEP.worldMs], 'animations');
});
