import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inertTaaDevice } from './device.fixture.ts';
import { prepareTemporalAntialiasing, setWebgpuTemporalAntialiasing } from './prepare.ts';
import { TAA_CAPABILITY } from './capability.ts';
import { beginTaaFrame, taaSettled } from './frame.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { EngineCamera } from '../camera/world.ts';

function runtime(temporalAntialiasing: boolean) {
  let changed = 0;
  const rt = {
    context: { temporalAntialiasing },
    gpu: { temporal: undefined, temporalWanted: true, device: inertTaaDevice(), targetBytes: 0 },
    capabilities: { unsupported: [TAA_CAPABILITY] },
    layout: { selectionRoots: [] },
    signal: new AbortController().signal,
    capture: { capturing: false },
    run: { diagnostic: 'beauty', gate: { resourcesChanged: () => void changed++ } },
  } as unknown as WebgpuPagesRuntime;
  return { rt, changed: () => changed };
}

const served = (rt: WebgpuPagesRuntime) => !rt.capabilities.unsupported.includes(TAA_CAPABILITY);

// #363: the session opened with it off turns it on in place, and off again, without reopening.
test('temporal antialiasing is switched during the session', async () => {
  const { rt, changed } = runtime(false);
  await prepareTemporalAntialiasing(rt, rt.gpu.device!);
  assert.equal(rt.gpu.temporal, undefined, 'refused at opening: nothing created');
  setWebgpuTemporalAntialiasing(rt, true);
  assert.equal(served(rt), false, 'not drawn while the program compiles');
  for (let turn = 0; turn < 5; turn++) await new Promise(setImmediate);
  const temporal = rt.gpu.temporal!;
  assert.ok(temporal && served(rt), 'rigged in place');
  assert.equal(changed(), 2, 'a frame at the switch, one once rigged');
  temporal.frame.hasHistory = true;
  setWebgpuTemporalAntialiasing(rt, false);
  assert.equal(served(rt), false);
  assert.equal(temporal.frame.hasHistory, false, 'the history is dropped');
  const cam = { viewProjection: new Float64Array(16), eye: [0, 0, 0] } as unknown as EngineCamera;
  beginTaaFrame(rt, cam, true);
  assert.equal(temporal.frame.active, false, 'off: the image does not accumulate');
  assert.equal(taaSettled(rt), true, 'and the frame can be held');
  setWebgpuTemporalAntialiasing(rt, true);
  assert.ok(rt.gpu.temporal === temporal && served(rt), 'on again: the kept program, at once');
  assert.equal(changed(), 4);
});

test('a pass switched off while it compiles is not kept', async () => {
  const { rt } = runtime(false);
  await prepareTemporalAntialiasing(rt, rt.gpu.device!);
  setWebgpuTemporalAntialiasing(rt, true);
  setWebgpuTemporalAntialiasing(rt, false);
  for (let turn = 0; turn < 5; turn++) await new Promise(setImmediate);
  assert.equal(rt.gpu.temporal, undefined);
  assert.equal(served(rt), false);
});

const still = { viewProjection: new Float64Array(16), eye: [0, 0, 0] } as unknown as EngineCamera;

// A barrier replays the last ordinary image's checkpoint: after a switch, not its history.
test('a barrier after the switch does not replay the history from before it', async () => {
  const { rt } = runtime(true);
  await prepareTemporalAntialiasing(rt, rt.gpu.device!);
  const temporal = rt.gpu.temporal!;
  Object.assign(rt.gpu, { targetSize: [4, 2] });
  Object.assign(rt.run, { frame: 3, textureConverging: false });
  temporal.frame.hasHistory = true;
  beginTaaFrame(rt, still, false);
  setWebgpuTemporalAntialiasing(rt, false);
  setWebgpuTemporalAntialiasing(rt, true);
  rt.run.textureConverging = true;
  beginTaaFrame(rt, still, true);
  assert.equal(temporal.frame.active, true);
  assert.equal(temporal.frame.hasHistory, false, 'the old history is not read');
  assert.equal(temporal.frame.sampledRank, 0, 'nothing averages this image: every light shaded');
});

// A capture at the view's size reallocates no target after it: the history is made at once.
test('a pass rigged during a capture gets its history targets', async () => {
  const { rt } = runtime(false);
  await prepareTemporalAntialiasing(rt, rt.gpu.device!);
  Object.assign(rt.gpu, { colorTexture: {}, targetSize: [4, 2] });
  rt.capture.capturing = true;
  setWebgpuTemporalAntialiasing(rt, true);
  for (let turn = 0; turn < 5; turn++) await new Promise(setImmediate);
  const bytes = rt.gpu.temporal!.historyBytes;
  assert.ok(bytes > 0);
  assert.equal(rt.gpu.targetBytes, bytes, 'counted with the targets');
});
